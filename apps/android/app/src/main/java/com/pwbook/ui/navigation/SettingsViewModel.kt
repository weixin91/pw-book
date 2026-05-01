package com.pwbook.ui.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.data.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    val settingsRepository: SettingsRepository,
    val biometricUnlockManager: BiometricUnlockManager
) : ViewModel() {

    private val _serverUrl = MutableStateFlow(settingsRepository.getServerUrl() ?: "")
    val serverUrl: StateFlow<String> = _serverUrl

    fun updateServerUrl(url: String) {
        viewModelScope.launch {
            settingsRepository.setServerUrl(url.takeIf { it.isNotBlank() })
            _serverUrl.value = url
        }
    }
}