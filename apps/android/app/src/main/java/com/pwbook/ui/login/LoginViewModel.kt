package com.pwbook.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.crypto.KdfType
import com.pwbook.crypto.KeyDerivation
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.remote.api.AuthApi
import com.pwbook.data.remote.api.LoginRequest
import com.pwbook.data.remote.api.PreloginRequest
import com.pwbook.data.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authApi: AuthApi,
    private val keyDerivation: KeyDerivation,
    private val settingsRepository: SettingsRepository,
    private val securePrefs: SecurePrefs
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onEmailChange(email: String) {
        _uiState.value = _uiState.value.copy(email = email, error = null)
    }

    fun onPasswordChange(password: String) {
        _uiState.value = _uiState.value.copy(password = password, error = null)
    }

    fun onServerUrlChange(url: String) {
        _uiState.value = _uiState.value.copy(serverUrl = url, error = null)
    }

    fun prelogin(onSuccess: () -> Unit) {
        val email = _uiState.value.email.trim()
        if (email.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "请输入邮箱")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val serverUrl = _uiState.value.serverUrl.trim()
                if (serverUrl.isNotBlank()) {
                    settingsRepository.setServerUrl(serverUrl)
                }

                val response = authApi.prelogin(email)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    kdfType = response.kdfType,
                    kdfIterations = response.kdfIterations,
                    kdfMemory = response.kdfMemory,
                    kdfParallelism = response.kdfParallelism,
                    showPasswordField = true
                )
                onSuccess()
            } catch (e: Exception) {
                Timber.e(e, "Prelogin failed for email: $email")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "获取 KDF 参数失败"
                )
            }
        }
    }

    fun login(onSuccess: () -> Unit) {
        val email = _uiState.value.email.trim()
        val password = _uiState.value.password

        if (email.isBlank() || password.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "请填写所有字段")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val kdfType = KdfType.valueOf(_uiState.value.kdfType)
                val iterations = _uiState.value.kdfIterations

                Timber.d("=== LOGIN DEBUG ===")
                Timber.d("email: $email")
                Timber.d("password length: ${password.length}")
                Timber.d("kdfType: ${kdfType.name}")
                Timber.d("iterations: $iterations")

                val masterKey = keyDerivation.deriveMasterKey(
                    password = password,
                    email = email,
                    kdfType = kdfType,
                    iterations = iterations,
                    memoryKb = _uiState.value.kdfMemory,
                    parallelism = _uiState.value.kdfParallelism
                )
                Timber.d("masterKey (hex): ${masterKey.joinToString("") { "%02x".format(it) }}")

                // 使用与 Edge 一致的密码哈希计算方式
                val hash = keyDerivation.deriveMasterPasswordHash(masterKey, password)
                val masterPasswordHash = keyDerivation.hashToBase64(hash)
                Timber.d("masterPasswordHash (base64): $masterPasswordHash")

                val deviceId = UUID.randomUUID().toString()
                val response = authApi.login(
                    LoginRequest(
                        email = email,
                        masterPasswordHash = masterPasswordHash,
                        deviceId = deviceId,
                        deviceType = "ANDROID",
                        deviceName = "Android Device"
                    )
                )

                securePrefs.putString(SecurePrefs.KEY_ACCESS_TOKEN, response.token)
                securePrefs.putString(SecurePrefs.KEY_REFRESH_TOKEN, response.refreshToken)
                securePrefs.putString(SecurePrefs.KEY_USER_ID, response.id)
                securePrefs.putString(SecurePrefs.KEY_EMAIL, email)
                securePrefs.putString(SecurePrefs.KEY_PROTECTED_KEY, response.protectedKey)
                securePrefs.putString(SecurePrefs.KEY_SECURITY_STAMP, response.securityStamp)
                securePrefs.putString(SecurePrefs.KEY_KDF_TYPE, _uiState.value.kdfType)
                securePrefs.putString(SecurePrefs.KEY_KDF_ITERATIONS, _uiState.value.kdfIterations.toString())
                _uiState.value.kdfMemory?.let { securePrefs.putString(SecurePrefs.KEY_KDF_MEMORY, it.toString()) }
                _uiState.value.kdfParallelism?.let { securePrefs.putString(SecurePrefs.KEY_KDF_PARALLELISM, it.toString()) }

                _uiState.value = _uiState.value.copy(isLoading = false)
                onSuccess()
            } catch (e: Exception) {
                Timber.e(e, "Login failed for email: $email")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "登录失败"
                )
            }
        }
    }
}

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val serverUrl: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val kdfType: String = "ARGON2ID",
    val kdfIterations: Int = 3,
    val kdfMemory: Int? = null,
    val kdfParallelism: Int? = null,
    val showPasswordField: Boolean = false
)