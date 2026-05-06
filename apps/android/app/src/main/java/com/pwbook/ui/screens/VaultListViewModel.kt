package com.pwbook.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.LoginDataJson
import com.pwbook.domain.LoginUriJson
import com.pwbook.domain.VaultSession
import com.pwbook.domain.index.CipherIndexStore
import com.pwbook.domain.matcher.UriMatcher
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class VaultListViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val securePrefs: SecurePrefs,
    private val vaultSession: VaultSession,
    private val syncManager: SyncManager,
    private val vaultEncryption: VaultEncryption,
    private val pendingChangesQueue: PendingChangesQueue,
    private val json: Json,
    private val cipherIndexStore: CipherIndexStore
) : ViewModel() {

    private val _searchQuery = MutableStateFlow("")
    private val _targetUri = MutableStateFlow<String?>(null)
    private val userId: String?
        get() = securePrefs.getString(SecurePrefs.KEY_USER_ID)

    val uiState: StateFlow<VaultListUiState> = combine(
        _searchQuery,
        _targetUri,
        cipherRepository.observeCiphers(userId ?: ""),
        syncManager.syncState,
        pendingChangesQueue.observeCount()
    ) { query, targetUri, ciphers, syncState, pendingCount ->
        // 在后台线程解密 cipher data，避免阻塞主线程
        val decryptedCiphers = withContext(Dispatchers.Default) {
            ciphers.mapNotNull { entity ->
                vaultSession.decryptCipher(entity)
            }
        }

        val filtered = if (query.isBlank()) decryptedCiphers else {
            decryptedCiphers.filter {
                it.name.contains(query, ignoreCase = true) ||
                it.username?.contains(query, ignoreCase = true) == true ||
                it.uris.any { uri -> uri.contains(query, ignoreCase = true) }
            }
        }

        // 按 targetUri 匹配排序：使用 UriMatcher 进行规范化匹配，防止钓鱼站点
        val sorted = if (targetUri.isNullOrBlank()) {
            filtered.sortedByDescending { it.modifiedAt }
        } else {
            filtered.sortedWith(
                compareByDescending<DecryptedCipher> { cipher ->
                    cipher.uris.any { uri -> UriMatcher.isMatch(uri, targetUri) }
                }.thenByDescending { it.modifiedAt }
            )
        }

        VaultListUiState(
            searchQuery = query,
            ciphers = sorted,
            isLoading = false,
            syncState = syncState,
            pendingCount = pendingCount,
            lastSyncTime = securePrefs.getLong(SecurePrefs.KEY_LAST_SYNC)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = VaultListUiState()
    )

    fun onSearchQueryChange(query: String) {
        _searchQuery.value = query
    }

    fun setTargetUri(uri: String?) {
        _targetUri.value = uri
    }

    fun deleteCipher(id: String) {
        viewModelScope.launch {
            cipherRepository.deleteCipher(id)
        }
    }

    fun sync() {
        viewModelScope.launch {
            syncManager.syncAll()
                .onSuccess { Timber.i("Manual sync completed: ${it.cipherCount} ciphers, ${it.pendingCount} pushed") }
                .onFailure { Timber.e(it, "Manual sync failed") }
        }
    }

    /**
     * 全量同步：重新拉取所有数据（用于增量同步遗漏时）
     */
    fun fullSync() {
        viewModelScope.launch {
            syncManager.fullSync()
                .onSuccess { Timber.i("Full sync completed: ${it.cipherCount} ciphers") }
                .onFailure { Timber.e(it, "Full sync failed") }
        }
    }

    fun lock() {
        vaultSession.lock()
    }

    fun logout() {
        viewModelScope.launch {
            val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID)
            if (userId != null) {
                runCatching {
                    cipherIndexStore.clear(userId)
                }.onFailure {
                    Timber.e(it, "Failed to clear index on logout")
                }
            }
            vaultSession.lock()
        }
    }

    /**
     * 为自动填充选择凭据，如目标 URI 未关联则自动添加
     */
    suspend fun selectCipherForAutofill(cipherId: String, targetUri: String?): String {
        if (targetUri.isNullOrBlank()) return cipherId

        val entity = cipherRepository.getCipher(cipherId) ?: return cipherId
        val decrypted = vaultSession.decryptCipher(entity) ?: return cipherId

        // 已包含目标 URI，无需修改
        if (decrypted.uris.contains(targetUri)) return cipherId

        val userKey = vaultSession.getUserKey() ?: return cipherId
        val cipherKey = userKey.copyOfRange(0, 32)

        val newUris = decrypted.uris + targetUri
        val cipherData = CipherDataJson(
            name = decrypted.name,
            notes = decrypted.notes,
            login = LoginDataJson(
                username = decrypted.username,
                password = decrypted.password,
                uris = newUris.map { LoginUriJson(uri = it) },
                totp = decrypted.totp
            )
        )
        val encryptedData = vaultEncryption.encryptString(
            json.encodeToString(cipherData),
            cipherKey
        )
        val updatedEntity = entity.copy(
            data = encryptedData,
            modifiedAt = System.currentTimeMillis()
        )
        cipherRepository.saveCipher(updatedEntity)
        pendingChangesQueue.enqueue(
            cipherId,
            PendingChangesQueue.Operation.UPDATE,
            encryptedData,
            System.currentTimeMillis()
        )
        syncManager.launchSyncAll()
        Timber.i("Associated URI $targetUri with cipher $cipherId")
        return cipherId
    }
}

data class VaultListUiState(
    val searchQuery: String = "",
    val ciphers: List<DecryptedCipher> = emptyList(),
    val isLoading: Boolean = true,
    val syncState: SyncManager.SyncState = SyncManager.SyncState.IDLE,
    val pendingCount: Int = 0,
    val lastSyncTime: Long = 0L
)
