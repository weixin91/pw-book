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
     * PBKDF2-HMAC-SHA256(masterKey, password, iterations=1, dkLen=32)
     *
     * 注意：Edge 使用 Web Crypto API:
     *   importKey(masterKey) 作为密钥材料
     *   salt = password
     *   iterations = 1
     *
     * Java PBEKeySpec 无法直接用 byte[] 作为密钥材料，需要手动实现
     */
    fun deriveMasterPasswordHash(masterKey: ByteArray, password: String): ByteArray {
        // PBKDF2 只迭代 1 次，输出 32 字节
        // PBKDF2(password, salt, c, dkLen) 定义：
        //   DK = T1 || T2 || ... || TdkLen/hlen
        //   Ti = F(password, salt, c, i)
        //   F = U1 ^ U2 ^ ... ^ Uc
        //   U1 = PRF(password, salt || INT(i))
        // 当 c=1 且 dkLen <= hLen(32)，只需一个 block：
        //   DK = HMAC-SHA256(masterKey, password || INT(1))

        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(masterKey, "HmacSHA256"))
        mac.update(password.toByteArray(Charsets.UTF_8))
        // INT(i) 是 4 字节大端序，i=1
        mac.update(byteArrayOf(0, 0, 0, 1))
        return mac.doFinal()
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
