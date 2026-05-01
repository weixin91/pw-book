package com.pwbook.domain.usecase

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PasswordGeneratorTest {

    private lateinit var generator: GeneratePasswordUseCase

    @Before
    fun setup() {
        generator = GeneratePasswordUseCase()
    }

    @Test
    fun `默认参数生成 16 位密码`() {
        val password = generator.execute()
        assertEquals(16, password.length)
    }

    @Test
    fun `指定长度生成正确位数`() {
        val password = generator.execute(length = 32)
        assertEquals(32, password.length)
    }

    @Test
    fun `包含至少一个数字`() {
        val password = generator.execute(length = 20, minNumbers = 2)
        val digitCount = password.count { it.isDigit() }
        assertTrue(digitCount >= 2)
    }

    @Test
    fun `包含至少一个特殊字符`() {
        val password = generator.execute(length = 20, minSpecial = 2)
        val specialCount = password.count { it in "!@#\$%^&*()_+-=[]{}|;:,.<>?" }
        assertTrue(specialCount >= 2)
    }

    @Test
    fun `排除易混淆字符`() {
        val ambiguous = setOf('0', 'O', '1', 'l', 'I')
        val password = generator.execute(excludeAmbiguous = true)
        assertTrue(password.none { it in ambiguous })
    }

    @Test
    fun `仅小写字母`() {
        val password = generator.execute(
            uppercase = false,
            numbers = false,
            special = false,
            minNumbers = 0,
            minSpecial = 0
        )
        assertTrue(password.all { it.isLowerCase() })
    }

    @Test
    fun `每次生成不同密码`() {
        val p1 = generator.execute()
        val p2 = generator.execute()
        assertTrue(p1 != p2)
    }

    @Test
    fun `大长度密码性能`() {
        val start = System.currentTimeMillis()
        repeat(100) {
            generator.execute(length = 64)
        }
        val elapsed = System.currentTimeMillis() - start
        assertTrue("100 次 64 位密码生成应小于 1 秒", elapsed < 1000)
    }
}
