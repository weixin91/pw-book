package com.pwbook.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.data.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class VaultListViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val settingsRepository: SettingsRepository
) : ViewModel() {

    private val _searchQuery = MutableStateFlow("")
    private val userId: String?
        get() = settingsRepository.getUserId()

    val uiState: StateFlow<VaultListUiState> = combine(
        _searchQuery,
        cipherRepository.observeCiphers(userId ?: "")
    ) { query, ciphers ->
        val filtered = if (query.isBlank()) ciphers else {
            ciphers.filter { it.data.contains(query, ignoreCase = true) }
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

    fun lock() {
        settingsRepository.setAccessToken(null)
    }
}

data class VaultListUiState(
    val searchQuery: String = "",
    val ciphers: List<CipherEntity> = emptyList(),
    val isLoading: Boolean = true
)
