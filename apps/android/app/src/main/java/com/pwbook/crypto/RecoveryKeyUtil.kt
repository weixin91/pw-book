package com.pwbook.crypto

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

object RecoveryKeyUtil {

    private const val BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    fun generateRecoveryKey(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return base32Encode(bytes)
    }

    fun deriveRecoveryKeyHash(recoveryKey: String, email: String): String {
        val salt = sha256(email.lowercase().trim())
        val kdf = KdfEngine()
        val key = kdf.deriveKeyPbkdf2(recoveryKey.toCharArray(), salt, 100_000, 32)
        return Base64.encodeToString(key, Base64.NO_WRAP)
    }

    fun deriveRecoveryMasterKey(recoveryKey: String, email: String): ByteArray {
        val salt = sha256(email.lowercase().trim() + "recovery")
        val kdf = KdfEngine()
        return kdf.deriveKeyPbkdf2(recoveryKey.toCharArray(), salt, 600_000, 32)
    }

    private fun base32Encode(bytes: ByteArray): String {
        var bits = 0
        var value = 0
        val output = StringBuilder()
        for (b in bytes) {
            value = (value shl 8) or (b.toInt() and 0xFF)
            bits += 8
            while (bits >= 5) {
                output.append(BASE32_ALPHABET[(value ushr (bits - 5)) and 31])
                bits -= 5
            }
        }
        if (bits > 0) {
            output.append(BASE32_ALPHABET[(value shl (5 - bits)) and 31])
        }
        return output.toString().chunked(4).joinToString("-")
    }

    private fun sha256(input: String): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(input.toByteArray(Charsets.UTF_8))
    }
}
