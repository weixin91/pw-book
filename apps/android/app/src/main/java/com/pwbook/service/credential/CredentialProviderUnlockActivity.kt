package com.pwbook.service.credential

import android.app.AlertDialog
import android.os.Bundle
import android.widget.EditText
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.domain.VaultSession
import com.pwbook.domain.usecase.UnlockVaultUseCase
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Credential Provider 场景下的保险库解锁 Activity。
 *
 * 透明 Activity；调用 BiometricUnlockManager 或主密码解锁。
 * 解锁成功后通过 [setResult(RESULT_OK)] + [finish()] 让系统重发原 BeginGetCredentialRequest。
 */
@AndroidEntryPoint
class CredentialProviderUnlockActivity : FragmentActivity() {

    @Inject lateinit var biometricUnlockManager: BiometricUnlockManager
    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var unlockVaultUseCase: UnlockVaultUseCase

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (vaultSession.isUnlocked.value) {
            setResult(RESULT_OK)
            finish()
            return
        }

        // 优先尝试生物识别解锁
        if (biometricUnlockManager.canAuthenticate() && biometricUnlockManager.isBiometricEnabled()) {
            lifecycleScope.launch {
                val result = biometricUnlockManager.authenticateAndUnlock(
                    this@CredentialProviderUnlockActivity
                )
                result.fold(
                    onSuccess = {
                        vaultSession.recordUserVerification()
                        setResult(RESULT_OK)
                        finish()
                    },
                    onFailure = { e ->
                        Timber.w(e, "Biometric unlock failed, falling back to password")
                        showPasswordDialog()
                    }
                )
            }
        } else {
            showPasswordDialog()
        }
    }

    private fun showPasswordDialog() {
        val editText = EditText(this).apply {
            hint = "主密码"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                    android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        AlertDialog.Builder(this)
            .setTitle("解锁保险库")
            .setMessage("请输入主密码以使用 Passkey")
            .setView(editText)
            .setCancelable(false)
            .setPositiveButton("解锁") { _, _ ->
                val password = editText.text.toString()
                if (password.isNotEmpty()) {
                    lifecycleScope.launch {
                        val result = unlockVaultUseCase.unlock(password)
                        result.fold(
                            onSuccess = { userKey ->
                                vaultSession.unlock(userKey)
                                vaultSession.recordUserVerification()
                                setResult(RESULT_OK)
                                finish()
                            },
                            onFailure = { e ->
                                Timber.e(e, "Password unlock failed")
                                setResult(RESULT_CANCELED)
                                finish()
                            }
                        )
                    }
                } else {
                    setResult(RESULT_CANCELED)
                    finish()
                }
            }
            .setNegativeButton("取消") { _, _ ->
                setResult(RESULT_CANCELED)
                finish()
            }
            .setOnCancelListener {
                setResult(RESULT_CANCELED)
                finish()
            }
            .show()
    }
}
