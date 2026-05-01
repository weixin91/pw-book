package com.pwbook.data.datasource

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.pwbook.domain.VaultSession
import kotlinx.coroutines.suspendCancellableCoroutine
import timber.log.Timber
import javax.crypto.Cipher
import kotlin.coroutines.resume

class BiometricUnlockManager(
    private val context: Context,
    private val biometricManager: BiometricManager,
    private val keystoreManager: KeystoreManager,
    private val securePrefs: SecurePrefs,
    private val vaultSession: VaultSession
) {

    fun canAuthenticate(): Boolean {
        return biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    fun isBiometricEnabled(): Boolean {
        return securePrefs.getBoolean(SecurePrefs.KEY_BIOMETRIC_UNLOCK_ENABLED, false)
    }

    /**
     * 使用生物识别验证并解锁
     */
    suspend fun authenticateAndUnlock(activity: FragmentActivity): Result<Unit> {
        if (!canAuthenticate()) {
            return Result.failure(IllegalStateException("设备不支持生物识别"))
        }
        if (!isBiometricEnabled()) {
            return Result.failure(IllegalStateException("生物识别未启用"))
        }

        val encryptedKey = securePrefs.getString(SecurePrefs.KEY_BIOMETRIC_ENCRYPTED_KEY)
        val iv = securePrefs.getString(SecurePrefs.KEY_BIOMETRIC_IV)
        if (encryptedKey == null || iv == null) {
            return Result.failure(IllegalStateException("生物识别密钥数据丢失"))
        }

        return try {
            val ivBytes = android.util.Base64.decode(iv, android.util.Base64.NO_WRAP)
            val decryptCipher = keystoreManager.getDecryptCipher(ivBytes)

            val result = showBiometricPrompt(activity, decryptCipher)
            result.fold(
                onSuccess = { authenticatedCipher ->
                    val encryptedKeyBytes = android.util.Base64.decode(encryptedKey, android.util.Base64.NO_WRAP)
                    val userKey = authenticatedCipher.doFinal(encryptedKeyBytes)
                    vaultSession.unlock(userKey)
                    Timber.i("Biometric unlock success")
                    Result.success(Unit)
                },
                onFailure = { e ->
                    Timber.e(e, "Biometric unlock failed")
                    Result.failure(e)
                }
            )
        } catch (e: Exception) {
            Timber.e(e, "Biometric unlock error")
            Result.failure(e)
        }
    }

    /**
     * 设置生物识别解锁（用主密码解锁后调用）
     */
    suspend fun setupBiometricUnlock(activity: FragmentActivity): Result<Unit> {
        if (!canAuthenticate()) {
            return Result.failure(IllegalStateException("设备不支持生物识别"))
        }

        val userKey = vaultSession.getUserKey()
            ?: return Result.failure(IllegalStateException("保险库未解锁"))

        return try {
            val encryptCipher = keystoreManager.getEncryptCipher()
            val iv = encryptCipher.iv

            // 必须先通过 BiometricPrompt 验证，才能在 auth 回调中使用 cipher
            val result = showBiometricPrompt(activity, encryptCipher)
            result.fold(
                onSuccess = { authenticatedCipher ->
                    val encryptedKey = authenticatedCipher.doFinal(userKey)
                    securePrefs.putString(
                        SecurePrefs.KEY_BIOMETRIC_ENCRYPTED_KEY,
                        android.util.Base64.encodeToString(encryptedKey, android.util.Base64.NO_WRAP)
                    )
                    securePrefs.putString(
                        SecurePrefs.KEY_BIOMETRIC_IV,
                        android.util.Base64.encodeToString(iv, android.util.Base64.NO_WRAP)
                    )
                    securePrefs.putBoolean(SecurePrefs.KEY_BIOMETRIC_UNLOCK_ENABLED, true)
                    Timber.i("Biometric unlock setup success")
                    Result.success(Unit)
                },
                onFailure = { e ->
                    Timber.e(e, "Biometric setup failed")
                    Result.failure(e)
                }
            )
        } catch (e: Exception) {
            Timber.e(e, "Biometric setup error")
            Result.failure(e)
        }
    }

    fun disableBiometricUnlock() {
        securePrefs.putBoolean(SecurePrefs.KEY_BIOMETRIC_UNLOCK_ENABLED, false)
        securePrefs.putString(SecurePrefs.KEY_BIOMETRIC_ENCRYPTED_KEY, null)
        securePrefs.putString(SecurePrefs.KEY_BIOMETRIC_IV, null)
        keystoreManager.deleteBiometricKey()
        Timber.i("Biometric unlock disabled")
    }

    private suspend fun showBiometricPrompt(
        activity: FragmentActivity,
        cipher: Cipher
    ): Result<Cipher> = suspendCancellableCoroutine { continuation ->
        val executor = ContextCompat.getMainExecutor(context)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val cryptoObject = result.cryptoObject?.cipher
                    if (cryptoObject != null) {
                        continuation.resume(Result.success(cryptoObject))
                    } else {
                        continuation.resume(Result.failure(IllegalStateException("CryptoObject 为空")))
                    }
                }

                override fun onAuthenticationFailed() {
                    continuation.resume(Result.failure(IllegalStateException("生物识别验证失败")))
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                    ) {
                        continuation.resume(Result.failure(android.os.OperationCanceledException()))
                    } else {
                        continuation.resume(Result.failure(IllegalStateException("生物识别错误: $errString")))
                    }
                }
            }
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Password Book")
            .setSubtitle("使用生物识别解锁")
            .setNegativeButtonText("取消")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()

        prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))

        continuation.invokeOnCancellation {
            prompt.cancelAuthentication()
        }
    }
}
