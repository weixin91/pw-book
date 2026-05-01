package com.pwbook.ui.unlock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.domain.VaultSession
import com.pwbook.domain.usecase.UnlockVaultUseCase
import com.pwbook.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class UnlockViewModel @Inject constructor(
    private val unlockUseCase: UnlockVaultUseCase,
    private val vaultSession: VaultSession,
    private val syncManager: SyncManager,
    private val biometricUnlockManager: BiometricUnlockManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(UnlockUiState())
    val uiState: StateFlow<UnlockUiState> = _uiState
    val isUnlocked: StateFlow<Boolean> = vaultSession.isUnlocked

    val isBiometricAvailable: Boolean
        get() = biometricUnlockManager.canAuthenticate() && biometricUnlockManager.isBiometricEnabled()

    fun onPasswordChange(password: String) {
        _uiState.value = _uiState.value.copy(password = password, error = null)
    }

    fun unlock(onSuccess: () -> Unit) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = unlockUseCase.unlock(_uiState.value.password)
            result.fold(
                onSuccess = { userKey ->
                    // 设置 VaultSession 的 userKey，用于解密凭据
                    vaultSession.unlock(userKey)
                    Timber.i("Vault unlocked, userKey set")
                    _uiState.value = _uiState.value.copy(isLoading = false)

                    // 在独立作用域中触发同步，不受 ViewModel 生命周期影响
                    syncManager.launchFullSync()

                    onSuccess()
                },
                onFailure = { e ->
                    Timber.e(e, "Unlock failed")
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "解锁失败"
                    )
                }
            )
        }
    }

    fun biometricUnlock(
        activity: androidx.fragment.app.FragmentActivity,
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = biometricUnlockManager.authenticateAndUnlock(activity)
            result.fold(
                onSuccess = {
                    Timber.i("Vault unlocked via biometric")
                    _uiState.value = _uiState.value.copy(isLoading = false)
                    syncManager.launchFullSync()
                    onSuccess()
                },
                onFailure = { e ->
                    if (e is android.os.OperationCanceledException) {
                        _uiState.value = _uiState.value.copy(isLoading = false)
                    } else {
                        Timber.e(e, "Biometric unlock failed")
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = e.message ?: "生物识别解锁失败"
                        )
                        onError(e.message ?: "生物识别解锁失败")
                    }
                }
            )
        }
    }
}

data class UnlockUiState(
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null
)
