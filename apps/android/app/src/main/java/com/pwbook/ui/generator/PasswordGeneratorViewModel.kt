package com.pwbook.ui.generator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.domain.usecase.GeneratePasswordUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject

@Serializable
data class PasswordGeneratorConfig(
    val length: Int = 16,
    val uppercase: Boolean = true,
    val lowercase: Boolean = true,
    val numbers: Boolean = true,
    val special: Boolean = true,
    val excludeAmbiguous: Boolean = true
)

@HiltViewModel
class PasswordGeneratorViewModel @Inject constructor(
    private val generatePasswordUseCase: GeneratePasswordUseCase,
    private val settingsRepository: SettingsRepository,
    private val json: Json
) : ViewModel() {

    private val _uiState = MutableStateFlow(PasswordGeneratorUiState())
    val uiState: StateFlow<PasswordGeneratorUiState> = _uiState

    init {
        viewModelScope.launch {
            val config = loadConfig()
            _uiState.value = PasswordGeneratorUiState(
                length = config.length,
                uppercase = config.uppercase,
                lowercase = config.lowercase,
                numbers = config.numbers,
                special = config.special,
                excludeAmbiguous = config.excludeAmbiguous
            )
            generate()
        }
    }

    fun updateLength(length: Int) {
        _uiState.value = _uiState.value.copy(length = length.coerceIn(5, 128))
        generate()
        saveConfig()
    }

    fun toggleUppercase() {
        _uiState.value = _uiState.value.copy(uppercase = !_uiState.value.uppercase)
        generate()
        saveConfig()
    }

    fun toggleLowercase() {
        _uiState.value = _uiState.value.copy(lowercase = !_uiState.value.lowercase)
        generate()
        saveConfig()
    }

    fun toggleNumbers() {
        _uiState.value = _uiState.value.copy(numbers = !_uiState.value.numbers)
        generate()
        saveConfig()
    }

    fun toggleSpecial() {
        _uiState.value = _uiState.value.copy(special = !_uiState.value.special)
        generate()
        saveConfig()
    }

    fun toggleExcludeAmbiguous() {
        _uiState.value = _uiState.value.copy(excludeAmbiguous = !_uiState.value.excludeAmbiguous)
        generate()
        saveConfig()
    }

    fun generate() {
        val state = _uiState.value
        if (!state.uppercase && !state.lowercase && !state.numbers && !state.special) {
            _uiState.value = state.copy(password = "", error = "至少选择一种字符类型")
            return
        }
        val password = generatePasswordUseCase.execute(
            length = state.length,
            uppercase = state.uppercase,
            lowercase = state.lowercase,
            numbers = state.numbers,
            special = state.special,
            excludeAmbiguous = state.excludeAmbiguous
        )
        _uiState.value = state.copy(password = password, error = null)
    }

    private fun saveConfig() {
        val state = _uiState.value
        val config = PasswordGeneratorConfig(
            length = state.length,
            uppercase = state.uppercase,
            lowercase = state.lowercase,
            numbers = state.numbers,
            special = state.special,
            excludeAmbiguous = state.excludeAmbiguous
        )
        viewModelScope.launch {
            settingsRepository.setString(KEY_CONFIG, json.encodeToString(config))
        }
    }

    private suspend fun loadConfig(): PasswordGeneratorConfig {
        val raw = settingsRepository.getString(KEY_CONFIG)
        return if (raw != null) {
            try {
                json.decodeFromString(raw)
            } catch (e: Exception) {
                PasswordGeneratorConfig()
            }
        } else {
            PasswordGeneratorConfig()
        }
    }

    companion object {
        const val KEY_CONFIG = "password_generator_config"
    }
}

data class PasswordGeneratorUiState(
    val length: Int = 16,
    val uppercase: Boolean = true,
    val lowercase: Boolean = true,
    val numbers: Boolean = true,
    val special: Boolean = true,
    val excludeAmbiguous: Boolean = true,
    val password: String = "",
    val error: String? = null
)
