package com.pwbook.crypto

import java.security.MessageDigest
import javax.crypto.Mac
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
        val salt = email.lowercase().toByteArray(Charsets.UTF_8)
        return when (kdfType) {
            KdfType.ARGON2ID -> {
                require(memoryKb != null && parallelism != null)
                kdfEngine.deriveKeyArgon2id(
                    password.toByteArray(Charsets.UTF_8),
                    salt,
                    iterations,
                    memoryKb,
                    parallelism
                )
            }
            KdfType.PBKDF2_SHA256 -> {
                kdfEngine.deriveKeyPbkdf2(password.toCharArray(), salt, iterations)
            }
        }
    }

    fun stretchMasterKey(masterKey: ByteArray): Pair<ByteArray, ByteArray> {
        val stretched = hkdfExpand(masterKey, "enc".toByteArray(), 64)
        val encKey = stretched.copyOfRange(0, 32)
        val macKey = stretched.copyOfRange(32, 64)
        return encKey to macKey
    }

    fun hashMasterKey(masterKey: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(masterKey)
        return hash.joinToString("") { "%02x".format(it) }
    }

    private fun hkdfExpand(prk: ByteArray, info: ByteArray, length: Int): ByteArray {
        val hashLen = 32
        val n = (length + hashLen - 1) / hashLen
        var okm = ByteArray(0)
        var t = ByteArray(0)
        for (i in 1..n) {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(prk, "HmacSHA256"))
            mac.update(t)
            mac.update(info)
            mac.update(byteArrayOf(i.toByte()))
            t = mac.doFinal()
            okm += t
        }
        return okm.copyOfRange(0, length)
    }
}

enum class KdfType {
    ARGON2ID,
    PBKDF2_SHA256
}
