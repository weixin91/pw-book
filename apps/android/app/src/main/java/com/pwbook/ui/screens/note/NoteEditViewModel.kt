package com.pwbook.ui.screens.note

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.VaultSession
import com.pwbook.domain.model.CipherType
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

data class NoteEditUiState(
    val id: String = "",
    val name: String = "",
    val notes: String = "",
    val favorite: Boolean = false,
    val isNew: Boolean = true,
    val isLoading: Boolean = false,
    val createdAt: Long = 0L
)

@HiltViewModel
class NoteEditViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val vaultEncryption: VaultEncryption,
    private val pendingChangesQueue: PendingChangesQueue,
    private val securePrefs: SecurePrefs,
    private val syncManager: SyncManager,
    private val json: Json
) : ViewModel() {

    private val _uiState = MutableStateFlow(NoteEditUiState())
    val uiState: StateFlow<NoteEditUiState> = _uiState

    fun loadCipher(cipherId: String?) {
        if (cipherId == null) {
            _uiState.value = NoteEditUiState(isNew = true)
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            val entity = cipherRepository.getCipher(cipherId)
            if (entity != null) {
                val decrypted = vaultSession.decryptCipher(entity)
                if (decrypted != null) {
                    _uiState.value = NoteEditUiState(
                        id = entity.id,
                        name = decrypted.name,
                        notes = decrypted.notes ?: "",
                        favorite = entity.favorite,
                        isNew = false,
                        isLoading = false,
                        createdAt = entity.createdAt
                    )
                } else {
                    Timber.e("Failed to decrypt note $cipherId")
                    _uiState.value = _uiState.value.copy(isLoading = false)
                }
            } else {
                Timber.e("Note not found: $cipherId")
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }
    }

    fun updateName(name: String) {
        _uiState.value = _uiState.value.copy(name = name)
    }

    fun updateNotes(notes: String) {
        _uiState.value = _uiState.value.copy(notes = notes)
    }

    fun save(onSuccess: () -> Unit) {
        viewModelScope.launch {
            val userKey = vaultSession.getUserKey()
            if (userKey == null) {
                Timber.e("Vault not unlocked, cannot save note")
                return@launch
            }

            val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
            if (userId.isEmpty()) {
                Timber.e("User ID not found, cannot save note")
                return@launch
            }

            val cipherKey = userKey.copyOfRange(0, 32)
            val state = _uiState.value
            val now = System.currentTimeMillis()

            val cipherData = CipherDataJson(
                name = state.name.trim(),
                notes = state.notes.trim().ifEmpty { null }
            )

            val encryptedData = vaultEncryption.encryptString(
                json.encodeToString(cipherData),
                cipherKey
            )

            val entity = CipherEntity(
                id = state.id.ifEmpty { UUID.randomUUID().toString() },
                userId = userId,
                type = CipherType.SECURE_NOTE.value,
                data = encryptedData,
                favorite = state.favorite,
                reprompt = 0,
                createdAt = if (state.isNew) now else state.createdAt,
                modifiedAt = now
            )

            cipherRepository.saveCipher(entity)
            pendingChangesQueue.enqueue(
                entity.id,
                if (state.isNew) PendingChangesQueue.Operation.CREATE else PendingChangesQueue.Operation.UPDATE,
                encryptedData,
                now
            )
            syncManager.launchSyncAll()
            onSuccess()
        }
    }

    fun delete(onSuccess: () -> Unit) {
        viewModelScope.launch {
            val state = _uiState.value
            if (state.id.isEmpty()) return@launch

            cipherRepository.deleteCipher(state.id)
            pendingChangesQueue.enqueue(
                state.id,
                PendingChangesQueue.Operation.DELETE,
                "",
                System.currentTimeMillis()
            )
            syncManager.launchSyncAll()
            onSuccess()
        }
    }
}
