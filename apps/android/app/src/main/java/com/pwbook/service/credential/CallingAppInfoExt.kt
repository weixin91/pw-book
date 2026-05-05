package com.pwbook.service.credential

import android.util.Base64
import androidx.credentials.provider.CallingAppInfo
import timber.log.Timber
import java.security.MessageDigest

/**
 * 计算原生 app 的 origin（android:apk-key-hash）。
 * 与 Bitwarden 做法对齐：取签名证书 SHA-256 后 Base64Url 编码。
 */
fun CallingAppInfo.resolveAppOrigin(): String? {
    return try {
        if (signingInfo.hasMultipleSigners()) return null
        val signature = signingInfo.apkContentsSigners?.firstOrNull() ?: return null
        val md = MessageDigest.getInstance("SHA-256")
        val hash = md.digest(signature.toByteArray())
        val encoded = Base64.encodeToString(
            hash,
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        "android:apk-key-hash:$encoded"
    } catch (e: Exception) {
        Timber.w(e, "Failed to resolve app origin")
        null
    }
}
