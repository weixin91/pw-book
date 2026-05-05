package com.pwbook.domain.index

import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.local.entity.PendingRebuildEntity
import com.pwbook.data.repository.CipherIndexRepository
import com.pwbook.domain.VaultSession
import com.pwbook.domain.matcher.UriMatcher
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

typealias UriIdentifier = UriMatcher.ParsedUri

data class DomainAssocLite(
    val domains: List<String>,
    val packageNames: List<String>
)

@Singleton
class CipherIndexStore @Inject constructor(
    private val cipherIndexRepository: CipherIndexRepository,
    private val cipherIndexBuilder: CipherIndexBuilder,
    private val json: Json
) {

    private val writeMutex = Mutex()

    suspend fun filterByDomain(
        userId: String,
        sourceUri: UriIdentifier,
        domainAssocRules: List<DomainAssocLite>
    ): List<String> {
        val start = System.currentTimeMillis()
        val indices = cipherIndexRepository.getAll(userId)
        val result = indices.asSequence()
            .filter { it.hasLogin }
            .filter { index -> isDomainMatch(sourceUri, index, domainAssocRules) }
            .map { it.cipherId }
            .toList()
        Timber.d("filterByDomain: ${result.size} candidates in ${System.currentTimeMillis() - start}ms")
        return result
    }

    suspend fun filterByRpId(userId: String, rpId: String): List<String> {
        val start = System.currentTimeMillis()
        val rpIdLower = rpId.lowercase()
        val indices = cipherIndexRepository.getAll(userId)
        val result = indices.asSequence()
            .filter { it.hasPasskey }
            .filter { index ->
                val rpIds = json.decodeFromString<List<String>>(index.rpIdsJson)
                rpIdLower in rpIds
            }
            .map { it.cipherId }
            .toList()
        Timber.d("filterByRpId: ${result.size} candidates in ${System.currentTimeMillis() - start}ms")
        return result
    }

    suspend fun rebuild(
        userId: String,
        ciphers: List<CipherEntity>,
        decryptFn: suspend (encryptedData: String) -> String?
    ) {
        val start = System.currentTimeMillis()
        writeMutex.withLock {
            cipherIndexRepository.deleteAllByUser(userId)
            val loginCiphers = ciphers.filter { it.type == 1 }
            val entries = loginCiphers.mapNotNull { entity ->
                runCatching {
                    cipherIndexBuilder.build(entity, decryptFn)
                }.getOrNull()
            }
            if (entries.isNotEmpty()) {
                cipherIndexRepository.insertAll(entries)
            }
            Timber.d("rebuild: ${entries.size}/${loginCiphers.size} entries in ${System.currentTimeMillis() - start}ms")
        }
    }

    suspend fun rebuildOne(
        cipherId: String,
        userId: String,
        encryptedData: String,
        decryptFn: suspend (encryptedData: String) -> String?
    ) {
        val entity = CipherEntity(
            id = cipherId,
            userId = userId,
            type = 1,
            data = encryptedData,
            favorite = false,
            reprompt = 0,
            createdAt = 0L,
            modifiedAt = 0L
        )
        val index = runCatching {
            cipherIndexBuilder.build(entity, decryptFn)
        }.getOrNull() ?: return

        writeMutex.withLock {
            cipherIndexRepository.insert(index)
        }
    }

    suspend fun removeOne(cipherId: String) {
        writeMutex.withLock {
            cipherIndexRepository.deleteById(cipherId)
            cipherIndexRepository.removePendingRebuild(cipherId)
        }
    }

    suspend fun clear(userId: String) {
        writeMutex.withLock {
            cipherIndexRepository.deleteAllByUser(userId)
            cipherIndexRepository.clearPendingRebuild(userId)
        }
    }

    suspend fun checkConsistency(userId: String, localCipherIds: Set<String>): Set<String>? {
        val start = System.currentTimeMillis()
        val indexIds = cipherIndexRepository.getAllCipherIds(userId).toSet()
        if (indexIds == localCipherIds) {
            Timber.d("checkConsistency: consistent in ${System.currentTimeMillis() - start}ms")
            return null
        }
        val extra = indexIds - localCipherIds
        writeMutex.withLock {
            extra.forEach { cipherIndexRepository.deleteById(it) }
        }
        val missing = localCipherIds - indexIds
        Timber.d("checkConsistency: ${missing.size} missing, ${extra.size} extra in ${System.currentTimeMillis() - start}ms")
        return missing
    }

    suspend fun markPendingRebuild(cipherId: String, userId: String) {
        writeMutex.withLock {
            cipherIndexRepository.markPendingRebuild(
                PendingRebuildEntity(cipherId = cipherId, userId = userId)
            )
        }
    }

    suspend fun removeAndClearPending(cipherId: String, userId: String) {
        writeMutex.withLock {
            cipherIndexRepository.deleteById(cipherId)
            cipherIndexRepository.removePendingRebuild(cipherId)
        }
    }

    /**
     * 通过 VaultSession 直接解密并插入/更新单条索引。
     * vault 锁定时标记为 pending rebuild。
     */
    suspend fun upsert(entity: CipherEntity, vaultSession: VaultSession) {
        val index = cipherIndexBuilder.buildFromEntity(entity, vaultSession)
        if (index != null) {
            writeMutex.withLock {
                cipherIndexRepository.insert(index)
            }
        } else {
            markPendingRebuild(entity.id, entity.userId)
        }
    }

    suspend fun processPendingRebuild(
        userId: String,
        decryptFn: suspend (encryptedData: String) -> String?,
        getCipherFn: suspend (cipherId: String) -> CipherEntity?
    ) {
        val pendingIds = cipherIndexRepository.getPendingRebuildIds(userId)
        if (pendingIds.isEmpty()) {
            Timber.d("processPendingRebuild: no pending items")
            return
        }
        val start = System.currentTimeMillis()
        writeMutex.withLock {
            for (cipherId in pendingIds) {
                val entity = getCipherFn(cipherId) ?: continue
                val index = runCatching {
                    cipherIndexBuilder.build(entity, decryptFn)
                }.getOrNull()
                if (index != null) {
                    cipherIndexRepository.insert(index)
                }
            }
            cipherIndexRepository.clearPendingRebuild(userId)
        }
        Timber.d("processPendingRebuild: ${pendingIds.size} items in ${System.currentTimeMillis() - start}ms")
    }

    private fun isDomainMatch(
        source: UriIdentifier,
        index: com.pwbook.data.local.entity.CipherIndexEntity,
        rules: List<DomainAssocLite>
    ): Boolean {
        val targetDomains = json.decodeFromString<List<String>>(index.domainsJson)
        return when (source.type) {
            UriMatcher.UriType.WEB -> {
                val sb = source.baseDomain ?: return false
                targetDomains.any { td ->
                    sb == td || rules.any { r -> sb in r.domains && td in r.domains }
                }
            }
            UriMatcher.UriType.APP -> {
                val pkg = source.packageName ?: return false
                targetDomains.any { td ->
                    rules.any { r -> td in r.domains && pkg in r.packageNames }
                }
            }
            UriMatcher.UriType.OTHER -> false
        }
    }
}
