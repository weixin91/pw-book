package com.pwbook.ui.screens.totp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.VaultSession
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class TotpListViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val securePrefs: SecurePrefs
) : ViewModel() {

    private val userId: String?
        get() = securePrefs.getString(SecurePrefs.KEY_USER_ID)

    val uiState: StateFlow<TotpListUiState> = cipherRepository
        .observeCiphers(userId ?: "")
        .map { entities ->
            val decrypted = withContext(Dispatchers.Default) {
                entities.mapNotNull { entity ->
                    vaultSession.decryptCipher(entity)
                }
            }
            val totpCiphers = decrypted.filter { !it.totp.isNullOrBlank() }
                .sortedByDescending { it.modifiedAt }
            TotpListUiState(ciphers = totpCiphers)
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = TotpListUiState()
        )
}

data class TotpListUiState(
    val ciphers: List<DecryptedCipher> = emptyList()
)
