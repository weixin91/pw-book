package com.pwbook.crypto

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class KeyDerivation(private val kdfEngine: KdfEngine) {

    fun deriveMasterKey(
        password: String,
        email: String,
        kdfType: KdfType,
        iterations: Int,
        memoryKb: Int? = null,
        parallelism: Int? = null
    ): ByteArray {
        // 与 Edge 一致：使用 SHA-256(email.lowercase()) 作为 salt
        val salt = sha256(email.lowercase().trim())
        // Edge 端 Web Crypto 原生不支持 Argon2id，统一使用 PBKDF2
        // Android 端保持一致，也使用 PBKDF2
        return kdfEngine.deriveKeyPbkdf2(password.toCharArray(), salt, iterations)
    }

    private fun sha256(input: String): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(input.toByteArray(Charsets.UTF_8))
    }

    fun stretchMasterKey(masterKey: ByteArray): Pair<ByteArray, ByteArray> {
        // HKDF-Extract: prk = HMAC-SHA256(salt=zeros, ikm=masterKey)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(ByteArray(32), "HmacSHA256"))  // salt = 32 bytes of zeros
        val prk = mac.doFinal(masterKey)

        // HKDF-Expand: 分两次派生 enc 和 mac
        val encKey = hkdfExpandBlock(prk, "enc".toByteArray())
        val macKey = hkdfExpandBlock(prk, "mac".toByteArray())
        return encKey to macKey
    }

    private fun hkdfExpandBlock(prk: ByteArray, info: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(prk, "HmacSHA256"))
        mac.update(info)
        mac.update(byteArrayOf(1))  // counter = 1
        return mac.doFinal()
    }

    /**
     * 计算登录用的密码哈希（与 Edge 端一致）
     * PBKDF2-HMAC-SHA256(masterKey, password, iterations=600000, dkLen=32)
     *
     * 注意：Edge 使用 Web Crypto API:
     *   importKey(masterKey) 作为密钥材料
     *   salt = password
     *   iterations = 600000 (OWASP 2023 推荐)
     *
     * 使用标准 PBKDF2 实现，提升至 600000 次迭代防止暴力破解
     */
    fun deriveMasterPasswordHash(masterKey: ByteArray, password: String): ByteArray {
        val spec = PBEKeySpec(
            password.toCharArray(),
            masterKey, // 将 masterKey 作为 salt（PBKDF2 的 salt 参数）
            600_000,   // OWASP 2023 推荐迭代次数
            32         // 输出 32 字节
        )
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return factory.generateSecret(spec).encoded
    }

    /**
     * 将哈希转为 Base64 字符串（用于发送到后端）
     */
    fun hashToBase64(hash: ByteArray): String {
        return android.util.Base64.encodeToString(hash, android.util.Base64.NO_WRAP)
    }
}

enum class KdfType {
    ARGON2ID,
    PBKDF2_SHA256
}
