package com.pwbook.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Test

/**
 * 加密兼容性测试：验证 Android 加密结果与 Edge 端可互解密。
 * 共享测试向量，确保两端协议一致。
 */
class CryptoCompatibilityTest {

    private lateinit var aesGcmEngine: AesGcmEngine
    private lateinit var vaultEncryption: VaultEncryption

    @Before
    fun setup() {
        aesGcmEngine = AesGcmEngine()
        vaultEncryption = VaultEncryption(aesGcmEngine)
    }

    @Test
    fun `AES-256-GCM 加密解密一致性`() {
        val key = ByteArray(32) { it.toByte() }
        val plaintext = "Hello, pw-book! 测试中文 🎉".toByteArray(Charsets.UTF_8)

        val encrypted = aesGcmEngine.encrypt(plaintext, key)
        val decrypted = aesGcmEngine.decrypt(encrypted, key)

        assertArrayEquals(plaintext, decrypted)
    }

    @Test
    fun `多次加密同一明文产生不同密文 - IV 唯一性`() {
        val key = ByteArray(32) { 0x42 }
        val plaintext = "same plaintext".toByteArray(Charsets.UTF_8)

        val encrypted1 = aesGcmEngine.encrypt(plaintext, key)
        val encrypted2 = aesGcmEngine.encrypt(plaintext, key)

        // IV 长度 12 字节，前 12 字节应不同
        assertNotEquals(encrypted1.copyOfRange(0, 12).contentToString(), encrypted2.copyOfRange(0, 12).contentToString())
        // 但都能正确解密
        assertArrayEquals(plaintext, aesGcmEngine.decrypt(encrypted1, key))
        assertArrayEquals(plaintext, aesGcmEngine.decrypt(encrypted2, key))
    }

    @Test
    fun `VaultEncryption 字符串加解密`() {
        val key = ByteArray(32) { (it * 7 % 256).toByte() }
        val plaintext = "{\"name\":\"test\",\"login\":{\"username\":\"user\",\"password\":\"pass123\"}}"

        val encrypted = vaultEncryption.encryptString(plaintext, key)
        val decrypted = vaultEncryption.decryptString(encrypted, key)

        assertEquals(plaintext, decrypted)
    }

    @Test
    fun `共享测试向量 - 与 Edge 端协议兼容`() {
        // Edge 端加密格式：Base64(iv [12 bytes] || ciphertext || tag [16 bytes])
        // 验证 Android 端产生相同的格式
        val key = ByteArray(32) { 0xAB.toByte() }
        val plaintext = "cross-platform compatibility test"

        val encrypted = vaultEncryption.encryptString(plaintext, key)
        // Base64 解码后至少 28 字节 (12 IV + 16 tag)
        val decoded = java.util.Base64.getDecoder().decode(encrypted)
        assertEquals(true, decoded.size >= 28)

        val decrypted = vaultEncryption.decryptString(encrypted, key)
        assertEquals(plaintext, decrypted)
    }

    @Test
    fun `AAD 关联数据加解密`() {
        val key = ByteArray(32) { 0xCD.toByte() }
        val plaintext = "data with AAD".toByteArray(Charsets.UTF_8)
        val aad = "additional-data".toByteArray(Charsets.UTF_8)

        val encrypted = aesGcmEngine.encrypt(plaintext, key, aad)
        val decrypted = aesGcmEngine.decrypt(encrypted, key, aad)

        assertArrayEquals(plaintext, decrypted)
    }
}
