package com.pwbook.crypto

import android.util.Base64

class VaultEncryption(private val aesGcmEngine: AesGcmEngine) {

    fun encryptString(plaintext: String, key: ByteArray): String {
        val encrypted = aesGcmEngine.encrypt(plaintext.toByteArray(Charsets.UTF_8), key)
        return Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    fun decryptString(ciphertext: String, key: ByteArray): String {
        val encrypted = Base64.decode(ciphertext, Base64.NO_WRAP)
        val decrypted = aesGcmEngine.decrypt(encrypted, key)
        return String(decrypted, Charsets.UTF_8)
    }

    fun encryptBytes(plaintext: ByteArray, key: ByteArray): ByteArray {
        return aesGcmEngine.encrypt(plaintext, key)
    }

    fun decryptBytes(ciphertext: ByteArray, key: ByteArray): ByteArray {
        return aesGcmEngine.decrypt(ciphertext, key)
    }
}