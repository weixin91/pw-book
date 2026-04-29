package com.pwbook.crypto

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class KdfEngine {

    fun deriveKeyArgon2id(
        password: ByteArray,
        salt: ByteArray,
        iterations: Int = 3,
        memoryKb: Int = 65536,
        parallelism: Int = 4,
        outputLength: Int = 32
    ): ByteArray {
        val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withSalt(salt)
            .withIterations(iterations)
            .withMemoryAsKB(memoryKb)
            .withParallelism(parallelism)
            .withVersion(Argon2Parameters.ARGON2_VERSION_13)
            .build()
        val generator = Argon2BytesGenerator()
        generator.init(params)
        val result = ByteArray(outputLength)
        generator.generateBytes(password, result)
        SecureMemory.clear(password)
        return result
    }

    fun deriveKeyPbkdf2(
        password: CharArray,
        salt: ByteArray,
        iterations: Int = 600000,
        outputLength: Int = 32
    ): ByteArray {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password, salt, iterations, outputLength * 8)
        val key = factory.generateSecret(spec).encoded
        SecureMemory.clear(password)
        return key
    }

    fun generateSalt(length: Int = 16): ByteArray {
        val bytes = ByteArray(length)
        SecureRandom().nextBytes(bytes)
        return bytes
    }
}
