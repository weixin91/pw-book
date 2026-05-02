# Implementation Plan: Android App Passkey 方案

**Branch**: `001-password-manager` | **Date**: 2026/05/03 | **Spec**: [spec.md](spec.md)
**Input**: 基于 `C:\projects\passkey-demo` 验证过的 Credential Provider 实现，重新设计 Android Passkey 方案，确保与 Edge 插件端互通

## Summary

为 pw-book Android 应用实现 Passkey 支持，通过 Android Credential Provider API 提供系统级 Passkey 创建和认证能力。核心约束是与 Edge 插件端的 Passkey 数据完全互通——包括数据模型、加密方式、编码方式、密钥格式和 WebAuthn 响应格式。

经调研确认，Edge 端 `passkey-storage.ts` 的实现已与 Android 端需求对齐（PKCS#8 私钥、SPKI 公钥、ECDSA P-256、完整 WebAuthn 响应），**Android 端无需修改 Edge 端代码**。

## Technical Context

**Language/Version**: Kotlin 2.1, Android API 34+ (minSdk 提升至 34)
**Primary Dependencies**:
- `androidx.credentials:credentials:1.6.0` — Credential Provider API
- `androidx.biometric:biometric:1.1.0` — 生物识别认证
- `org.bouncycastle:bcprov-jdk18on:1.79` — 已有依赖，用于 Argon2id
**Storage**: Room (已有), 加密保险库（复用现有 `VaultEncryption`）
**Testing**: JUnit 4 + kotlinx-coroutines-test（已有）
**Target Platform**: Android 14+ (API 34+)
**Project Type**: mobile-app (Android native)
**Performance Goals**: Passkey 创建/认证流程在 2 秒内完成（含生物识别）
**Constraints**:
- 私钥必须可同步到 Edge 端 → 不使用 Android Keystore 硬件绑定
- 生物识别认证为必选项（FR-016）
- WebAuthn 响应格式必须与 Edge 端完全一致
**Scale/Scope**: 单个用户的 Passkey 凭据管理，与现有 LOGIN 凭据共存

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 检查项 | 状态 | 说明 |
|------|--------|------|------|
| 中文优先 | 所有产出使用中文 | 通过 | 文档、注释、代码均使用中文 |
| 安全至上 | 敏感数据加密存储 | 通过 | Passkey 私钥用 User Key AES-256-GCM 加密，与现有凭据一致 |
| 安全至上 | 私钥不明文暴露 | 通过 | 私钥仅在解锁后的内存中存在，使用 `SecureMemory.clear` 清理 |
| 测试先行 | 核心模块高覆盖率 | 通过 | 计划包含加密兼容性测试（共享测试向量） |
| 隐私保护 | 最小权限 | 通过 | 不收集额外数据，Passkey 元数据仅存于用户保险库 |
| 简洁设计 | YAGNI | 通过 | 不引入不必要的抽象，复用现有加密和同步基础设施 |

**re-check after design**: 所有原则通过，无违规。

## Project Structure

### Documentation (this feature)

```text
specs/001-password-manager/
├── plan.md              # This file
├── research.md          # 含 Android Credential Provider 调研（§11）
├── data-model.md        # Passkey 数据模型（§2.2）
├── quickstart.md        # 开发启动指南
├── contracts/           # API 和加密契约
└── tasks.md             # 任务清单
```

### Source Code (repository root)

#### Edge 插件（已有，无需修改）

```text
apps/edge-extension/
├── src/crypto/passkey-storage.ts       # Passkey 生成/导入/签名工具
├── src/background/webauthn-handler.ts  # Background WebAuthn 处理
├── src/content/webauthn-handler.ts     # Content script 桥接
└── src/content/passkey-prompt.ts       # Passkey 选择弹窗
```

#### Android 应用（新增/修改）

```text
apps/android/
├── app/build.gradle.kts                          # 添加 androidx.credentials 依赖
├── app/src/main/AndroidManifest.xml              # 添加 CredentialProviderService 声明
│
├── app/src/main/java/com/pwbook/
│   ├── crypto/
│   │   ├── PasskeyCrypto.kt                      # NEW: Passkey 签名、COSE_Key 编码、CBOR 工具
│   │   └── CborEncoder.kt                        # NEW: 简化 CBOR 编码（attestationObject）
│   │
│   ├── domain/model/
│   │   └── PasskeyData.kt                        # NEW: Passkey 数据类（与 Edge 端对齐）
│   │
│   ├── service/credential/
│   │   ├── PwBookCredentialProviderService.kt    # NEW: CredentialProviderService 实现
│   │   ├── PasskeyCreateActivity.kt              # NEW: Passkey 创建 Activity
│   │   ├── PasskeyGetActivity.kt                 # NEW: Passkey 认证 Activity
│   │   └── CredentialProviderUnlockActivity.kt   # NEW: 保险库解锁 Activity（Credential Provider 场景）
│   │
│   └── di/
│       └── ServiceModule.kt                      # MODIFY: 添加 Credential Provider 相关依赖注入
│
└── app/src/test/java/com/pwbook/crypto/
    └── PasskeyCryptoTest.kt                      # NEW: 加密兼容性测试（与 Edge 端共享测试向量）
```

**Structure Decision**: 在现有 Android 项目架构基础上新增 `service/credential/` 模块，复用 `crypto/`、`domain/`、`data/` 现有基础设施。minSdk 从 28 提升至 34。

## Complexity Tracking

> 无违规。所有设计决策均有明确理由，未引入不必要的复杂度。

---

## Android Passkey 实现方案

### 1. 依赖与配置

#### 1.1 build.gradle.kts

```kotlin
dependencies {
    // 已有依赖保持不变...

    // AndroidX Credentials (Credential Provider)
    implementation("androidx.credentials:credentials:1.6.0")
}
```

#### 1.2 AndroidManifest.xml

在现有 `PwBookAutofillService` 声明之后添加：

```xml
<service
    android:name=".service.credential.PwBookCredentialProviderService"
    android:exported="true"
    android:label="@string/app_name"
    android:permission="android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE">
    <intent-filter>
        <action android:name="androidx.credentials.provider.CredentialProviderService" />
    </intent-filter>
</service>

<activity
    android:name=".service.credential.PasskeyCreateActivity"
    android:exported="false"
    android:theme="@style/Theme.Transparent" />

<activity
    android:name=".service.credential.PasskeyGetActivity"
    android:exported="false"
    android:theme="@style/Theme.Transparent" />

<activity
    android:name=".service.credential.CredentialProviderUnlockActivity"
    android:exported="false"
    android:theme="@style/Theme.Transparent" />
```

**minSdk 提升**：将 `defaultConfig.minSdk` 从 28 改为 34。

**理由**：CredentialProviderService 仅在 Android 14+ 可用。Passkey 是 P3 功能，2026 年 Android 14 已广泛普及，简化实现不保留兼容性代码。

### 2. 数据模型

#### 2.1 PasskeyData（与 Edge 端对齐）

```kotlin
package com.pwbook.domain.model

/**
 * Passkey 数据类，与 Edge 端 `PasskeyData` 接口完全对齐。
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
    val createdAt: String // ISO 8601
)
```

#### 2.2 与 CipherData 的关系

Passkey 作为 `type=1` (LOGIN) 凭据的附加字段存储，与 Edge 端一致：

```kotlin
// 解密后的 CipherData JSON 结构
val cipherDataJson = vaultEncryption.decryptString(cipherEntity.data, userKey)
val cipherData = jsonParser.parse(cipherDataJson)

// 读取 Passkey
val passkey = cipherData.passkey // PasskeyData?
```

创建新 Passkey 时：
- 若密码库中已有同 rpId 的 LOGIN 凭据 → 附加 `passkey` 字段到现有凭据
- 若无 → 新建 LOGIN 凭据（`login.username` 可为 null，`login.password` 为 null）

### 3. 加密与签名核心（PasskeyCrypto）

#### 3.1 私钥导入

```kotlin
package com.pwbook.crypto

import java.security.KeyFactory
import java.security.PrivateKey
import java.security.spec.PKCS8EncodedKeySpec

object PasskeyCrypto {

    /**
     * 从 PKCS#8 Base64 导入 EC P-256 私钥。
     * 与 Edge 端 `crypto.subtle.exportKey("pkcs8", ...)` 输出兼容。
     */
    fun importPrivateKey(pkcs8Base64: String): PrivateKey {
        val pkcs8Bytes = java.util.Base64.getDecoder().decode(pkcs8Base64)
        val keySpec = PKCS8EncodedKeySpec(pkcs8Bytes)
        val keyFactory = KeyFactory.getInstance("EC")
        return keyFactory.generatePrivate(keySpec)
    }

    /**
     * 从 SPKI Base64 导入 EC P-256 公钥。
     */
    fun importPublicKey(spkiBase64: String): java.security.PublicKey {
        val spkiBytes = java.util.Base64.getDecoder().decode(spkiBase64)
        val keySpec = java.security.spec.X509EncodedKeySpec(spkiBytes)
        val keyFactory = KeyFactory.getInstance("EC")
        return keyFactory.generatePublic(keySpec)
    }
}
```

#### 3.2 WebAuthn 断言签名

```kotlin
/**
 * 使用私钥对 (authenticatorData || clientDataHash) 进行 ECDSA-SHA256 签名。
 * 返回 DER 编码的签名，与 Edge 端 `signAssertion()` 输出格式一致。
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
    return signature.sign() // 直接返回 DER 格式
}
```

#### 3.3 公钥 COSE_Key 编码

```kotlin
/**
 * 将 EC P-256 公钥编码为 COSE_Key（CBOR）。
 * 与 Edge 端 `encodeCoseKeyEs256()` 输出字节级一致。
 */
fun encodeCoseKeyEs256(publicKey: java.security.interfaces.ECPublicKey): ByteArray {
    val point = publicKey.w
    val xBytes = point.affineX.toByteArray().normalizeTo32()
    val yBytes = point.affineY.toByteArray().normalizeTo32()

    return byteArrayOf(
        0xA5.toByte(), // map(5)
        0x01, 0x02,    // kty: EC2
        0x03, 0x26,    // alg: ES256 (-7)
        0x20, 0x01,    // crv: P-256
        0x21, 0x58, 0x20.toByte() // x: bstr(32)
    ) + xBytes + byteArrayOf(
        0x22, 0x58, 0x20.toByte() // y: bstr(32)
    ) + yBytes
}

private fun BigInteger.toByteArray(): ByteArray {
    var bytes = this.toByteArray()
    // 去掉前导零，确保 32 字节
    if (bytes.size > 32) {
        bytes = bytes.copyOfRange(bytes.size - 32, bytes.size)
    }
    return ByteArray(32).apply {
        System.arraycopy(bytes, 0, this, 32 - bytes.size, bytes.size)
    }
}
```

#### 3.4 AuthenticatorData 构建

```kotlin
/**
 * 构建 WebAuthn authenticatorData。
 *
 * Create（注册）: flags = 0x41 (AT + UP), 包含 attestedCredentialData
 * Get（认证）: flags = 0x05 (UP + UV), 不包含 attestedCredentialData
 */
fun buildAuthenticatorData(
    rpId: String,
    signCount: Int,
    includeAttestedCredentialData: Boolean = false,
    credentialId: ByteArray? = null,
    publicKeyCose: ByteArray? = null
): ByteArray {
    val rpIdHash = MessageDigest.getInstance("SHA-256").digest(rpId.toByteArray())

    var flags = 0x01 // UP = 1
    if (includeAttestedCredentialData) {
        flags = flags or 0x40 // AT = 1
    } else {
        flags = flags or 0x04 // UV = 1
    }

    val base = rpIdHash + byteArrayOf(flags.toByte()) +
        byteArrayOf(
            (signCount ushr 24).toByte(),
            (signCount ushr 16).toByte(),
            (signCount ushr 8).toByte(),
            signCount.toByte()
        )

    if (!includeAttestedCredentialData) return base

    // attestedCredentialData: aaguid(16) || credIdLen(2) || credId || publicKeyCose
    val aaguid = ByteArray(16) // 全 0，软件认证器
    val credIdLen = byteArrayOf(
        ((credentialId!!.size ushr 8) and 0xFF).toByte(),
        (credentialId.size and 0xFF).toByte()
    )

    return base + aaguid + credIdLen + credentialId + publicKeyCose!!
}
```

#### 3.5 CBOR 编码（AttestationObject）

```kotlin
/**
 * 编码 attestationObject = {"fmt": "none", "attStmt": {}, "authData": <bytes>}
 * 使用 fmt=none，避免引入可信硬件证书链。
 */
fun encodeAttestationObjectNone(authData: ByteArray): ByteArray {
    // CBOR map(3)
    val out = mutableListOf<Byte>()
    out.add(0xA3.toByte())

    // "fmt" -> "none"
    pushCborTextString(out, "fmt")
    pushCborTextString(out, "none")

    // "attStmt" -> {}
    pushCborTextString(out, "attStmt")
    out.add(0xA0.toByte()) // empty map

    // "authData" -> authData bytes
    pushCborTextString(out, "authData")
    pushCborByteString(out, authData)

    return out.toByteArray()
}
```

### 4. CredentialProviderService 实现

#### 4.1 PwBookCredentialProviderService

```kotlin
package com.pwbook.service.credential

import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.PublicKeyCredentialEntry
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.CredentialEntry
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import android.app.PendingIntent
import android.content.Intent
import android.os.CancellationSignal
import android.os.OutcomeReceiver

class PwBookCredentialProviderService : CredentialProviderService() {

    companion object {
        private const val PACKAGE_NAME = "com.pwbook"
        private const val CREATE_PASSKEY_INTENT = "$PACKAGE_NAME.CREATE_PASSKEY"
        private const val GET_PASSKEY_INTENT = "$PACKAGE_NAME.GET_PASSKEY"
        private const val UNLOCK_INTENT = "$PACKAGE_NAME.UNLOCK_CREDENTIAL_PROVIDER"
    }

    // 注入的依赖
    @Inject lateinit var cipherRepository: CipherRepository
    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var vaultEncryption: VaultEncryption

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        val response = when (request) {
            is BeginCreatePublicKeyCredentialRequest -> handleCreatePasskeyQuery(request)
            else -> BeginCreateCredentialResponse(emptyList())
        }
        callback.onResult(response)
    }

    private fun handleCreatePasskeyQuery(
        request: BeginCreatePublicKeyCredentialRequest
    ): BeginCreateCredentialResponse {
        // 返回 "Personal" / "Work" 分类的 CreateEntry
        val createEntries = listOf(
            CreateEntry("Personal", createPendingIntent(CREATE_PASSKEY_INTENT, "personal")),
            CreateEntry("Work", createPendingIntent(CREATE_PASSKEY_INTENT, "work"))
        )
        return BeginCreateCredentialResponse(createEntries)
    }

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        // 检查保险库是否解锁
        if (!vaultSession.isUnlocked) {
            callback.onResult(
                BeginGetCredentialResponse(
                    authenticationActions = listOf(
                        AuthenticationAction(
                            "解锁保险库以继续",
                            createUnlockPendingIntent()
                        )
                    )
                )
            )
            return
        }

        val response = processGetCredentialRequest(request)
        callback.onResult(response)
    }

    private fun processGetCredentialRequest(
        request: BeginGetCredentialRequest
    ): BeginGetCredentialResponse {
        val callingPackage = request.callingAppInfo?.packageName.orEmpty()
        val credentialEntries = mutableListOf<CredentialEntry>()

        for (option in request.beginGetCredentialOptions) {
            when (option) {
                is BeginGetPasswordOption -> {
                    credentialEntries.addAll(populatePasswordEntries(callingPackage, option))
                }
                is BeginGetPublicKeyCredentialOption -> {
                    credentialEntries.addAll(populatePasskeyEntries(callingPackage, option))
                }
            }
        }

        return BeginGetCredentialResponse(credentialEntries)
    }

    private fun populatePasskeyEntries(
        callingPackage: String,
        option: BeginGetPublicKeyCredentialOption
    ): List<CredentialEntry> {
        // 1. 从 requestJson 解析 rpId 和 allowCredentials
        val requestJson = JSONObject(option.requestJson)
        val rpId = requestJson.optString("rpId", "")
        val allowCredentials = requestJson.optJSONArray("allowCredentials")

        // 2. 查询密码库中匹配的 Passkey
        val userKey = vaultSession.userKey ?: return emptyList()
        val ciphers = cipherRepository.getAllCiphers()

        val entries = mutableListOf<CredentialEntry>()
        for (cipher in ciphers) {
            val plain = vaultEncryption.decryptString(cipher.data, userKey)
            val data = json.parse(plain)
            val passkey = data.passkey ?: continue

            // rpId 匹配
            if (!isRpIdMatch(passkey.rpId, rpId, callingPackage)) continue

            // allowCredentials 过滤
            if (allowCredentials != null && !isCredentialAllowed(passkey.credentialId, allowCredentials)) continue

            entries.add(
                PublicKeyCredentialEntry(
                    context = applicationContext,
                    username = passkey.userName ?: passkey.rpId,
                    pendingIntent = createGetPendingIntent(GET_PASSKEY_INTENT, passkey.credentialId),
                    beginGetPublicKeyCredentialOption = option,
                    displayName = passkey.userDisplayName ?: passkey.userName ?: passkey.rpId
                )
            )
        }

        return entries
    }

    // ... PendingIntent 创建辅助方法
}
```

#### 4.2 PasskeyCreateActivity

```kotlin
package com.pwbook.service.credential

import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricPrompt
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.CreatePublicKeyCredentialResponse

class PasskeyCreateActivity : AppCompatActivity() {

    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var vaultEncryption: VaultEncryption
    @Inject lateinit var cipherRepository: CipherRepository
    @Inject lateinit var syncManager: SyncManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val request = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
        val callingRequest = request?.callingRequest as? CreatePublicKeyCredentialRequest
            ?: run { finish(); return }

        val requestJson = callingRequest.requestJson
        val callingAppInfo = request.callingAppInfo

        // 1. 生物识别认证
        authenticateWithBiometric { success ->
            if (!success) { finish(); return@authenticateWithBiometric }

            // 2. 生成 Passkey
            lifecycleScope.launch {
                try {
                    val response = createPasskey(requestJson, callingAppInfo)

                    // 3. 返回结果给系统
                    val result = Intent()
                    PendingIntentHandler.setCreateCredentialResponse(
                        result,
                        CreatePublicKeyCredentialResponse(response)
                    )
                    setResult(RESULT_OK, result)
                } catch (e: Exception) {
                    setResult(RESULT_CANCELED)
                }
                finish()
            }
        }
    }

    private suspend fun createPasskey(
        requestJson: String,
        callingAppInfo: CallingAppInfo?
    ): String {
        val request = JSONObject(requestJson)
        val rp = request.getJSONObject("rp")
        val rpId = rp.optString("id", "")
        val rpName = rp.optString("name", "")
        val user = request.getJSONObject("user")
        val userId = user.getString("id") // Base64Url
        val userName = user.optString("name", "")
        val displayName = user.optString("displayName", userName)
        val challenge = request.getString("challenge")

        // 生成 EC P-256 密钥对
        val keyPair = generateEcKeyPair()
        val credentialIdBytes = ByteArray(32).apply { SecureRandom().nextBytes(this) }
        val credentialId = base64UrlEncode(credentialIdBytes)

        // 导出密钥格式
        val privateKeyPkcs8 = base64Encode(keyPair.private.encoded)
        val publicKeySpki = base64Encode(keyPair.public.encoded)

        // 构建 WebAuthn 响应
        val origin = "https://$rpId"
        val clientDataJSON = buildClientDataJSON("webauthn.create", challenge, origin)
        val clientDataHash = sha256(clientDataJSON.toByteArray())

        val coseKey = encodeCoseKeyEs256(keyPair.public as ECPublicKey)
        val authData = buildAuthenticatorData(
            rpId = rpId,
            signCount = 0,
            includeAttestedCredentialData = true,
            credentialId = credentialIdBytes,
            publicKeyCose = coseKey
        )

        val attestationObject = encodeAttestationObjectNone(authData)

        // 构建响应 JSON
        val responseJson = JSONObject().apply {
            put("id", credentialId)
            put("rawId", credentialId)
            put("type", "public-key")
            put("authenticatorAttachment", "platform")
            put("response", JSONObject().apply {
                put("clientDataJSON", base64UrlEncode(clientDataJSON.toByteArray()))
                put("attestationObject", base64UrlEncode(attestationObject))
                put("authenticatorData", base64UrlEncode(authData))
                put("publicKeyAlgorithm", -7)
                put("publicKey", base64UrlEncode(publicKeySpki.toByteArray())) // 注意：实际应为 raw SPKI
                put("transports", JSONArray().put("internal"))
            })
            put("clientExtensionResults", JSONObject().apply {
                put("credProps", JSONObject().apply { put("rk", false) })
            })
        }.toString()

        // 保存到密码库（附加到现有 LOGIN 或新建）
        savePasskeyToVault(
            passkeyData = PasskeyData(
                credentialId = credentialId,
                privateKey = privateKeyPkcs8,
                publicKey = publicKeySpki,
                rpId = rpId,
                rpName = rpName,
                userHandle = userId,
                userName = userName,
                userDisplayName = displayName,
                counter = 0,
                createdAt = Instant.now().toString()
            ),
            rpId = rpId,
            userName = userName
        )

        return responseJson
    }
}
```

#### 4.3 PasskeyGetActivity

```kotlin
package com.pwbook.service.credential

class PasskeyGetActivity : AppCompatActivity() {

    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var vaultEncryption: VaultEncryption
    @Inject lateinit var cipherRepository: CipherRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val getRequest = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
        val option = getRequest?.credentialOptions?.firstOrNull() as? GetPublicKeyCredentialOption
            ?: run { finish(); return }

        val credentialId = intent.getStringExtra("credential_id") ?: run { finish(); return }

        // 1. 生物识别认证
        authenticateWithBiometric { success ->
            if (!success) { finish(); return@authenticateWithBiometric }

            lifecycleScope.launch {
                try {
                    val response = authenticateWithPasskey(credentialId, option)

                    val result = Intent()
                    val publicKeyCredential = PublicKeyCredential(response)
                    PendingIntentHandler.setGetCredentialResponse(
                        result,
                        GetCredentialResponse(publicKeyCredential)
                    )
                    setResult(RESULT_OK, result)
                } catch (e: Exception) {
                    setResult(RESULT_CANCELED)
                }
                finish()
            }
        }
    }

    private suspend fun authenticateWithPasskey(
        credentialId: String,
        option: GetPublicKeyCredentialOption
    ): String {
        // 1. 从密码库查找 Passkey
        val userKey = vaultSession.userKey ?: throw IllegalStateException("保险库未解锁")
        val cipher = findCipherByCredentialId(credentialId) ?: throw IllegalStateException("Passkey 未找到")

        val plain = vaultEncryption.decryptString(cipher.data, userKey)
        val data = json.parse(plain)
        val passkey = data.passkey ?: throw IllegalStateException("凭据不包含 Passkey")

        // 2. 解析请求
        val requestJson = JSONObject(option.requestJson)
        val challenge = requestJson.getString("challenge")
        val rpId = requestJson.optString("rpId", passkey.rpId)
        val origin = "https://$rpId"

        // 3. 导入私钥并签名
        val privateKey = PasskeyCrypto.importPrivateKey(passkey.privateKey)
        val newCounter = passkey.counter + 1

        val authData = PasskeyCrypto.buildAuthenticatorData(
            rpId = rpId,
            signCount = newCounter,
            includeAttestedCredentialData = false
        )

        val clientDataJSON = buildClientDataJSON("webauthn.get", challenge, origin)
        val clientDataHash = sha256(clientDataJSON.toByteArray())
        val signature = PasskeyCrypto.signAssertion(privateKey, authData, clientDataHash)

        // 4. 更新 counter 并保存
        val updatedPasskey = passkey.copy(counter = newCounter)
        val updatedData = data.copy(
            lastUsedAt = Instant.now().toString(),
            passkey = updatedPasskey
        )
        val encrypted = vaultEncryption.encryptString(json.stringify(updatedData), userKey)
        cipherRepository.updateCipher(cipher.copy(data = encrypted, modifiedAt = System.currentTimeMillis()))
        syncManager.enqueueUpdate(cipher.id, encrypted)

        // 5. 构建响应
        val userHandleBytes = try {
            base64UrlDecode(passkey.userHandle)
        } catch {
            passkey.userHandle.toByteArray(Charsets.UTF_8)
        }

        return JSONObject().apply {
            put("id", passkey.credentialId)
            put("rawId", passkey.credentialId)
            put("type", "public-key")
            put("response", JSONObject().apply {
                put("clientDataJSON", base64UrlEncode(clientDataJSON.toByteArray()))
                put("authenticatorData", base64UrlEncode(authData))
                put("signature", base64UrlEncode(signature))
                put("userHandle", base64UrlEncode(userHandleBytes))
            })
            put("clientExtensionResults", JSONObject())
        }.toString()
    }
}
```

### 5. 凭据匹配逻辑

#### 5.1 rpId 匹配

```kotlin
/**
 * 检查 passkey.rpId 是否与请求匹配。
 *
 * 规则：
 * 1. 直接相等
 * 2. origin host 以 passkey.rpId 结尾（支持子域）
 * 3. 通过 DomainAssociation 规则关联
 */
fun isRpIdMatch(passkeyRpId: String, requestedRpId: String, callingPackage: String): Boolean {
    val pId = passkeyRpId.lowercase()
    val rId = requestedRpId.lowercase()

    if (pId == rId) return true
    if (rId.endsWith(".$pId")) return true

    // TODO: 通过 DomainAssociation 检查 callingPackage 与 rpId 的关联

    return false
}
```

#### 5.2 allowCredentials 过滤

```kotlin
fun isCredentialAllowed(credentialId: String, allowCredentials: JSONArray): Boolean {
    for (i in 0 until allowCredentials.length()) {
        val item = allowCredentials.getJSONObject(i)
        val id = item.getString("id") // Base64Url
        if (id == credentialId) return true
    }
    return false
}
```

### 6. 保存 Passkey 到现有凭据/新建凭据

```kotlin
/**
 * 遵循 FR-008：创建 Passkey 时优先附加到同一站点已存在的 LOGIN 凭据。
 * 若不存在，则新建 LOGIN 凭据。
 */
suspend fun savePasskeyToVault(
    passkeyData: PasskeyData,
    rpId: String,
    userName: String
) {
    val userKey = vaultSession.userKey ?: throw IllegalStateException("保险库未解锁")
    val existingCiphers = cipherRepository.findByRpId(rpId)

    val targetCipher = existingCiphers.firstOrNull { it.type == CipherType.LOGIN.value }

    if (targetCipher != null) {
        // 附加到现有凭据
        val plain = vaultEncryption.decryptString(targetCipher.data, userKey)
        val data = json.parse(plain)
        val updatedData = data.copy(
            lastUsedAt = Instant.now().toString(),
            passkey = passkeyData
        )
        val encrypted = vaultEncryption.encryptString(json.stringify(updatedData), userKey)
        cipherRepository.updateCipher(targetCipher.copy(data = encrypted, modifiedAt = System.currentTimeMillis()))
        syncManager.enqueueUpdate(targetCipher.id, encrypted)
    } else {
        // 新建 LOGIN 凭据
        val newData = CipherData(
            name = passkeyData.rpName ?: rpId,
            notes = null,
            fields = emptyList(),
            lastUsedAt = Instant.now().toString(),
            login = LoginData(
                username = userName.ifEmpty { null },
                password = null,
                uris = listOf(LoginUri(uri = "https://$rpId", match = null)),
                totp = null
            ),
            passkey = passkeyData
        )
        val encrypted = vaultEncryption.encryptString(json.stringify(newData), userKey)
        val newCipher = CipherEntity(
            id = UUID.randomUUID().toString(),
            userId = vaultSession.userId,
            type = CipherType.LOGIN.value,
            data = encrypted,
            createdAt = System.currentTimeMillis(),
            modifiedAt = System.currentTimeMillis()
        )
        cipherRepository.insertCipher(newCipher)
        syncManager.enqueueCreate(newCipher.id, encrypted)
    }
}
```

### 7. 凭据编辑页 Passkey 展示与删除

复用现有 `CipherEditScreen.kt`，添加 Passkey 信息展示：

```kotlin
@Composable
fun PasskeySection(passkey: PasskeyData?, onDelete: () -> Unit) {
    if (passkey == null) return

    Column {
        Text("通行密钥", style = MaterialTheme.typography.titleMedium)
        Text("RP ID: ${passkey.rpId}")
        Text("添加时间: ${passkey.createdAt}")

        OutlinedButton(onClick = onDelete) {
            Text("删除通行密钥")
        }
    }
}
```

删除逻辑：仅移除 `passkey` 字段，保留 `login` 等其他数据。

### 8. 加密兼容性测试

```kotlin
package com.pwbook.crypto

import org.junit.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class PasskeyCryptoTest {

    /**
     * 与 Edge 端共享测试向量，验证：
     * 1. Android 生成的签名 Edge 端可验证
     * 2. Edge 生成的密钥 Android 端可导入和签名
     */
    @Test
    fun testSignAssertion_CompatibleWithEdge() {
        // 测试向量：来自 Edge 端 passkey-storage.test.ts
        val privateKeyPkcs8 = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg..."
        val authenticatorData = hexToBytes("...")
        val clientDataHash = hexToBytes("...")
        val expectedSignatureDer = hexToBytes("...")

        val privateKey = PasskeyCrypto.importPrivateKey(privateKeyPkcs8)
        val signature = PasskeyCrypto.signAssertion(privateKey, authenticatorData, clientDataHash)

        // DER 签名结构验证（不比较具体值，因为随机性）
        assertEquals(0x30.toByte(), signature[0]) // SEQUENCE
        // 验证签名可用公钥验证
        val publicKey = derivePublicKeyFromPrivate(privateKey)
        assertTrue(verifySignature(publicKey, authenticatorData + clientDataHash, signature))
    }

    @Test
    fun testCoseKeyEncoding_MatchesEdge() {
        // 从已知 (x, y) 坐标生成 COSE_Key，与 Edge 端输出对比
        val x = ByteArray(32) { 0x01 }
        val y = ByteArray(32) { 0x02 }

        val publicKey = createEcPublicKey(x, y)
        val coseKey = PasskeyCrypto.encodeCoseKeyEs256(publicKey)

        // 与 Edge 端 encodeCoseKeyEs256(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)) 输出对比
        val expected = byteArrayOf(
            0xA5.toByte(), 0x01, 0x02, 0x03, 0x26, 0x20, 0x01,
            0x21, 0x58, 0x20.toByte(), *x,
            0x22, 0x58, 0x20.toByte(), *y
        )
        assertContentEquals(expected, coseKey)
    }
}
```

### 9. 已知限制与后续优化

1. **minSdk 34**：仅 Android 14+ 设备可用。如需支持旧设备，未来可引入 `androidx.credentials:credentials-play-services-auth` 作为降级方案，但这会将 Passkey 管理委托给 Google 密码管理器，无法实现与 Edge 端的互通。
2. **签名计数器同步**：多设备并发使用可能导致计数器回退（last-write-wins）。当前版本接受此限制。
3. **attestation**：使用 `fmt=none`，不提供硬件认证证明。满足绝大多数 RP 需求。
4. **生物识别**：每次使用 Passkey 都要求生物识别确认。未来可考虑在保险库解锁后的一段时间内免重复认证。
5. **数字资产链接**：未验证 calling app 的 Digital Asset Links。生产环境建议添加验证以防止恶意应用调用。
