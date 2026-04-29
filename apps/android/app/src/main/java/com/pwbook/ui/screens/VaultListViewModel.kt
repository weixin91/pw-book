package com.pwbook.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.VaultSession
import com.pwbook.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class VaultListViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val securePrefs: SecurePrefs,
    private val vaultSession: VaultSession,
    private val syncManager: SyncManager
) : ViewModel() {

    private val _searchQuery = MutableStateFlow("")
    private val userId: String?
        get() = securePrefs.getString(SecurePrefs.KEY_USER_ID)

    val uiState: StateFlow<VaultListUiState> = combine(
        _searchQuery,
        cipherRepository.observeCiphers(userId ?: "")
    ) { query, ciphers ->
        // 解密 cipher data 用于显示
        val decryptedCiphers = ciphers.mapNotNull { entity ->
            vaultSession.decryptCipher(entity)
        }

        val filtered = if (query.isBlank()) decryptedCiphers else {
            decryptedCiphers.filter {
                it.name.contains(query, ignoreCase = true) ||
                it.username?.contains(query, ignoreCase = true) == true ||
                it.uris.any { uri -> uri.contains(query, ignoreCase = true) }
            }
        }
        VaultListUiState(
            searchQuery = query,
            ciphers = filtered,
            isLoading = false
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = VaultListUiState()
    )

    fun onSearchQueryChange(query: String) {
        _searchQuery.value = query
    }

    fun deleteCipher(id: String) {
        viewModelScope.launch {
            cipherRepository.deleteCipher(id)
        }
    }

    fun sync() {
        viewModelScope.launch {
            syncManager.fullSync()
                .onSuccess { Timber.i("Manual sync completed: ${it.cipherCount} ciphers") }
                .onFailure { Timber.e(it, "Manual sync failed") }
        }
    }

    fun lock() {
        vaultSession.lock()
        securePrefs.putString(SecurePrefs.KEY_ACCESS_TOKEN, null)
    }
}

data class VaultListUiState(
    val searchQuery: String = "",
    val ciphers: List<DecryptedCipher> = emptyList(),
    val isLoading: Boolean = true
)
