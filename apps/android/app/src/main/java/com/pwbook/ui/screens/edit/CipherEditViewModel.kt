package com.pwbook.ui.screens.edit

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.LoginDataJson
import com.pwbook.domain.LoginUriJson
import com.pwbook.domain.VaultSession
import com.pwbook.domain.usecase.GeneratePasswordUseCase
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import com.pwbook.ui.generator.PasswordGeneratorConfig
import com.pwbook.ui.generator.PasswordGeneratorViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class CipherEditViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val vaultEncryption: VaultEncryption,
    private val pendingChangesQueue: PendingChangesQueue,
    private val securePrefs: SecurePrefs,
    private val syncManager: SyncManager,
    private val generatePasswordUseCase: GeneratePasswordUseCase,
    private val settingsRepository: SettingsRepository,
    private val json: Json
) : ViewModel() {

    private val _uiState = MutableStateFlow(CipherEditUiState())
    val uiState: StateFlow<CipherEditUiState> = _uiState

    fun loadCipher(cipherId: String?) {
        if (cipherId == null) {
            _uiState.value = CipherEditUiState(isNew = true)
            return
        }
        viewModelScope.launch {
            val entity = cipherRepository.getCipher(cipherId)
            if (entity != null) {
                val decrypted = vaultSession.decryptCipher(entity)
                if (decrypted != null) {
                    _uiState.value = CipherEditUiState(
                        id = entity.id,
                        name = decrypted.name,
                        username = decrypted.username ?: "",
                        password = decrypted.password ?: "",
                        uris = decrypted.uris.ifEmpty { listOf("") },
                        notes = decrypted.notes ?: "",
                        totp = decrypted.totp ?: "",
                        favorite = entity.favorite,
                        isNew = false,
                        createdAt = entity.createdAt,
                        hasPasskey = decrypted.passkey != null,
                        passkeyRpId = decrypted.passkey?.rpId,
                        passkeyCreatedAt = decrypted.passkey?.createdAt?.let {
                            try {
                                val instant = java.time.Instant.parse(it)
                                java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.getDefault())
                                    .format(java.util.Date(instant.toEpochMilli()))
                            } catch (e: Exception) {
                                it
                            }
                        } ?: ""
                    )
                } else {
                    Timber.e("Failed to decrypt cipher $cipherId")
                }
            }
        }
    }

    fun updateName(name: String) { _uiState.value = _uiState.value.copy(name = name) }
    fun updateUsername(username: String) { _uiState.value = _uiState.value.copy(username = username) }
    fun updatePassword(password: String) { _uiState.value = _uiState.value.copy(password = password) }
    fun updateNotes(notes: String) { _uiState.value = _uiState.value.copy(notes = notes) }
    fun updateTotp(totp: String) { _uiState.value = _uiState.value.copy(totp = totp) }
    fun updateFavorite(favorite: Boolean) { _uiState.value = _uiState.value.copy(favorite = favorite) }
    fun togglePasswordVisibility() { _uiState.value = _uiState.value.copy(showPassword = !_uiState.value.showPassword) }
    fun toggleTotpVisibility() { _uiState.value = _uiState.value.copy(showTotp = !_uiState.value.showTotp) }

    fun generatePassword() {
        viewModelScope.launch {
            val raw = settingsRepository.getString(PasswordGeneratorViewModel.KEY_CONFIG)
            val config = if (raw != null) {
                try {
                    json.decodeFromString<PasswordGeneratorConfig>(raw)
                } catch (e: Exception) {
                    PasswordGeneratorConfig()
                }
            } else {
                PasswordGeneratorConfig()
            }
            val password = generatePasswordUseCase.execute(
                length = config.length,
                uppercase = config.uppercase,
                lowercase = config.lowercase,
                numbers = config.numbers,
                special = config.special,
                excludeAmbiguous = config.excludeAmbiguous
            )
            _uiState.value = _uiState.value.copy(password = password, showPassword = true)
        }
    }

    fun updateUri(index: Int, uri: String) {
        val currentUris = _uiState.value.uris
        if (index < currentUris.size) {
            _uiState.value = _uiState.value.copy(
                uris = currentUris.mapIndexed { i, u -> if (i == index) uri else u }
            )
        }
    }

    fun addUri(prefix: String = "") {
        _uiState.value = _uiState.value.copy(
            uris = _uiState.value.uris + prefix
        )
    }

    fun removeUri(index: Int) {
        val currentUris = _uiState.value.uris
        if (currentUris.size > 1) {
            _uiState.value = _uiState.value.copy(
                uris = currentUris.filterIndexed { i, _ -> i != index }
            )
        } else if (currentUris.size == 1) {
            _uiState.value = _uiState.value.copy(uris = listOf(""))
        }
    }

    fun removePasskey() {
        viewModelScope.launch {
            val userKey = vaultSession.getUserKey() ?: return@launch
            val cipherKey = userKey.copyOfRange(0, 32)

            val entity = cipherRepository.getCipher(_uiState.value.id) ?: return@launch
            val decrypted = vaultSession.decryptCipher(entity) ?: return@launch

            val updatedData = CipherDataJson(
                name = decrypted.name,
                notes = decrypted.notes,
                login = LoginDataJson(
                    username = decrypted.username,
                    password = decrypted.password,
                    uris = decrypted.uris.map { LoginUriJson(uri = it) },
                    totp = decrypted.totp
                )
            )
            val encryptedData = vaultEncryption.encryptString(
                json.encodeToString(updatedData),
                cipherKey
            )
            val updatedEntity = entity.copy(
                data = encryptedData,
                modifiedAt = System.currentTimeMillis()
            )
            cipherRepository.saveCipher(updatedEntity)
            pendingChangesQueue.enqueue(
                entity.id,
                PendingChangesQueue.Operation.UPDATE,
                encryptedData,
                System.currentTimeMillis()
            )
            syncManager.launchSyncAll()
            _uiState.value = _uiState.value.copy(hasPasskey = false, passkeyRpId = null)
            Timber.i("Passkey removed from cipher ${entity.id}")
        }
    }

    fun save(onSuccess: () -> Unit) {
        viewModelScope.launch {
            val userKey = vaultSession.getUserKey()
            if (userKey == null) {
                Timber.e("Vault not unlocked, cannot save")
                return@launch
            }

            // Edge extension 使用 userKey 的前 32 bytes 加密 cipher data
            val cipherKey = userKey.copyOfRange(0, 32)

            val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
            val state = _uiState.value
            val now = System.currentTimeMillis()

            // 保留原有 passkey 字段
            var existingPasskey: com.pwbook.domain.PasskeyDataJson? = null
            if (!state.isNew) {
                val existingEntity = cipherRepository.getCipher(state.id)
                existingPasskey = existingEntity?.let { vaultSession.decryptCipher(it)?.passkey }
            }

            // 构建凭据数据 JSON
            val cleanUris = state.uris
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
                .map { LoginUriJson(uri = it) }

            val cipherData = CipherDataJson(
                name = state.name.ifEmpty { cleanUris.firstOrNull()?.uri ?: "未命名" },
                notes = state.notes.ifEmpty { null },
                login = LoginDataJson(
                    username = state.username.ifEmpty { null },
                    password = state.password.ifEmpty { null },
                    uris = cleanUris,
                    totp = state.totp.trim().ifEmpty { null }
                ),
                passkey = existingPasskey
            )

            val encryptedData = vaultEncryption.encryptString(
                json.encodeToString(cipherData),
                cipherKey
            )

            val entity = CipherEntity(
                id = state.id.ifEmpty { UUID.randomUUID().toString() },
                userId = userId,
                type = 1,
                data = encryptedData,
                favorite = state.favorite,
                reprompt = 0,
                createdAt = if (state.isNew) now else state.createdAt,
                modifiedAt = now
            )

            cipherRepository.saveCipher(entity)

            // 添加到待同步队列
            pendingChangesQueue.enqueue(
                entity.id,
                if (state.isNew) PendingChangesQueue.Operation.CREATE else PendingChangesQueue.Operation.UPDATE,
                encryptedData,
                now
            )

            // 触发后台同步，将变更推送到后端
            syncManager.launchSyncAll()

            Timber.i("Cipher saved: ${entity.id}")
            onSuccess()
        }
    }

    fun delete(onSuccess: () -> Unit) {
        viewModelScope.launch {
            val state = _uiState.value
            cipherRepository.deleteCipher(state.id)
            pendingChangesQueue.enqueue(
                state.id,
                PendingChangesQueue.Operation.DELETE,
                "",
                System.currentTimeMillis()
            )
            // 触发后台同步
            syncManager.launchSyncAll()

            Timber.i("Cipher deleted: ${state.id}")
            onSuccess()
        }
    }
}

data class CipherEditUiState(
    val id: String = "",
    val name: String = "",
    val username: String = "",
    val password: String = "",
    val uris: List<String> = listOf(""),
    val notes: String = "",
    val totp: String = "",
    val favorite: Boolean = false,
    val isNew: Boolean = true,
    val createdAt: Long = 0L,
    val showPassword: Boolean = false,
    val showTotp: Boolean = false,
    val hasPasskey: Boolean = false,
    val passkeyRpId: String? = null,
    val passkeyCreatedAt: String = ""
)
