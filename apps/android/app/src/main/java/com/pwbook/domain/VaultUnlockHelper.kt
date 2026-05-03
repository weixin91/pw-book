package com.pwbook.domain

import android.app.AlertDialog
import android.widget.EditText
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.domain.usecase.UnlockVaultUseCase
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * 保险库解锁辅助类，封装生物识别和密码两种解锁方式。
 */
@Singleton
class VaultUnlockHelper @Inject constructor(
    private val biometricUnlockManager: BiometricUnlockManager,
    private val unlockVaultUseCase: UnlockVaultUseCase,
    private val vaultSession: VaultSession
) {

    /**
     * 尝试解锁保险库。优先生物识别，失败或不可用时回退到密码对话框。
     */
    suspend fun unlock(activity: FragmentActivity): Boolean {
        if (biometricUnlockManager.canAuthenticate() && biometricUnlockManager.isBiometricEnabled()) {
            val result = biometricUnlockManager.authenticateAndUnlock(activity)
            return result.fold(
                onSuccess = {
                    vaultSession.recordUserVerification()
                    true
                },
                onFailure = { false }
            )
        }
        return showPasswordDialog(activity)
    }

    private suspend fun showPasswordDialog(activity: FragmentActivity): Boolean {
        return suspendCancellableCoroutine { continuation ->
            val editText = EditText(activity).apply {
                hint = "主密码"
                inputType = android.text.InputType.TYPE_CLASS_TEXT or
                    android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            }

            val dialog = AlertDialog.Builder(activity)
                .setTitle("解锁保险库")
                .setMessage("请输入主密码")
                .setView(editText)
                .setCancelable(false)
                .setPositiveButton("解锁") { _, _ ->
                    val password = editText.text.toString()
                    if (password.isNotEmpty()) {
                        activity.lifecycleScope.launch {
                            val result = unlockVaultUseCase.unlock(password)
                            result.fold(
                                onSuccess = { userKey ->
                                    vaultSession.unlock(userKey)
                                    vaultSession.recordUserVerification()
                                    continuation.resume(true)
                                },
                                onFailure = { e ->
                                    Timber.e(e, "Password unlock failed")
                                    continuation.resume(false)
                                }
                            )
                        }
                    } else {
                        continuation.resume(false)
                    }
                }
                .setNegativeButton("取消") { _, _ ->
                    continuation.resume(false)
                }
                .setOnCancelListener {
                    continuation.resume(false)
                }
                .create()

            dialog.show()

            continuation.invokeOnCancellation {
                dialog.dismiss()
            }
        }
    }
}
