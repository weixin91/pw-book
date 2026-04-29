package com.pwbook.domain.usecase

import java.security.SecureRandom
import javax.inject.Inject

class GeneratePasswordUseCase @Inject constructor() {

    fun execute(
        length: Int = 16,
        uppercase: Boolean = true,
        lowercase: Boolean = true,
        numbers: Boolean = true,
        special: Boolean = true,
        excludeAmbiguous: Boolean = true,
        minNumbers: Int = 1,
        minSpecial: Int = 1
    ): String {
        val random = SecureRandom()
        val ambiguousChars = setOf('0', 'O', '1', 'l', 'I')

        val upperChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".filter { !excludeAmbiguous || it !in ambiguousChars }
        val lowerChars = "abcdefghijklmnopqrstuvwxyz".filter { !excludeAmbiguous || it !in ambiguousChars }
        val numberChars = "0123456789".filter { !excludeAmbiguous || it !in ambiguousChars }
        val specialChars = "!@#$%^&*()_+-=[]{}|;:,.<>?"

        val pool = buildString {
            if (uppercase) append(upperChars)
            if (lowercase) append(lowerChars)
            if (numbers) append(numberChars)
            if (special) append(specialChars)
        }
        require(pool.isNotEmpty()) { "至少选择一种字符类型" }

        val password = mutableListOf<Char>()
        repeat(minNumbers) { password.add(numberChars.random(random)) }
        repeat(minSpecial) { password.add(specialChars.random(random)) }
        while (password.size < length) {
            password.add(pool.random(random))
        }
        password.shuffle(random)
        return password.joinToString("")
    }
}
