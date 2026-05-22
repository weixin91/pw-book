package com.pwbook.crypto

import java.math.BigInteger
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Passkey 加密与签名核心。
 * 与 Edge 端 passkey-storage.ts 输出格式逐字节/逐结构对齐。
 */
object PasskeyCrypto {

    /**
     * 从 PKCS#8 Base64 导入 EC P-256 私钥。
     * 与 Edge 端 crypto.subtle.exportKey("pkcs8", ...) 输出兼容。
     */
    fun importPrivateKey(pkcs8Base64: String): PrivateKey {
        val pkcs8Bytes = Base64.getDecoder().decode(pkcs8Base64)
        val keySpec = PKCS8EncodedKeySpec(pkcs8Bytes)
        val keyFactory = KeyFactory.getInstance("EC")
        return keyFactory.generatePrivate(keySpec)
    }

    /**
     * 从 SPKI Base64 导入 EC P-256 公钥。
     */
    fun importPublicKey(spkiBase64: String): java.security.PublicKey {
        val spkiBytes = Base64.getDecoder().decode(spkiBase64)
        val keySpec = X509EncodedKeySpec(spkiBytes)
        val keyFactory = KeyFactory.getInstance("EC")
        return keyFactory.generatePublic(keySpec)
    }

    /**
     * 使用私钥对 (authenticatorData || clientDataHash) 进行 ECDSA-SHA256 签名。
     * 返回 DER 编码的签名，与 Edge 端 signAssertion() 输出格式一致。
     *
     * 注意：Java Signature.getInstance("SHA256withECDSA") 直接输出 DER，
     * 而 WebCrypto 输出 IEEE-P1363 后需手动转 DER。Android 端无需转换。
     */
    fun signAssertion(
        privateKey: PrivateKey,
        authenticatorData: ByteArray,
        clientDataHash: ByteArray
    ): ByteArray {
        val dataToSign = authenticatorData + clientDataHash
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey)
        signature.update(dataToSign)
        return signature.sign()
    }

    /**
     * 使用公钥验证 DER 签名。
     */
    fun verifyAssertion(
        publicKey: java.security.PublicKey,
        authenticatorData: ByteArray,
        clientDataHash: ByteArray,
        signatureDer: ByteArray
    ): Boolean {
        val data = authenticatorData + clientDataHash
        return try {
            val sig = Signature.getInstance("SHA256withECDSA")
            sig.initVerify(publicKey)
            sig.update(data)
            sig.verify(signatureDer)
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 将 EC P-256 公钥编码为 COSE_Key（CBOR）。
     * 与 Edge 端 encodeCoseKeyEs256() 输出字节级一致。
     */
    fun encodeCoseKeyEs256(publicKey: ECPublicKey): ByteArray {
        val point = publicKey.w
        val xBytes = point.affineX.toFixedByteArray(32)
        val yBytes = point.affineY.toFixedByteArray(32)
        return CborEncoder.encodeCoseKeyEs256(xBytes, yBytes)
    }

    /**
     * 构建 WebAuthn authenticatorData。
     *
     * Create（注册）: flags = 0x41 (AT + UP), 包含 attestedCredentialData
     * Get（认证）: flags 由 userVerified 参数决定 UV 标志
     */
    fun buildAuthenticatorData(
        rpId: String,
        signCount: Int,
        includeAttestedCredentialData: Boolean = false,
        credentialId: ByteArray? = null,
        publicKeyCose: ByteArray? = null,
        userVerified: Boolean = false
    ): ByteArray {
        val rpIdHash = MessageDigest.getInstance("SHA-256").digest(rpId.toByteArray(Charsets.UTF_8))

        var flags = 0x01 // UP = 1
        if (userVerified) {
            // 仅在实际完成用户验证后才设置 UV=1
            flags = flags or 0x04 // UV = 1
        }
        if (includeAttestedCredentialData) {
            flags = flags or 0x40 // AT = 1
        }

        val signCountBytes = byteArrayOf(
            (signCount ushr 24).toByte(),
            (signCount ushr 16).toByte(),
            (signCount ushr 8).toByte(),
            signCount.toByte()
        )

        val base = rpIdHash + byteArrayOf(flags.toByte()) + signCountBytes

        if (!includeAttestedCredentialData) return base

        // attestedCredentialData: aaguid(16) || credIdLen(2) || credId || publicKeyCose
        val aaguid = ByteArray(16) // 全 0，软件认证器
        val cid = credentialId ?: throw IllegalArgumentException("credentialId required for attestedCredentialData")
        val pk = publicKeyCose ?: throw IllegalArgumentException("publicKeyCose required for attestedCredentialData")

        val credIdLen = byteArrayOf(
            ((cid.size ushr 8) and 0xFF).toByte(),
            (cid.size and 0xFF).toByte()
        )

        return base + aaguid + credIdLen + cid + pk
    }

    /**
     * 编码 attestationObject = {"fmt": "none", "attStmt": {}, "authData": <bytes>}
     */
    fun encodeAttestationObjectNone(authData: ByteArray): ByteArray {
        return CborEncoder.encodeAttestationObjectNone(authData)
    }

    /**
     * 构建 clientDataJSON 字符串。
     */
    fun buildClientDataJSON(type: String, challenge: String, origin: String): String {
        return "{\"type\":\"$type\",\"challenge\":\"$challenge\",\"origin\":\"$origin\",\"crossOrigin\":false}"
    }

    /**
     * 生成新的 EC P-256 密钥对。
     */
    fun generateEcKeyPair(): java.security.KeyPair {
        val generator = java.security.KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"), SecureRandom())
        return generator.generateKeyPair()
    }

    /**
     * 计算 SHA-256(rpId) 或 SHA-256(clientDataJSON)。
     * 通用 SHA-256 工具，不只限于 rpId。
     */
    fun sha256(data: String): ByteArray {
        return MessageDigest.getInstance("SHA-256").digest(data.toByteArray(Charsets.UTF_8))
    }

    /**
     * 标准 Base64 编码（带 padding）。
     */
    fun base64Encode(data: ByteArray): String {
        return Base64.getEncoder().encodeToString(data)
    }

    /**
     * 标准 Base64 解码。
     */
    fun base64Decode(b64: String): ByteArray {
        return Base64.getDecoder().decode(b64)
    }

    /**
     * Base64Url（无 padding）编码。
     */
    fun base64UrlEncode(data: ByteArray): String {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data)
    }

    /**
     * Base64Url（无 padding）解码，自动补 padding。
     */
    fun base64UrlDecode(b64url: String): ByteArray {
        val padded = b64url
            .replace('-', '+')
            .replace('_', '/')
            .let {
                val padLen = (4 - (it.length % 4)) % 4
                it + "=".repeat(padLen)
            }
        return Base64.getDecoder().decode(padded)
    }

    /**
     * 将 BigInteger 转为固定长度的字节数组（大端序）。
     * 处理 Java BigInteger 可能带前导零字节的问题。
     */
    private fun BigInteger.toFixedByteArray(length: Int): ByteArray {
        var bytes = this.toByteArray()
        // BigInteger.toByteArray() 可能产生 33 字节（带符号位）
        if (bytes.size > length) {
            bytes = bytes.copyOfRange(bytes.size - length, bytes.size)
        }
        return ByteArray(length).apply {
            System.arraycopy(bytes, 0, this, length - bytes.size, bytes.size)
        }
    }
}
