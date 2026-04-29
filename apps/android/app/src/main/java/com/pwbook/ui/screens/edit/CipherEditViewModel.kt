package com.pwbook.ui.screens.edit

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.LoginDataJson
import com.pwbook.domain.LoginUriJson
import com.pwbook.domain.VaultSession
import com.pwbook.sync.PendingChangesQueue
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
                        createdAt = entity.createdAt
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
                )
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
    val showTotp: Boolean = false
)