package com.pwbook.domain.usecase

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
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
        clipboard.setPrimaryClip(clip)
        lastCopiedPassword = password
        Timber.i("Password copied to clipboard")

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
        clipboard.setPrimaryClip(emptyClip)
        lastCopiedPassword = null
        currentClearRunnable = null
        Timber.i("Clipboard cleared after timeout")
    }

    companion object {
        private const val CLEAR_DELAY_MS = 10_000L
    }
}
