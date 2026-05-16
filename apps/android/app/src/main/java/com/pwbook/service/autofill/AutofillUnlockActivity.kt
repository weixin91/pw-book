package com.pwbook.service.autofill

import android.app.AlertDialog
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.Bundle
import android.view.autofill.AutofillManager
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
 * Autofill 场景下的保险库解锁 Activity。
 *
 * 透明 Activity；不绘制任何 UI,只承载 BiometricPrompt 与主密码 AlertDialog。
 * 解锁成功后:基于 Autofill 框架自动注入的 AssistStructure 构造 FillResponse,
 * 通过 setResult(RESULT_OK, intent.putExtra(EXTRA_AUTHENTICATION_RESULT, fillResponse))
 * 让框架立刻把真正的候选 dataset 浮到 IME(用户仍需主动点选,不主动填值)。
 */
@AndroidEntryPoint
class AutofillUnlockActivity : FragmentActivity() {

    @Inject lateinit var biometricUnlockManager: BiometricUnlockManager
    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var unlockVaultUseCase: UnlockVaultUseCase
    @Inject lateinit var autofillFillResponseBuilder: AutofillFillResponseBuilder

    private var parsedStructure: ParsedStructure? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 故意不调用 setContent / setContentView:保持窗口透明,只浮系统弹窗。

        // Autofill 框架在拉起 auth Activity 时会自动注入最新的 AssistStructure。
        val structure: AssistStructure? = intent.getParcelableExtra(
            AutofillManager.EXTRA_ASSIST_STRUCTURE,
            AssistStructure::class.java
        )
        parsedStructure = structure?.let {
            try {
                StructureParser.parse(it)
            } catch (e: Exception) {
                Timber.e(e, "AutofillUnlockActivity: failed to parse AssistStructure")
                null
            }
        }
        if (parsedStructure == null) {
            Timber.w("AutofillUnlockActivity: AssistStructure missing or unparsable")
        }

        if (vaultSession.isUnlocked.value) {
            finishWithFillResponse()
            return
        }

        if (biometricUnlockManager.canAuthenticate() &&
            biometricUnlockManager.isBiometricEnabled()
        ) {
            lifecycleScope.launch {
                val result = biometricUnlockManager.authenticateAndUnlock(
                    this@AutofillUnlockActivity
                )
                result.fold(
                    onSuccess = { finishWithFillResponse() },
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
            .setMessage("请输入主密码以填充凭据")
            .setView(editText)
            .setCancelable(false)
            .setPositiveButton("解锁") { _, _ ->
                val password = editText.text.toString()
                if (password.isEmpty()) {
                    setResult(RESULT_CANCELED)
                    finish()
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    val result = unlockVaultUseCase.unlock(password)
                    result.fold(
                        onSuccess = { userKey ->
                            vaultSession.unlock(userKey)
                            finishWithFillResponse()
                        },
                        onFailure = { e ->
                            Timber.e(e, "Password unlock failed")
                            setResult(RESULT_CANCELED)
                            finish()
                        }
                    )
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

    /**
     * 解锁成功后基于缓存的 ParsedStructure 构造 FillResponse,
     * 通过 EXTRA_AUTHENTICATION_RESULT 回传给 Autofill 框架,
     * 框架立刻把真正的候选 dataset 浮到 IME(由用户主动点选)。
     *
     * 若 AssistStructure 缺失或 builder 返回 null,则退化为 setResult(RESULT_OK) 空 intent。
     */
    private fun finishWithFillResponse() {
        val parsed = parsedStructure
        if (parsed == null) {
            setResult(RESULT_OK)
            finish()
            return
        }
        lifecycleScope.launch {
            val resultIntent = Intent()
            try {
                val fillResponse = autofillFillResponseBuilder.build(
                    this@AutofillUnlockActivity,
                    parsed
                )
                if (fillResponse != null) {
                    resultIntent.putExtra(
                        AutofillManager.EXTRA_AUTHENTICATION_RESULT,
                        fillResponse
                    )
                } else {
                    Timber.w("AutofillUnlockActivity: builder returned null, returning empty result")
                }
            } catch (e: Exception) {
                Timber.e(e, "AutofillUnlockActivity: failed to build FillResponse")
            }
            setResult(RESULT_OK, resultIntent)
            finish()
        }
    }
}
