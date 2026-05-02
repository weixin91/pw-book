package com.pwbook.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec

/**
 * Passkey 加密兼容性测试。
 * 与 Edge 端 passkey-storage.test.ts 共享测试向量。
 */
class PasskeyCryptoTest {

    /**
     * 测试 1：importPrivateKey 解析 PKCS#8 成功，且可正常签名。
     */
    @Test
    fun testImportPrivateKey_andSign() {
        val keyPair = generateTestKeyPair()
        val pkcs8Base64 = PasskeyCrypto.base64Encode(keyPair.private.encoded)

        val imported = PasskeyCrypto.importPrivateKey(pkcs8Base64)
        assertNotNull(imported)

        val authData = ByteArray(37) { 0xAB.toByte() }
        val clientDataHash = ByteArray(32) { 0xCD.toByte() }

        val signature = PasskeyCrypto.signAssertion(imported, authData, clientDataHash)

        // DER 签名结构验证：首字节 0x30 (SEQUENCE)
        assertEquals(0x30.toByte(), signature[0])

        // 验证签名可被对应公钥验证
        val verified = PasskeyCrypto.verifyAssertion(
            keyPair.public,
            authData,
            clientDataHash,
            signature
        )
        assertTrue("签名应被对应公钥验证通过", verified)
    }

    /**
     * 测试 2：signAssertion 输出 DER 结构，且可被 importPublicKey 导入的公钥验证。
     */
    @Test
    fun testSignAssertion_DerStructureAndVerification() {
        val keyPair = generateTestKeyPair()
        val spkiBase64 = PasskeyCrypto.base64Encode(keyPair.public.encoded)
        val pkcs8Base64 = PasskeyCrypto.base64Encode(keyPair.private.encoded)

        val importedPrivate = PasskeyCrypto.importPrivateKey(pkcs8Base64)
        val importedPublic = PasskeyCrypto.importPublicKey(spkiBase64)

        val authData = "test authenticator data".toByteArray(Charsets.UTF_8)
        val clientDataHash = ByteArray(32).apply { SecureRandom().nextBytes(this) }

        val signature = PasskeyCrypto.signAssertion(importedPrivate, authData, clientDataHash)

        // DER SEQUENCE
        assertEquals(0x30.toByte(), signature[0])
        // 总长度字节
        assertTrue("签名长度应大于8", signature.size > 8)

        val verified = PasskeyCrypto.verifyAssertion(importedPublic, authData, clientDataHash, signature)
        assertTrue("导入的公钥应能验证签名", verified)
    }

    /**
     * 测试 3：encodeCoseKeyEs256 对已知 (x, y) 输出与 Edge 端字节级一致。
     * Edge 端：encodeCoseKeyEs256(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2))
     */
    @Test
    fun testEncodeCoseKeyEs256_MatchesEdge() {
        val x = ByteArray(32) { 0x01 }
        val y = ByteArray(32) { 0x02 }

        val coseKey = CborEncoder.encodeCoseKeyEs256(x, y)

        val expected = byteArrayOf(
            0xA5.toByte(), 0x01, 0x02, 0x03, 0x26, 0x20, 0x01,
            0x21, 0x58, 0x20.toByte(), *x,
            0x22, 0x58, 0x20.toByte(), *y
        )
        assertArrayEquals(expected, coseKey)
    }

    /**
     * 测试 4a：buildAuthenticatorData(create) flags=0x41 且包含 attestedCredentialData。
     */
    @Test
    fun testBuildAuthenticatorData_createFlags() {
        val credentialId = ByteArray(16) { it.toByte() }
        val publicKeyCose = ByteArray(77) { 0xAA.toByte() }

        val authData = PasskeyCrypto.buildAuthenticatorData(
            rpId = "example.com",
            signCount = 0,
            includeAttestedCredentialData = true,
            credentialId = credentialId,
            publicKeyCose = publicKeyCose
        )

        // rpIdHash = 32 bytes, flags = 1 byte, signCount = 4 bytes
        assertTrue("authData 应大于37字节", authData.size > 37)

        // flags at offset 32
        val flags = authData[32].toInt() and 0xFF
        assertEquals("Create 时 flags 应为 0x41 (UP+AT)", 0x41, flags)

        // 应包含 attestedCredentialData：aaguid(16) + credIdLen(2) + credId + publicKeyCose
        val expectedSize = 32 + 1 + 4 + 16 + 2 + credentialId.size + publicKeyCose.size
        assertEquals(expectedSize.toLong(), authData.size.toLong())
    }

    /**
     * 测试 4b：buildAuthenticatorData(get) flags=0x05 且不含 attestedCredentialData。
     */
    @Test
    fun testBuildAuthenticatorData_getFlags() {
        val authData = PasskeyCrypto.buildAuthenticatorData(
            rpId = "example.com",
            signCount = 42,
            includeAttestedCredentialData = false
        )

        assertEquals(37, authData.size.toLong()) // 32 + 1 + 4

        val flags = authData[32].toInt() and 0xFF
        assertEquals("Get 时 flags 应为 0x05 (UP+UV)", 0x05, flags)

        // signCount = 42
        val signCount = ((authData[33].toInt() and 0xFF) shl 24) or
                ((authData[34].toInt() and 0xFF) shl 16) or
                ((authData[35].toInt() and 0xFF) shl 8) or
                (authData[36].toInt() and 0xFF)
        assertEquals(42, signCount)
    }

    /**
     * 测试 5：encodeAttestationObjectNone CBOR 输出与 Edge 端字节级一致。
     */
    @Test
    fun testEncodeAttestationObjectNone_MatchesEdge() {
        val authData = byteArrayOf(0x01, 0x02, 0x03, 0x04)
        val attObj = CborEncoder.encodeAttestationObjectNone(authData)

        // 手动构建预期字节（与 Edge 端一致）
        val expected = mutableListOf<Byte>()
        expected.add(0xA3.toByte()) // map(3)

        // "fmt" -> "none"
        CborEncoder.pushCborTextString(expected, "fmt")
        CborEncoder.pushCborTextString(expected, "none")

        // "attStmt" -> {}
        CborEncoder.pushCborTextString(expected, "attStmt")
        expected.add(0xA0.toByte()) // empty map

        // "authData" -> authData
        CborEncoder.pushCborTextString(expected, "authData")
        CborEncoder.pushCborByteString(expected, authData)

        assertArrayEquals(expected.toByteArray(), attObj)
    }

    /**
     * 测试 6：Base64Url 编解码与 Edge 端一致。
     */
    @Test
    fun testBase64UrlRoundTrip() {
        val data = ByteArray(32).apply { SecureRandom().nextBytes(this) }
        val encoded = PasskeyCrypto.base64UrlEncode(data)

        // 无 padding
        assertTrue(!encoded.contains("="))
        assertTrue(!encoded.contains("+"))
        assertTrue(!encoded.contains("/"))

        val decoded = PasskeyCrypto.base64UrlDecode(encoded)
        assertArrayEquals(data, decoded)
    }

    /**
     * 测试 7：buildClientDataJSON 格式正确。
     */
    @Test
    fun testBuildClientDataJSON() {
        val json = PasskeyCrypto.buildClientDataJSON(
            type = "webauthn.create",
            challenge = "test-challenge",
            origin = "https://example.com"
        )
        assertTrue(json.contains("\"type\":\"webauthn.create\""))
        assertTrue(json.contains("\"challenge\":\"test-challenge\""))
        assertTrue(json.contains("\"origin\":\"https://example.com\""))
        assertTrue(json.contains("\"crossOrigin\":false"))
    }

    private fun generateTestKeyPair(): java.security.KeyPair {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"), SecureRandom())
        return generator.generateKeyPair()
    }
}
