package com.pwbook.crypto

class VaultEncryption(private val aesGcmEngine: AesGcmEngine) {

    fun encryptString(plaintext: String, key: ByteArray): String {
        val encrypted = aesGcmEngine.encrypt(plaintext.toByteArray(Charsets.UTF_8), key)
        return java.util.Base64.getEncoder().encodeToString(encrypted)
    }

    fun decryptString(ciphertext: String, key: ByteArray): String {
        val encrypted = java.util.Base64.getDecoder().decode(ciphertext)
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