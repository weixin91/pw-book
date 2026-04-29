package com.pwbook.ui.generator

import androidx.lifecycle.ViewModel
import com.pwbook.domain.usecase.GeneratePasswordUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

@HiltViewModel
class PasswordGeneratorViewModel @Inject constructor(
    private val generatePasswordUseCase: GeneratePasswordUseCase
) : ViewModel() {

    private val _uiState = MutableStateFlow(PasswordGeneratorUiState())
    val uiState: StateFlow<PasswordGeneratorUiState> = _uiState

    init {
        generate()
    }

    fun updateLength(length: Int) {
        _uiState.value = _uiState.value.copy(length = length.coerceIn(5, 128))
        generate()
    }

    fun toggleUppercase() {
        _uiState.value = _uiState.value.copy(uppercase = !_uiState.value.uppercase)
        generate()
    }

    fun toggleLowercase() {
        _uiState.value = _uiState.value.copy(lowercase = !_uiState.value.lowercase)
        generate()
    }

    fun toggleNumbers() {
        _uiState.value = _uiState.value.copy(numbers = !_uiState.value.numbers)
        generate()
    }

    fun toggleSpecial() {
        _uiState.value = _uiState.value.copy(special = !_uiState.value.special)
        generate()
    }

    fun toggleExcludeAmbiguous() {
        _uiState.value = _uiState.value.copy(excludeAmbiguous = !_uiState.value.excludeAmbiguous)
        generate()
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
