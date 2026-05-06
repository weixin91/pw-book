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
        // 与 Edge 一致：使用 SHA-256(email.lowercase().trim()) 作为 salt
        val salt = sha256(email.lowercase().trim())
        return when (kdfType) {
            KdfType.ARGON2ID -> kdfEngine.deriveKeyArgon2id(
                password.toByteArray(Charsets.UTF_8),
                salt,
                iterations,
                memoryKb ?: 65536,
                parallelism ?: 4,
                32
            )
            KdfType.PBKDF2_SHA256 -> kdfEngine.deriveKeyPbkdf2(
                password.toCharArray(),
                salt,
                iterations
            )
        }
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
     *   importKey(masterKey) 作为 PBKDF2 的 password（HMAC 密钥）
     *   salt = password 的 UTF-8 bytes
     *   iterations = 600000 (OWASP 2023 推荐)
     *
     * Java 的 PBEKeySpec 固定 password/salt 角色不可调换，因此手动实现 PBKDF2。
     */
    fun deriveMasterPasswordHash(masterKey: ByteArray, password: String): ByteArray {
        return pbkdf2HmacSha256(
            password = masterKey,
            salt = password.toByteArray(Charsets.UTF_8),
            iterations = 600_000,
            dkLen = 32
        )
    }

    /**
     * PBKDF2-HMAC-SHA256（RFC 2898）
     * password = HMAC 密钥，salt = 盐值
     */
    private fun pbkdf2HmacSha256(password: ByteArray, salt: ByteArray, iterations: Int, dkLen: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password, "HmacSHA256"))

        val blockCount = (dkLen + 31) / 32 // SHA-256 输出 32 字节
        val result = ByteArray(dkLen)

        for (i in 1..blockCount) {
            // U_1 = HMAC(password, salt || INT_32_BE(i))
            val block = ByteArray(salt.size + 4)
            salt.copyInto(block, 0)
            block[salt.size] = (i ushr 24).toByte()
            block[salt.size + 1] = (i ushr 16).toByte()
            block[salt.size + 2] = (i ushr 8).toByte()
            block[salt.size + 3] = i.toByte()

            var u = mac.doFinal(block)
            val xor = u.copyOf()

            // U_2 .. U_c（迭代 iterations-1 次）
            repeat(iterations - 1) {
                u = mac.doFinal(u)
                for (j in xor.indices) {
                    xor[j] = (xor[j].toInt() xor u[j].toInt()).toByte()
                }
            }

            val copyLen = minOf(32, dkLen - (i - 1) * 32)
            xor.copyInto(result, (i - 1) * 32, 0, copyLen)
        }

        return result
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
