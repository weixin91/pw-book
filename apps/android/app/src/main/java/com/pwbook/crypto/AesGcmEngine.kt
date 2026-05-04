package com.pwbook.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class AesGcmEngine {

    companion object {
        private const val ALGORITHM = "AES"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LENGTH = 12
        private const val TAG_LENGTH = 128
    }

    fun encrypt(plaintext: ByteArray, key: ByteArray, associatedData: ByteArray? = null): ByteArray {
        val iv = ByteArray(IV_LENGTH)
        SecureRandom().nextBytes(iv)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val spec = GCMParameterSpec(TAG_LENGTH, iv)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key.aesKey(), ALGORITHM), spec)
        associatedData?.let { cipher.updateAAD(it) }
        val ciphertext = cipher.doFinal(plaintext)
        return iv + ciphertext
    }

    fun decrypt(encryptedData: ByteArray, key: ByteArray, associatedData: ByteArray? = null): ByteArray {
        require(encryptedData.size > IV_LENGTH) { "Invalid encrypted data" }
        val iv = encryptedData.copyOfRange(0, IV_LENGTH)
        val ciphertext = encryptedData.copyOfRange(IV_LENGTH, encryptedData.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val spec = GCMParameterSpec(TAG_LENGTH, iv)
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key.aesKey(), ALGORITHM), spec)
        associatedData?.let { cipher.updateAAD(it) }
        return cipher.doFinal(ciphertext)
    }

    /**
     * 与 Edge 扩展保持一致：超过 32 字节时取前 32 字节作为 AES 密钥。
     * AES-256 需要 32 字节，AES-128 需要 16 字节；64 字节的 userKey 需要截断。
     */
    private fun ByteArray.aesKey(): ByteArray = if (this.size > 32) this.copyOfRange(0, 32) else this
}
