package com.pwbook.crypto

import android.util.Base64
import java.security.KeyPairGenerator
import java.security.SecureRandom

class RsaKeyGenerator {

    fun generateKeyPair(): RsaKeyPair {
        val keyGen = KeyPairGenerator.getInstance("RSA")
        keyGen.initialize(2048, SecureRandom())
        val keyPair = keyGen.generateKeyPair()

        val publicKeySpki = Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP)
        val privateKeyPkcs8 = Base64.encodeToString(keyPair.private.encoded, Base64.NO_WRAP)

        return RsaKeyPair(
            publicKey = publicKeySpki,
            privateKey = privateKeyPkcs8
        )
    }

    fun generateUserKey(): ByteArray {
        val bytes = ByteArray(64)
        SecureRandom().nextBytes(bytes)
        return bytes
    }
}

data class RsaKeyPair(
    val publicKey: String,
    val privateKey: String
)