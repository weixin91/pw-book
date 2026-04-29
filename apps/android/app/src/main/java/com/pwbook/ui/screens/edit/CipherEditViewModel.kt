package com.pwbook.ui.screens.edit

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class CipherEditViewModel @Inject constructor(
    private val cipherRepository: CipherRepository
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
            entity?.let {
                _uiState.value = CipherEditUiState(
                    id = it.id,
                    name = it.data,
                    username = "",
                    password = "",
                    uri = "",
                    notes = "",
                    isNew = false
                )
            }
        }
    }

    fun updateName(name: String) { _uiState.value = _uiState.value.copy(name = name) }
    fun updateUsername(username: String) { _uiState.value = _uiState.value.copy(username = username) }
    fun updatePassword(password: String) { _uiState.value = _uiState.value.copy(password = password) }
    fun updateUri(uri: String) { _uiState.value = _uiState.value.copy(uri = uri) }
    fun updateNotes(notes: String) { _uiState.value = _uiState.value.copy(notes = notes) }

    fun save(userId: String, onSuccess: () -> Unit) {
        viewModelScope.launch {
            val state = _uiState.value
            val now = System.currentTimeMillis()
            val entity = CipherEntity(
                id = state.id.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
                userId = userId,
                type = 1,
                data = state.name,
                favorite = false,
                reprompt = 0,
                createdAt = if (state.isNew) now else state.createdAt,
                modifiedAt = now
            )
            if (state.isNew) {
                cipherRepository.saveCipher(entity)
            } else {
                cipherRepository.updateCipher(entity)
            }
            onSuccess()
        }
    }

    fun delete(onSuccess: () -> Unit) {
        viewModelScope.launch {
            cipherRepository.deleteCipher(_uiState.value.id)
            onSuccess()
        }
    }
}

data class CipherEditUiState(
    val id: String = "",
    val name: String = "",
    val username: String = "",
    val password: String = "",
    val uri: String = "",
    val notes: String = "",
    val isNew: Boolean = true,
    val createdAt: Long = 0L
)
