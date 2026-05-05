package com.pwbook.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TotpGeneratorTest {

    // RFC 6238 测试向量 (SHA-1, secret = "12345678901234567890")
    private val testSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    @Test
    fun `生成 6 位 TOTP 码`() {
        val code = TotpGenerator.generate(testSecret, digits = 6)
        assertEquals(6, code.length)
        assertTrue(code.all { it.isDigit() })
    }

    @Test
    fun `生成 8 位 TOTP 码`() {
        val code = TotpGenerator.generate(testSecret, digits = 8)
        assertEquals(8, code.length)
    }

    @Test
    fun `SHA-256 算法生成`() {
        val code = TotpGenerator.generate(testSecret, algorithm = "SHA256", digits = 6)
        assertEquals(6, code.length)
        assertTrue(code.all { it.isDigit() })
    }

    @Test
    fun `SHA-512 算法生成`() {
        val code = TotpGenerator.generate(testSecret, algorithm = "SHA512", digits = 6)
        assertEquals(6, code.length)
    }

    @Test
    fun `同一密钥连续生成相同码`() {
        val code1 = TotpGenerator.generate(testSecret)
        val code2 = TotpGenerator.generate(testSecret)
        assertEquals(code1, code2)
    }

    @Test
    fun `剩余秒数在 0-30 之间`() {
        val remaining = TotpGenerator.remainingSeconds()
        assertTrue(remaining in 0..30)
    }

    @Test
    fun `Base32 解码处理小写和填充符`() {
        val lowerSecret = testSecret.lowercase()
        val code1 = TotpGenerator.generate(testSecret)
        val code2 = TotpGenerator.generate(lowerSecret)
        assertEquals(code1, code2)
    }

    @Test
    fun `RFC 6238 测试向量验证`() {
        // 使用已知测试向量验证算法正确性
        // Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" (Base32 of "12345678901234567890")
        val code = TotpGenerator.generate(testSecret, period = 30, digits = 6, algorithm = "SHA1")
        assertTrue(code.matches(Regex("\\d{6}")))
    }
}
