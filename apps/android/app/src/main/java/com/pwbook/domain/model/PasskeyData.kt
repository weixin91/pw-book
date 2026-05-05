package com.pwbook.domain.model

/**
 * Passkey 数据类，与 Edge 端 [PasskeyData] 接口完全对齐。
 *
 * 编码约定：
 * - credentialId: Base64Url（无 padding），WebAuthn 标准
 * - privateKey: 标准 Base64（带 padding），PKCS#8 格式
 * - publicKey: 标准 Base64（带 padding），SPKI/DER 格式
 * - userHandle: Base64Url（无 padding），WebAuthn 标准
 */
data class PasskeyData(
    val credentialId: String,
    val privateKey: String,
    val publicKey: String,
    val rpId: String,
    val rpName: String?,
    val userHandle: String,
    val userName: String?,
    val userDisplayName: String?,
    val counter: Int,
    val createdAt: String
)
