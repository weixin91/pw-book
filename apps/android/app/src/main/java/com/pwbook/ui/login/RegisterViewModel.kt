package com.pwbook.ui.login

import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.crypto.KdfType
import com.pwbook.crypto.KeyDerivation
import com.pwbook.crypto.RecoveryKeyUtil
import com.pwbook.BuildConfig
import com.pwbook.crypto.RsaKeyGenerator
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.remote.api.AuthApi
import com.pwbook.data.remote.api.RegisterRequest
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
class RegisterViewModel @Inject constructor(
    private val authApi: AuthApi,
    private val keyDerivation: KeyDerivation,
    private val rsaKeyGenerator: RsaKeyGenerator,
    private val vaultEncryption: VaultEncryption,
    private val settingsRepository: SettingsRepository,
    private val securePrefs: SecurePrefs
) : ViewModel() {

    private val _uiState = MutableStateFlow(RegisterUiState())
    val uiState: StateFlow<RegisterUiState> = _uiState.asStateFlow()

    init {
        // 仅当缓存的是旧版模拟器默认地址时才覆盖，保留用户自定义地址
        val savedUrl = settingsRepository.getServerUrl()
        val serverUrl = if (savedUrl == "http://10.0.2.2:3000/" || savedUrl == "http://10.0.2.2:3000") {
            settingsRepository.setServerUrl(BuildConfig.DEFAULT_SERVER_URL)
            BuildConfig.DEFAULT_SERVER_URL
        } else {
            savedUrl ?: BuildConfig.DEFAULT_SERVER_URL
        }
        _uiState.value = _uiState.value.copy(serverUrl = serverUrl)
    }

    fun onEmailChange(email: String) {
        _uiState.value = _uiState.value.copy(email = email, error = null)
    }

    fun onPasswordChange(password: String) {
        _uiState.value = _uiState.value.copy(password = password, error = null)
    }

    fun onServerUrlChange(url: String) {
        _uiState.value = _uiState.value.copy(serverUrl = url, error = null)
    }

    fun register(onSuccess: () -> Unit) {
        val email = _uiState.value.email.trim()
        val password = _uiState.value.password

        if (email.isBlank() || password.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "请填写所有字段")
            return
        }

        if (!email.contains("@")) {
            _uiState.value = _uiState.value.copy(error = "请输入有效的邮箱地址")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val serverUrl = _uiState.value.serverUrl.trim()
                if (serverUrl.isNotBlank()) {
                    settingsRepository.setServerUrl(serverUrl)
                }

                val kdfType = KdfType.ARGON2ID
                val iterations = 3
                val memoryKb = 65536
                val parallelism = 4

                val masterKey = keyDerivation.deriveMasterKey(
                    password = password,
                    email = email,
                    kdfType = kdfType,
                    iterations = iterations,
                    memoryKb = memoryKb,
                    parallelism = parallelism
                )

                val (encKey, _) = keyDerivation.stretchMasterKey(masterKey)

                val userKey = rsaKeyGenerator.generateUserKey()
                val rsaKeyPair = rsaKeyGenerator.generateKeyPair()

                val protectedKey = vaultEncryption.encryptString(
                    Base64.encodeToString(userKey, Base64.NO_WRAP),
                    encKey
                )

                val encryptedPrivateKey = vaultEncryption.encryptString(
                    rsaKeyPair.privateKey,
                    userKey
                )

                // 使用与 Edge 一致的密码哈希计算方式
                val hash = keyDerivation.deriveMasterPasswordHash(masterKey, password)
                val masterPasswordHash = keyDerivation.hashToBase64(hash)

                val recoveryKey = RecoveryKeyUtil.generateRecoveryKey()
                val recoveryKeyHash = RecoveryKeyUtil.deriveRecoveryKeyHash(recoveryKey, email)
                val recoveryMasterKey = RecoveryKeyUtil.deriveRecoveryMasterKey(recoveryKey, email)
                val encryptedRecoveryKeyBytes = vaultEncryption.encryptBytes(userKey, recoveryMasterKey)
                val encryptedRecoveryKey = Base64.encodeToString(encryptedRecoveryKeyBytes, Base64.NO_WRAP)

                val response = authApi.register(
                    RegisterRequest(
                        email = email,
                        masterPasswordHash = masterPasswordHash,
                        protectedKey = protectedKey,
                        publicKey = rsaKeyPair.publicKey,
                        encryptedPrivateKey = encryptedPrivateKey,
                        kdfType = kdfType.name,
                        kdfIterations = iterations,
                        kdfMemory = memoryKb,
                        kdfParallelism = parallelism,
                        recoveryKeyHash = recoveryKeyHash,
                        encryptedRecoveryKey = encryptedRecoveryKey,
                        deviceId = UUID.randomUUID().toString(),
                        deviceType = "ANDROID",
                        deviceName = "Android Device"
                    )
                )

                securePrefs.putString(SecurePrefs.KEY_ACCESS_TOKEN, response.token)
                securePrefs.putString(SecurePrefs.KEY_REFRESH_TOKEN, response.refreshToken)
                securePrefs.putString(SecurePrefs.KEY_EMAIL, email)
                securePrefs.putString(SecurePrefs.KEY_USER_ID, response.id)
                securePrefs.putString(SecurePrefs.KEY_PROTECTED_KEY, response.protectedKey)
                securePrefs.putString(SecurePrefs.KEY_KDF_TYPE, kdfType.name)
                securePrefs.putString(SecurePrefs.KEY_KDF_ITERATIONS, iterations.toString())
                securePrefs.putString(SecurePrefs.KEY_KDF_MEMORY, memoryKb.toString())
                securePrefs.putString(SecurePrefs.KEY_KDF_PARALLELISM, parallelism.toString())

                _uiState.value = _uiState.value.copy(isLoading = false, recoveryKey = recoveryKey)
                onSuccess()
            } catch (e: Exception) {
                Timber.e(e, "Register failed for email: $email")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "注册失败"
                )
            }
        }
    }
}

data class RegisterUiState(
    val email: String = "",
    val password: String = "",
    val serverUrl: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val recoveryKey: String? = null
)