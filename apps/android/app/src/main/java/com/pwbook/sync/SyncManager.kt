package com.pwbook.sync

import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.local.entity.DomainAssocEntity
import com.pwbook.data.remote.api.CipherApi
import com.pwbook.data.remote.api.CipherDto
import com.pwbook.data.remote.api.DomainAssocApi
import com.pwbook.data.remote.api.DomainAssocDto
import com.pwbook.data.remote.api.PushChangeDto
import com.pwbook.data.remote.api.PushRequest
import com.pwbook.data.remote.api.SyncApi
import com.pwbook.data.repository.CipherRepository
import com.pwbook.data.repository.DomainAssocRepository
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.domain.VaultSession
import com.pwbook.domain.index.CipherIndexStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncManager @Inject constructor(
    private val syncApi: SyncApi,
    private val cipherApi: CipherApi,
    private val domainAssocApi: DomainAssocApi,
    private val cipherRepository: CipherRepository,
    private val domainAssocRepository: DomainAssocRepository,
    private val settingsRepository: SettingsRepository,
    private val pendingChangesQueue: PendingChangesQueue,
    private val securePrefs: SecurePrefs,
    private val json: Json,
    private val vaultSession: VaultSession,
    private val vaultEncryption: VaultEncryption,
    private val cipherIndexStore: CipherIndexStore
) {
    // 使用独立的作用域，不受 ViewModel 生命周期影响
    private val syncScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _syncState = MutableStateFlow(SyncState.IDLE)
    val syncState: StateFlow<SyncState> = _syncState

    /**
     * 在独立作用域中启动同步，不受 ViewModel 生命周期影响
     */
    fun launchFullSync() {
        syncScope.launch {
            fullSync()
        }
    }

    /**
     * 在独立作用域中启动完整的 push + pull 同步
     */
    fun launchSyncAll() {
        syncScope.launch {
            syncAll()
        }
    }

    suspend fun fullSync(): Result<SyncResult> = runCatching {
        _syncState.value = SyncState.SYNCING
        val userId = getUserIdOrThrow()
        val response = syncApi.sync()

        cipherRepository.clearUserCiphers(userId)
        val ciphers = response.ciphers.map { it.toEntity(userId) }
        cipherRepository.saveCiphers(ciphers)

        // 重建索引
        rebuildIndexAfterFullSync(userId, ciphers)

        domainAssocRepository.clearUserRules(userId)
        val rules = response.domainAssociations.map { it.toEntity(userId) }
        domainAssocRepository.saveRules(rules)

        response.syncToken?.let { settingsRepository.setString("last_sync_token", it) }

        _syncState.value = SyncState.IDLE
        securePrefs.putLong(SecurePrefs.KEY_LAST_SYNC, System.currentTimeMillis())
        Timber.i("Full sync completed, ciphers=${ciphers.size}, rules=${rules.size}")
        SyncResult(ciphers.size, rules.size, 0)
    }.onFailure {
        _syncState.value = SyncState.ERROR
        Timber.e(it, "Full sync failed")
    }

    suspend fun incrementalSync(): Result<SyncResult> = runCatching {
        _syncState.value = SyncState.SYNCING
        val userId = getUserIdOrThrow()
        val lastSyncToken = settingsRepository.getString("last_sync_token")
        val response = syncApi.sync(lastSyncToken)

        // 处理服务器下发的删除
        response.deletedCipherIds.forEach { id ->
            cipherRepository.deleteCipher(id)
        }

        response.ciphers.forEach { dto ->
            val local = cipherRepository.getCipher(dto.id)
            if (local == null) {
                cipherRepository.saveCipher(dto.toEntity(userId))
            } else if (dto.modifiedAtMillis() > local.modifiedAt) {
                cipherRepository.saveCipher(dto.toEntity(userId))
            }
        }

        domainAssocRepository.clearUserRules(userId)
        val rules = response.domainAssociations.map { it.toEntity(userId) }
        domainAssocRepository.saveRules(rules)

        response.syncToken?.let { settingsRepository.setString("last_sync_token", it) }

        securePrefs.putLong(SecurePrefs.KEY_LAST_SYNC, System.currentTimeMillis())
        _syncState.value = SyncState.IDLE
        Timber.i("Incremental sync completed, changes=${response.ciphers.size}")
        SyncResult(response.ciphers.size, rules.size, 0)
    }.onFailure {
        _syncState.value = SyncState.ERROR
        Timber.e(it, "Incremental sync failed")
    }

    suspend fun pushPendingChanges(): Result<PushResult> = runCatching {
        _syncState.value = SyncState.SYNCING
        val userId = getUserIdOrThrow()
        val pending = pendingChangesQueue.getAll()
        if (pending.isEmpty()) {
            _syncState.value = SyncState.IDLE
            return@runCatching PushResult(0, 0, emptyList())
        }

        val lastSyncToken = settingsRepository.getString("last_sync_token")
        val changes = pending.mapNotNull { entity ->
            val timestampIso = java.time.format.DateTimeFormatter.ISO_INSTANT
                .format(java.time.Instant.ofEpochMilli(entity.clientTimestamp))
            val cipherId = entity.cipherId ?: return@mapNotNull null

            val cipher = CipherDto(
                id = cipherId,
                type = 1,
                data = entity.encryptedData ?: "",
                favorite = false,
                reprompt = 0,
                createdAt = timestampIso,
                modifiedAt = timestampIso
            )

            PushChangeDto(
                id = entity.id.toString(),
                type = entity.operation,
                cipher = cipher,
                clientTimestamp = timestampIso
            )
        }

        val request = PushRequest(changes, lastSyncToken)
        val response = syncApi.push(request)

        response.accepted.forEach { id ->
            pending.find { it.id.toString() == id }?.let { pendingChangesQueue.remove(it.id) }
        }

        response.conflicts.forEach { cipherId ->
            Timber.w("Conflict detected for cipher $cipherId, will resolve on next sync")
        }

        response.newSyncToken?.let { settingsRepository.setString("last_sync_token", it) }

        securePrefs.putLong(SecurePrefs.KEY_LAST_SYNC, System.currentTimeMillis())
        _syncState.value = SyncState.IDLE
        Timber.i("Push completed, accepted=${response.accepted.size}, conflicts=${response.conflicts.size}")
        PushResult(response.accepted.size, response.rejected.size, response.conflicts)
    }.onFailure {
        _syncState.value = SyncState.ERROR
        Timber.e(it, "Push failed")
    }

    suspend fun syncAll(): Result<SyncResult> {
        val pushResult = pushPendingChanges().getOrNull()
        val pullResult = incrementalSync().getOrNull()
        return Result.success(
            SyncResult(
                cipherCount = pullResult?.cipherCount ?: 0,
                ruleCount = pullResult?.ruleCount ?: 0,
                pendingCount = pushResult?.accepted ?: 0
            )
        )
    }

    private suspend fun rebuildIndexAfterFullSync(userId: String, ciphers: List<CipherEntity>) {
        val userKey = vaultSession.getUserKey()
        if (userKey != null) {
            val decryptFn: suspend (String) -> String? = { data ->
                try {
                    vaultEncryption.decryptString(data, userKey.copyOfRange(0, 32))
                } catch (_: Exception) {
                    null
                }
            }
            cipherIndexStore.rebuild(userId, ciphers, decryptFn)
        } else {
            ciphers.forEach {
                cipherIndexStore.markPendingRebuild(it.id, userId)
            }
            Timber.d("Vault locked during full sync, marked ${ciphers.size} ciphers as pending rebuild")
        }
    }

    private fun getUserIdOrThrow(): String {
        return securePrefs.getString(SecurePrefs.KEY_USER_ID)
            ?: throw IllegalStateException("未登录")
    }

    private fun CipherDto.toEntity(userId: String): CipherEntity {
        return CipherEntity(
            id = id,
            userId = userId,
            type = type,
            data = data,
            favorite = favorite,
            reprompt = reprompt,
            createdAt = createdAtMillis(),
            modifiedAt = modifiedAtMillis()
        )
    }

    private fun DomainAssocDto.toEntity(userId: String): DomainAssocEntity {
        return DomainAssocEntity(
            id = id,
            userId = userId,
            domains = json.encodeToString(domains),
            packageNames = json.encodeToString(packageNames),
            createdAt = createdAtMillis()
        )
    }

    enum class SyncState {
        IDLE, SYNCING, ERROR, OFFLINE
    }

    data class SyncResult(
        val cipherCount: Int,
        val ruleCount: Int,
        val pendingCount: Int
    )

    data class PushResult(
        val accepted: Int,
        val rejected: Int,
        val conflicts: List<String>
    )
}
