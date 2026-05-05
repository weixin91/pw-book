package com.pwbook.domain.usecase

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CopyPasswordUseCase @Inject constructor(
    private val context: Context
) {
    private val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    private val handler = Handler(Looper.getMainLooper())
    private var currentClearRunnable: Runnable? = null
    private var lastCopiedPassword: String? = null

    /**
     * 复制密码到剪贴板，10 秒后自动清空。
     * 若 10 秒内再次复制同一密码，重置计时器。
     * 若复制不同密码，立即清空旧密码，新密码开始倒计时。
     */
    fun copyPassword(password: String) {
        // 复制不同密码时立即清空旧密码
        if (lastCopiedPassword != null && lastCopiedPassword != password) {
            clearClipboardImmediately()
        }

        val clip = ClipData.newPlainText("password", password)
        // Android 13+ 标记为敏感内容，防止剪贴板预览泄露
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            clip.description.extras = PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }
        clipboard.setPrimaryClip(clip)
        lastCopiedPassword = password
        Timber.i("Password copied to clipboard (sensitive marked)")

        // 取消之前的定时器
        currentClearRunnable?.let { handler.removeCallbacks(it) }

        val runnable = Runnable {
            clearClipboardImmediately()
        }
        currentClearRunnable = runnable
        handler.postDelayed(runnable, CLEAR_DELAY_MS)
    }

    private fun clearClipboardImmediately() {
        val emptyClip = ClipData.newPlainText("", "")
        // 清空时也标记为敏感（防止敏感标记残留）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            emptyClip.description.extras = PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false)
            }
        }
        clipboard.setPrimaryClip(emptyClip)
        lastCopiedPassword = null
        currentClearRunnable = null
        Timber.i("Clipboard cleared after timeout")
    }

    companion object {
        private const val CLEAR_DELAY_MS = 10_000L
    }
}
