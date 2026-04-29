# Android App 技术方案

**Feature**: 密码管理应用 — Android 端
**Date**: 2026/04/28
**参考项目**: [bitwarden/android](https://github.com/bitwarden/android)

---

## 1. 设计目标

Android App 是 pw-book 密码管理器的移动端核心，功能上对齐 Edge 插件，同时在平台特性上充分利用 Android 原生能力：

- **保险库管理**: 查看、添加、编辑、删除凭据，支持搜索和收藏
- **系统级自动填充**: 通过 Android `AutofillService` 在任意 App 和浏览器中自动填充账号密码
- **Passkey 支持**: 通过 `CredentialProviderService` 实现系统级 Passkey 创建和认证
- **生物识别快捷解锁**: 指纹/面部识别解锁保险库
- **TOTP 验证码**: 内建验证器，显示倒计时
- **密码生成器**: 创建高强度随机密码
- **多端同步**: 与 Edge 插件实时同步，支持离线编辑
- **剪贴板安全**: 复制密码后 10 秒自动清空

---

## 2. 技术栈选型

| 类别 | 技术 | 版本/说明 | 选型理由 |
|------|------|----------|---------|
| 语言 | **Kotlin** | 2.1+ | 与 Bitwarden 一致，Android 原生首选 |
| UI | **Jetpack Compose** | 2025.x | 声明式 UI，现代 Android 标准，Bitwarden 生产验证 |
| 架构 | **MVVM + Repository** | — | 与 Compose 配合成熟，测试友好 |
| 依赖注入 | **Hilt** | 2.55+ | 编译期 DI，Bitwarden 采用，减少运行时开销 |
| 异步 | **Kotlin Coroutines + Flow** | — | 响应式数据流，与 Compose 的 `collectAsState()` 无缝集成 |
| 网络 | **Ktor Client** | 3.x | 与 Kotlin 原生契合，支持 WebSocket，轻量 |
| 本地存储 | **Room** | 2.7+ | SQLite ORM，与 Flow 结合实现自动 UI 刷新 |
| 安全存储 | **AndroidX Security (EncryptedSharedPreferences)** | 1.1+ | 基于 Android Keystore 的加密 SharedPreferences |
| 数据库加密 | **SQLCipher** (可选) | 4.x | 对整个数据库文件加密，增强本地安全性 |
| 生物识别 | **AndroidX Biometrics** | 1.4+ | 官方封装，支持 CryptoObject |
| 自动填充 | **AndroidX Autofill** | 系统 API | `AutofillService` 系统级集成 |
| 凭据管理 | **AndroidX Credentials** | 1.7+ | `CredentialProviderService` Passkey 支持 |
| 序列化 | **kotlinx.serialization** | 1.8+ | 与 Kotlin 原生契合，多平台类型共享 |
| 条码扫描 | **ZXing / ML Kit** | — | TOTP 二维码扫描 |
| 日志 | **Timber** | 5.x | 结构化日志，发布环境自动静默 |
| 测试 | **JUnit 5 + MockK + Turbine** | — | Bitwarden 验证的测试组合 |

**为什么不使用跨平台框架（Flutter/React Native）**：

Bitwarden 明确从 Xamarin/.NET MAUI 迁移到 Kotlin/Swift 原生开发，原因是：
1. `AutofillService` 和 `CredentialProviderService` 需要系统级 Service 组件，跨平台框架难以完整暴露
2. 生物识别 + Keystore 的 `CryptoObject` 绑定需要原生 API
3. 安全关键型应用需要最小化抽象层，减少攻击面
4. Jetpack Compose 的声明式 UI 已提供与 Flutter 相当的开发效率

---

## 3. 项目结构

```text
apps/android/
├── app/
│   ├── src/main/java/com/pwbook/
│   │   ├── PwBookApplication.kt          # Application 类，初始化 Timber、Hilt
│   │   ├──
│   │   ├── data/                         # 数据层（Repository + DAO + Entity）
│   │   │   ├── local/                    # 本地数据库（Room）
│   │   │   │   ├── PwBookDatabase.kt
│   │   │   │   ├── dao/
│   │   │   │   │   ├── CipherDao.kt
│   │   │   │   │   ├── DomainAssocDao.kt
│   │   │   │   │   ├── SyncQueueDao.kt
│   │   │   │   │   ├── SettingDao.kt
│   │   │   │   │   └── RejectedSiteDao.kt
│   │   │   │   └── entity/
│   │   │   │       ├── CipherEntity.kt
│   │   │   │       ├── DomainAssocEntity.kt
│   │   │   │       ├── SyncQueueEntity.kt
│   │   │   │       ├── SettingEntity.kt
│   │   │   │       └── RejectedSiteEntity.kt
│   │   │   ├── remote/                   # 网络层（Ktor Client）
│   │   │   │   ├── api/
│   │   │   │   │   ├── AuthApi.kt
│   │   │   │   │   ├── SyncApi.kt
│   │   │   │   │   ├── CipherApi.kt
│   │   │   │   │   └── DomainAssocApi.kt
│   │   │   │   ├── dto/
│   │   │   │   │   ├── CipherDto.kt
│   │   │   │   │   ├── SyncResponseDto.kt
│   │   │   │   │   └── ...
│   │   │   │   └── websocket/
│   │   │   │       └── SyncWebSocketClient.kt
│   │   │   ├── repository/
│   │   │   │   ├── CipherRepository.kt
│   │   │   │   ├── SyncRepository.kt
│   │   │   │   ├── SettingsRepository.kt
│   │   │   │   └── DomainAssocRepository.kt
│   │   │   └── datasource/
│   │   │       ├── EncryptedPrefsDataSource.kt   # EncryptedSharedPreferences
│   │   │       └── SecureKeyDataSource.kt        # Android Keystore 密钥管理
│   │   ├──
│   │   ├── domain/                       # 业务逻辑层（UseCase + Model）
│   │   │   ├── model/
│   │   │   │   ├── Cipher.kt             # 解密后的业务模型
│   │   │   │   ├── LoginData.kt
│   │   │   │   ├── PasskeyData.kt
│   │   │   │   ├── DomainAssociation.kt
│   │   │   │   └── UserProfile.kt
│   │   │   ├── usecase/
│   │   │   │   ├── UnlockVaultUseCase.kt
│   │   │   │   ├── GeneratePasswordUseCase.kt
│   │   │   │   ├── GetMatchingCredentialsUseCase.kt
│   │   │   │   ├── CopyPasswordUseCase.kt
│   │   │   │   └── GenerateTotpCodeUseCase.kt
│   │   │   └── matcher/
│   │   │       └── UriMatcher.kt         # URI 匹配逻辑（与 Edge 端对齐）
│   │   ├──
│   │   ├── crypto/                       # 加密核心（与 Edge 端协议兼容）
│   │   │   ├── KdfEngine.kt              # Argon2id / PBKDF2 抽象
│   │   │   ├── AesGcmEngine.kt           # AES-256-GCM 加解密
│   │   │   ├── KeyDerivation.kt          # Master Key → Stretched Master Key
│   │   │   ├── VaultEncryption.kt        # 保险库数据加解密
│   │   │   ├── PasskeyCrypto.kt          # Passkey 密钥对生成（EC P-256）
│   │   │   └── SecureMemory.kt           # 敏感数据内存保护
│   │   ├──
│   │   ├── service/                      # Android 系统服务
│   │   │   ├── autofill/                 # 自动填充服务
│   │   │   │   ├── PwBookAutofillService.kt
│   │   │   │   ├── StructureParser.kt    # AssistStructure 解析
│   │   │   │   ├── FillResponseBuilder.kt
│   │   │   │   └── SaveRequestHandler.kt
│   │   │   ├── credential/               # Credential Provider（Passkey）
│   │   │   │   ├── PwBookCredentialProviderService.kt
│   │   │   │   ├── PasskeyCreateHandler.kt
│   │   │   │   ├── PasskeyGetHandler.kt
│   │   │   │   └── WebAuthnResponseBuilder.kt
│   │   │   └── biometric/                # 生物识别解锁
│   │   │       ├── BiometricUnlockManager.kt
│   │   │       └── KeystoreHelper.kt
│   │   ├──
│   │   ├── sync/                         # 同步客户端
│   │   │   ├── SyncManager.kt            # 同步调度核心
│   │   │   ├── PendingChangesQueue.kt    # 离线变更队列
│   │   │   ├── SyncWorker.kt             # WorkManager 后台同步任务
│   │   │   └── ConflictResolver.kt       # last-write-wins 实现
│   │   ├──
│   │   ├── ui/                           # UI 层（Jetpack Compose）
│   │   │   ├── theme/
│   │   │   │   ├── Color.kt
│   │   │   │   ├── Type.kt
│   │   │   │   └── Theme.kt
│   │   │   ├── navigation/
│   │   │   │   └── PwBookNavHost.kt
│   │   │   ├── screens/
│   │   │   │   ├── unlock/UnlockScreen.kt
│   │   │   │   ├── vault/VaultListScreen.kt
│   │   │   │   ├── vault/CipherDetailScreen.kt
│   │   │   │   ├── edit/CipherEditScreen.kt
│   │   │   │   ├── generator/PasswordGeneratorScreen.kt
│   │   │   │   ├── settings/SettingsScreen.kt
│   │   │   │   └── sync/SyncStatusScreen.kt
│   │   │   ├── components/
│   │   │   │   ├── CipherCard.kt
│   │   │   │   ├── TotpDisplay.kt
│   │   │   │   ├── PasswordStrengthIndicator.kt
│   │   │   │   └── SearchBar.kt
│   │   │   └── viewmodel/
│   │   │       ├── VaultViewModel.kt
│   │   │       ├── CipherEditViewModel.kt
│   │   │       ├── UnlockViewModel.kt
│   │   │       └── SettingsViewModel.kt
│   │   ├──
│   │   └── di/                           # Hilt 依赖注入模块
│   │       ├── AppModule.kt
│   │       ├── DatabaseModule.kt
│   │       ├── NetworkModule.kt
│   │       ├── CryptoModule.kt
│   │       └── ServiceModule.kt
│   │
│   ├── src/main/res/
│   │   ├── xml/
│   │   │   ├── autofill_service.xml      # AutofillService 配置
│   │   │   └── credential_provider.xml   # CredentialProvider 配置
│   │   └── values/
│   │       └── strings.xml
│   │
│   └── build.gradle.kts
│
└── gradle/libs.versions.toml
```

---

## 4. 核心模块详细设计

### 4.1 UI 层（Jetpack Compose）

**状态管理**: Compose `State<T>` + ViewModel + `collectAsStateWithLifecycle()`

```kotlin
@Composable
fun VaultListScreen(viewModel: VaultViewModel = hiltViewModel()) {
    val ciphers by viewModel.ciphers.collectAsStateWithLifecycle()
    val isLocked by viewModel.isLocked.collectAsStateWithLifecycle()
    val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()

    if (isLocked) {
        UnlockScreen(onUnlock = viewModel::unlock)
        return
    }

    Scaffold(
        topBar = { SearchBar(query = searchQuery, onQueryChange = viewModel::search) },
        floatingActionButton = {
            FloatingActionButton(onClick = { /* navigate to add */ }) {
                Icon(Icons.Default.Add, contentDescription = "添加")
            }
        }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding)) {
            items(ciphers, key = { it.id }) { cipher ->
                CipherCard(
                    cipher = cipher,
                    onClick = { /* detail */ },
                    onCopyPassword = viewModel::copyPassword
                )
            }
        }
    }
}
```

**导航**: AndroidX Navigation Compose，单 Activity 架构

```kotlin
@Composable
fun PwBookNavHost(navController: NavHostController) {
    NavHost(navController, startDestination = "unlock") {
        composable("unlock") { UnlockScreen(...) }
        composable("vault") { VaultListScreen(...) }
        composable("cipher/{id}") { backStack ->
            CipherDetailScreen(id = backStack.arguments?.getString("id")!!)
        }
        composable("edit?cipherId={cipherId}") { ... }
        composable("generator") { PasswordGeneratorScreen(...) }
        composable("settings") { SettingsScreen(...) }
    }
}
```

**关键 UI 规范**:
- 保险库列表：按名称字母序排列，收藏项置顶
- 搜索：实时过滤，支持按用户名、域名、备注搜索
- TOTP 显示：6 位数字 + 30 秒环形倒计时进度条
- 密码生成器：滑块调长度 + 字符类型开关 + 即时预览
- 复制密码后：底部 Snackbar 提示「密码已复制，10 秒后清除」

---

### 4.2 数据层（Room + Repository）

**数据库 Schema**（与 data-model.md 对齐）：

```kotlin
@Entity(tableName = "ciphers")
data class CipherEntity(
    @PrimaryKey val id: UUID,
    val userId: UUID,
    val type: Int,              // 1=LOGIN, 2=CARD, 3=IDENTITY, 4=SECURE_NOTE
    val data: String,           // 加密后的 JSON（AES-256-GCM + Base64）
    val favorite: Boolean,
    val reprompt: Int,          // 0=NONE, 1=PASSWORD
    val createdAt: Instant,
    val modifiedAt: Instant
)

@Entity(tableName = "sync_queue")
data class SyncQueueEntity(
    @PrimaryKey val id: UUID,
    val cipherId: UUID,
    val operation: String,      // CREATE, UPDATE, DELETE
    val encryptedData: String?, // 加密后的完整凭据数据
    val clientTimestamp: Instant,
    val retryCount: Int = 0,
    val createdAt: Instant = Instant.now()
)

@Entity(tableName = "domain_associations")
data class DomainAssocEntity(
    @PrimaryKey val id: UUID,
    val userId: UUID,
    val domains: String,        // JSON 数组序列化
    val packageNames: String,   // JSON 数组序列化
    val createdAt: Instant
)

@Entity(tableName = "rejected_sites")
data class RejectedSiteEntity(
    @PrimaryKey val id: UUID,
    val userId: UUID,
    val domain: String,
    val rejectedAt: Instant,
    val expireAt: Instant
)
```

**Repository 模式**:

```kotlin
interface CipherRepository {
    fun getAllCiphers(): Flow<List<Cipher>>
    fun getCipherById(id: UUID): Flow<Cipher?>
    fun searchCiphers(query: String): Flow<List<Cipher>>
    suspend fun saveCipher(cipher: Cipher): Result<Unit>
    suspend fun deleteCipher(id: UUID): Result<Unit>
    suspend fun getMatchingCredentials(uri: String, rules: List<DomainAssociation>): List<Cipher>
}

class CipherRepositoryImpl @Inject constructor(
    private val cipherDao: CipherDao,
    private val crypto: VaultEncryption,
    private val syncQueue: PendingChangesQueue
) : CipherRepository {
    override fun getAllCiphers(): Flow<List<Cipher>> =
        cipherDao.getAll()
            .map { entities ->
                entities.map { crypto.decryptCipher(it) }
            }
            .flowOn(Dispatchers.IO)

    override suspend fun saveCipher(cipher: Cipher): Result<Unit> = runCatching {
        val encrypted = crypto.encryptCipher(cipher)
        cipherDao.upsert(encrypted)
        syncQueue.enqueue(SyncOperation.UPDATE, encrypted)
    }
}
```

---

### 4.3 加密核心（与 Edge 端协议兼容）

Android 端必须实现与 Edge 插件完全一致的加密协议（参见 [contracts/crypto.md](contracts/crypto.md)），确保同一账号的保险库数据可跨端互解密。

**关键实现点**:

| 算法 | Android API | 说明 |
|------|-------------|------|
| Argon2id | **BouncyCastle** 或 **libsodium** JNI | Android 原生不内置 Argon2，需引入第三方库 |
| PBKDF2-SHA256 | `SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")` | 内置支持 |
| HKDF-SHA256 | BouncyCastle `HKDFBytesGenerator` | 扩展 Master Key |
| AES-256-GCM | `Cipher.getInstance("AES/GCM/NoPadding")` | 内置支持 |
| RSA-2048 | `KeyPairGenerator.getInstance("RSA")` | 内置支持 |

**Argon2id 在 Android 上的实现**:

```kotlin
// 方案 A: BouncyCastle（纯 Kotlin/Java，无 JNI 依赖）
implementation("org.bouncycastle:bcprov-jdk18on:1.79")

fun argon2idHash(
    password: ByteArray,
    salt: ByteArray,
    memoryKb: Int = 65536,
    iterations: Int = 3,
    parallelism: Int = 4,
    outputLength: Int = 32
): ByteArray {
    val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
        .withSalt(salt)
        .withMemoryAsKB(memoryKb)
        .withIterations(iterations)
        .withParallelism(parallelism)
        .build()

    val generator = Argon2BytesGenerator()
    generator.init(params)
    val result = ByteArray(outputLength)
    generator.generateBytes(password, result)
    return result
}

// 方案 B: libsodium JNI（性能更优，但增加 native 依赖）
// 如果 BouncyCastle 在低端设备上性能不足，可后续迁移
```

**VaultEncryption 接口**:

```kotlin
interface VaultEncryption {
    // 使用 User Key 加解密保险库数据
    fun encryptCipher(cipher: Cipher): CipherEntity
    fun decryptCipher(entity: CipherEntity): Cipher

    // 从主密码派生 Master Key
    suspend fun deriveMasterKey(password: String, email: String, kdfConfig: KdfConfig): ByteArray

    // 验证主密码（生成 masterPasswordHash）
    fun hashMasterKey(masterKey: ByteArray, password: String): ByteArray

    // 解密 Protected Key 获取 User Key
    fun decryptUserKey(protectedKey: String, stretchedMasterKey: ByteArray): ByteArray
}
```

**内存安全**: 解密后的 User Key 和主密码在内存中使用 `CharArray` / `ByteArray`，锁定后显式覆写（`Arrays.fill(array, 0)`），不依赖 GC 回收。

---

### 4.4 自动填充服务（AutofillService）

Android 自动填充服务是系统级组件，当用户在任意 App 的输入框聚焦时触发。

**Manifest 声明**:

```xml
<service
    android:name=".service.autofill.PwBookAutofillService"
    android:label="@string/app_name"
    android:permission="android.permission.BIND_AUTOFILL_SERVICE"
    android:exported="true">
    <intent-filter>
        <action android:name="android.service.autofill.AutofillService" />
    </intent-filter>
    <meta-data
        android:name="android.autofill"
        android:resource="@xml/autofill_service" />
</service>
```

**核心实现**:

```kotlin
class PwBookAutofillService : AutofillService() {

    @Inject lateinit var cipherRepository: CipherRepository
    @Inject lateinit var vaultEncryption: VaultEncryption
    @Inject lateinit var uriMatcher: UriMatcher

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        // 1. 检查保险库是否已解锁
        if (!vaultEncryption.isUnlocked()) {
            callback.onSuccess(buildAuthenticationResponse(request))
            return
        }

        // 2. 解析 AssistStructure
        val structure = request.fillContexts.last().structure
        val parser = StructureParser(structure)
        val parsed = parser.parse()  // 提取 usernameId, passwordId, webDomain, packageName

        // 3. 构建填充上下文 URI
        val contextUri = parsed.webDomain?.let { "https://$it" }
            ?: parsed.packageName?.let { "androidapp://$it" }
            ?: run { callback.onSuccess(null); return }

        // 4. 查询匹配凭据
        val rules = runBlocking { domainAssocRepository.getAllRules() }
        val matches = runBlocking {
            cipherRepository.getMatchingCredentials(contextUri, rules)
        }

        if (matches.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        // 5. 构建 FillResponse
        val response = FillResponse.Builder()
            .apply {
                matches.forEach { cipher ->
                    addDataset(buildDataset(cipher, parsed))
                }
                // 设置保存信息（如果检测到新表单）
                parsed.saveInfo?.let { setSaveInfo(it) }
            }
            .build()

        callback.onSuccess(response)
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.last().structure
        val parser = StructureParser(structure)
        val (username, password, uri) = parser.extractSubmittedData()

        // 检查拒绝列表
        if (rejectedSiteRepository.isRejected(uri)) {
            callback.onSuccess()
            return
        }

        // 保存到保险库（弹出确认由系统 UI 处理）
        // ...
        callback.onSuccess()
    }
}
```

**StructureParser 解析逻辑**:

```kotlin
class StructureParser(private val structure: AssistStructure) {

    fun parse(): ParsedStructure {
        val nodes = mutableListOf<ViewNode>()
        traverseStructure(structure) { nodes.add(it) }

        val usernameNode = findUsernameField(nodes)
        val passwordNode = findPasswordField(nodes)
        val webDomain = structure.activityComponent?.packageName?.let { null }
            ?: extractWebDomain(nodes)

        return ParsedStructure(
            usernameId = usernameNode?.autofillId,
            passwordId = passwordNode?.autofillId,
            webDomain = webDomain,
            packageName = structure.activityComponent?.packageName,
            saveInfo = buildSaveInfo(usernameNode, passwordNode)
        )
    }

    private fun findUsernameField(nodes: List<ViewNode>): ViewNode? {
        // 优先级：autofillHints > hint文本 > id包含username/email
        return nodes.firstOrNull { node ->
            node.autofillHints?.any {
                it in listOf(View.AUTOFILL_HINT_USERNAME, View.AUTOFILL_HINT_EMAIL_ADDRESS)
            } == true
        } ?: nodes.firstOrNull { node ->
            node.hint?.contains("账号", ignoreCase = true) == true ||
            node.hint?.contains("用户名", ignoreCase = true) == true ||
            node.hint?.contains("email", ignoreCase = true) == true
        }
    }

    private fun findPasswordField(nodes: List<ViewNode>): ViewNode? {
        return nodes.firstOrNull { node ->
            node.autofillHints?.contains(View.AUTOFILL_HINT_PASSWORD) == true
        } ?: nodes.firstOrNull { node ->
            node.inputType == (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        }
    }
}
```

**与 Edge 端自动填充的差异**:

| 方面 | Edge 插件 | Android AutofillService |
|------|----------|------------------------|
| 触发时机 | Content Script 注入所有页面 | 系统调用 `onFillRequest` |
| 表单检测 | DOM 遍历 + MutationObserver | `AssistStructure` 树遍历 |
| 字段识别 | 语义分析 + 启发式匹配 | `autofillHints` + 输入类型 + 启发式 |
| 填充方式 | JavaScript 直接设置 input.value | `AutofillValue.forText()` |
| 内联菜单 | 自定义 Web Component | Android 11+ `InlinePresentation` |
| 保存提示 | 自定义弹窗 | 系统 `SaveInfo` UI |
| 跨 iframe | 支持同域 iframe | `AssistStructure` 包含所有窗口 |
| SPA 支持 | `history.pushState` 监听 | 每次聚焦重新触发 |

**降级策略（FR-022）**: 当无法识别用户名/密码字段时，静默返回 `null`（不填充也不报错）。

---

### 4.5 Passkey / Credential Provider

Android 14+ 引入 `CredentialProviderService` 替代旧版 FIDO2 API，实现系统级 Passkey 支持。

**Manifest 声明**:

```xml
<service
    android:name=".service.credential.PwBookCredentialProviderService"
    android:enabled="true"
    android:exported="true"
    android:permission="android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE">
    <intent-filter>
        <action android:name="android.service.credentials.CredentialProviderService" />
    </intent-filter>
    <meta-data
        android:name="android.credentials.provider"
        android:resource="@xml/credential_provider" />
</service>
```

**Credential Provider 配置** (`res/xml/credential_provider.xml`):

```xml
<credential-provider
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:settingsSubtitle="@string/app_name"
    android:settingsActivity="com.pwbook.ui.screens.settings.SettingsActivity">
    <capabilities>
        <capability name="android.credentials.TYPE_PASSWORD_CREDENTIAL" />
        <capability name="androidx.credentials.TYPE_PUBLIC_KEY_CREDENTIAL" />
    </capabilities>
</credential-provider>
```

**两阶段流程实现**:

```kotlin
class PwBookCredentialProviderService : CredentialProviderService() {

    @Inject lateinit var cipherRepository: CipherRepository
    @Inject lateinit var vaultEncryption: VaultEncryption

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        if (!vaultEncryption.isUnlocked()) {
            // 返回认证操作，用户需先解锁
            callback.onResult(BeginGetCredentialResponse(
                authenticationActions = listOf(
                    AuthenticationAction(
                        title = "解锁密码库",
                        pendingIntent = createUnlockPendingIntent()
                    )
                )
            ))
            return
        }

        val entries = mutableListOf<CredentialEntry>()

        request.beginGetCredentialOptions.forEach { option ->
            when (option) {
                is BeginGetPublicKeyCredentialOption -> {
                    // Passkey 登录请求
                    entries.addAll(getPasskeyEntries(option))
                }
                is BeginGetPasswordCredentialOption -> {
                    // 密码登录请求
                    entries.addAll(getPasswordEntries(option))
                }
            }
        }

        callback.onResult(BeginGetCredentialResponse(entries))
    }

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        val response = when (request) {
            is BeginCreatePublicKeyCredentialRequest -> handlePasskeyCreateQuery(request)
            else -> null
        }
        callback.onResult(response)
    }

    private fun getPasskeyEntries(option: BeginGetPublicKeyCredentialOption): List<PublicKeyCredentialEntry> {
        val requestJson = option.requestJson
        val rpId = extractRpId(requestJson)
        val passkeys = runBlocking { cipherRepository.getPasskeysByRpId(rpId) }

        return passkeys.map { passkey ->
            val data = Bundle().apply { putString("credentialId", passkey.credentialId) }
            PublicKeyCredentialEntry(
                context = applicationContext,
                username = passkey.userName ?: "",
                pendingIntent = createPendingIntent(ACTION_GET_PASSKEY, data),
                beginGetPublicKeyCredentialOption = option
            )
        }
    }

    private fun handlePasskeyCreateQuery(request: BeginCreatePublicKeyCredentialRequest): BeginCreateCredentialResponse {
        val entries = mutableListOf<CreateEntry>()

        // 查询是否已有该站点的 LOGIN 凭据
        val existingLogins = runBlocking {
            cipherRepository.getLoginsByDomain(extractRpId(request.requestJson))
        }

        if (existingLogins.isNotEmpty()) {
            // 提供「保存到现有凭据」选项
            entries.add(CreateEntry(
                accountId = SAVE_TO_EXISTING_ID,
                pendingIntent = createPendingIntent(ACTION_CREATE_PASSKEY_EXISTING, Bundle())
            ))
        }

        // 提供「新建凭据」选项
        entries.add(CreateEntry(
            accountId = CREATE_NEW_ID,
            pendingIntent = createPendingIntent(ACTION_CREATE_PASSKEY_NEW, Bundle())
        ))

        return BeginCreateCredentialResponse(entries)
    }
}
```

**Passkey 创建 Activity**（处理实际的密钥生成和 WebAuthn 响应）：

```kotlin
class PasskeyCreateActivity : AppCompatActivity() {

    @Inject lateinit var crypto: PasskeyCrypto

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val request = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
        val publicKeyRequest = request?.callingRequest as? CreatePublicKeyCredentialRequest
            ?: run { finish(); return }

        // 1. 生物识别认证
        authenticateBiometric {
            // 2. 生成密钥对（EC P-256）
            val keyPair = crypto.generateKeyPair()
            val credentialId = ByteArray(32).apply { SecureRandom().nextBytes(this) }

            // 3. 构造 WebAuthn Attestation Response
            val response = AuthenticatorAttestationResponse(
                keyPairAlias = crypto.saveKeyPair(credentialId, keyPair),
                // ... 其他 WebAuthn 字段
            )

            // 4. 保存到保险库（作为 LOGIN 凭据的 passkey 字段）
            savePasskeyToVault(credentialId, keyPair, publicKeyRequest)

            // 5. 返回结果
            val result = Intent()
            PendingIntentHandler.setCreateCredentialResponse(
                result,
                CreatePublicKeyCredentialResponse(response.json())
            )
            setResult(RESULT_OK, result)
            finish()
        }
    }
}
```

**与 Edge 端 Passkey 的互操作性**:
- Passkey 私钥使用 `Cipher.getInstance("AES/GCM/NoPadding")` 加密后存储在保险库中（与 Edge 端相同的 AES-256-GCM 协议）
- 私钥本身使用 Android Keystore 生成和保护（创建时标记 `setUserAuthenticationRequired(true)`）
- 保险库中的 `passkey.privateKey` 字段存储的是 Keystore 别名，而非原始私钥字节
- 当 Passkey 数据同步到 Edge 端时，Edge 端只能看到加密后的保险库数据，解密后获取 JWK 格式的私钥进行 WebAuthn 操作

---

### 4.6 生物识别解锁

Android 端支持指纹/面部识别作为快捷解锁方式（FR-016）。Edge 插件端不支持生物识别。

**密钥设计**: 不解锁 User Key 本身，而是加密存储一个「生物识别密钥」，用该密钥解密 User Key。

```kotlin
class BiometricUnlockManager @Inject constructor(
    private val secureKeyDataSource: SecureKeyDataSource,
    private val encryptedPrefs: EncryptedSharedPreferences
) {

    /**
     * 首次启用生物识别时：
     * 1. 生成随机 Biometric Key（32 字节）
     * 2. 用 Biometric Key 加密 User Key
     * 3. 将 Biometric Key 存入 Android Keystore（要求生物识别认证）
     * 4. 将加密后的 User Key 存入 EncryptedSharedPreferences
     */
    fun setupBiometricUnlock(userKey: ByteArray): Boolean {
        val biometricKey = generateRandomBytes(32)
        val encryptedUserKey = encryptWithKey(userKey, biometricKey)

        // 将 biometricKey 存入 Keystore，要求每次使用时生物识别认证
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)

        val keyGenerator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
        keyGenerator.init(KeyGenParameterSpec.Builder(
            BIOMETRIC_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .build())
        keyGenerator.generateKey()

        encryptedPrefs.edit()
            .putString(PREF_ENCRYPTED_USER_KEY, base64Encode(encryptedUserKey))
            .putBoolean(PREF_BIOMETRIC_ENABLED, true)
            .apply()

        return true
    }

    /**
     * 生物识别解锁流程：
     * 1. 显示 BiometricPrompt
     * 2. 认证成功后，从 Keystore 获取 Biometric Key
     * 3. 用 Biometric Key 解密 User Key
     * 4. User Key 加载到内存，保险库解锁
     */
    fun unlockWithBiometric(activity: FragmentActivity, onSuccess: (ByteArray) -> Unit) {
        val cipher = getBiometricCipher()  // 初始化需要 Keystore 密钥的 Cipher

        val biometricPrompt = BiometricPrompt(activity, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: AuthenticationResult) {
                    val biometricKey = result.cryptoObject?.cipher?.doFinal(
                        encryptedPrefs.getString(PREF_BIOMETRIC_KEY_IV, "")!!.decodeBase64()
                    ) ?: return

                    val encryptedUserKey = encryptedPrefs.getString(PREF_ENCRYPTED_USER_KEY, "")!!.decodeBase64()
                    val userKey = decryptWithKey(encryptedUserKey, biometricKey)
                    onSuccess(userKey)
                }
            })

        biometricPrompt.authenticate(
            PromptInfo.Builder()
                .setTitle("指纹解锁")
                .setSubtitle("使用生物识别解锁密码库")
                .setAllowedAuthenticators(BIOMETRIC_STRONG)
                .build(),
            BiometricPrompt.CryptoObject(cipher)
        )
    }
}
```

**安全要点**:
- `setInvalidatedByBiometricEnrollment(true)`：新指纹注册时自动失效生物识别密钥
- `BIOMETRIC_STRONG`：仅接受 Class 3 生物识别（硬件安全、防欺骗）
- 生物识别失败 5 次后回退到主密码解锁
- 设备重启后首次解锁必须输入主密码（Keystore 要求）

---

### 4.7 同步客户端

**网络层**: Ktor Client + Kotlinx Serialization

```kotlin
class SyncApiClient @Inject constructor(
    private val prefs: EncryptedSharedPreferences
) {
    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
        install(WebSockets)
        defaultRequest {
            header(HttpHeaders.Authorization, "Bearer ${prefs.getJwtToken()}")
            contentType(ContentType.Application.Json)
        }
    }

    suspend fun getSync(since: Instant? = null): SyncResponse {
        return client.get("$BASE_URL/api/sync") {
            parameter("since", since?.toString())
        }.body()
    }

    suspend fun pushChanges(changes: List<PendingChangeDto>): PushResponse {
        return client.post("$BASE_URL/api/sync/push") {
            setBody(changes)
        }.body()
    }
}
```

**同步调度**: WorkManager + 应用生命周期触发

```kotlin
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    @Inject lateinit var syncManager: SyncManager

    override suspend fun doWork(): Result {
        return try {
            syncManager.performSync()
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        fun schedulePeriodic(context: Context) {
            val workRequest = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build())
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "pwbook_sync",
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
        }
    }
}
```

**触发时机**:
1. **定时**: WorkManager 每 15 分钟执行一次增量同步
2. **应用前台**: `ProcessLifecycleOwner` 监听 `ON_START`，强制同步一次
3. **WebSocket 推送**: 收到 `SYNC_REQUIRED` 消息时立即同步
4. **用户手动**: 下拉刷新或点击同步按钮
5. **本地变更后**: 保存凭据后立即触发一次推送（无需等待定时任务）

**离线队列处理**:

```kotlin
class PendingChangesQueue @Inject constructor(
    private val syncQueueDao: SyncQueueDao,
    private val syncApi: SyncApiClient
) {
    suspend fun enqueue(operation: SyncOperation, cipher: CipherEntity) {
        syncQueueDao.insert(SyncQueueEntity(
            id = UUID.randomUUID(),
            cipherId = cipher.id,
            operation = operation.name,
            encryptedData = cipher.data,
            clientTimestamp = Instant.now()
        ))
        // 如果在线，立即尝试同步
        SyncWorker.enqueueOneTime(appContext)
    }

    suspend fun processQueue(): SyncResult {
        val pending = syncQueueDao.getAllOrderedByTimestamp()
        if (pending.isEmpty()) return SyncResult.Success

        // 先拉取其他设备的变更
        syncApi.getSync(lastSyncAt)

        // 按顺序推送本地变更
        for (change in pending) {
            val result = pushChange(change)
            when (result) {
                is PushResult.Accepted -> syncQueueDao.delete(change.id)
                is PushResult.Conflict -> {
                    // last-write-wins：用本地版本覆盖
                    resolveConflict(change)
                }
                is PushResult.Failed -> {
                    syncQueueDao.incrementRetry(change.id)
                    break  // 停止处理，稍后重试
                }
            }
        }

        return SyncResult.Success
    }
}
```

---

### 4.8 TOTP 验证码

```kotlin
class TotpGenerator @Inject constructor() {

    fun generateCode(secret: String, timestamp: Long = System.currentTimeMillis()): TotpCode {
        val cleanSecret = secret.replace(" ", "").uppercase()
        val key = Base32.decode(cleanSecret)
        val counter = timestamp / 1000 / 30

        val data = ByteArray(8)
        var value = counter
        for (i in 7 downTo 0) {
            data[i] = (value and 0xFF).toByte()
            value = value shr 8
        }

        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(key, "HmacSHA1"))
        val hash = mac.doFinal(data)

        val offset = hash.last().toInt() and 0x0F
        val binary = ((hash[offset].toInt() and 0x7F) shl 24 or
                (hash[offset + 1].toInt() and 0xFF) shl 16 or
                (hash[offset + 2].toInt() and 0xFF) shl 8 or
                (hash[offset + 3].toInt() and 0xFF))
        val otp = binary % 1_000_000

        val remainingSeconds = 30 - ((timestamp / 1000) % 30)

        return TotpCode(
            code = otp.toString().padStart(6, '0'),
            remainingSeconds = remainingSeconds.toInt(),
            totalPeriod = 30
        )
    }
}
```

**UI 展示**: Compose 环形进度条 + 自动刷新

```kotlin
@Composable
fun TotpDisplay(secret: String) {
    var totp by remember { mutableStateOf(TotpGenerator().generateCode(secret)) }

    LaunchedEffect(Unit) {
        while (isActive) {
            delay(1000)
            totp = TotpGenerator().generateCode(secret)
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = totp.code,
            style = MaterialTheme.typography.headlineMedium,
            fontFamily = FontFamily.Monospace
        )
        CircularProgressIndicator(
            progress = { totp.remainingSeconds / totp.totalPeriod.toFloat() },
            modifier = Modifier.size(24.dp)
        )
    }
}
```

---

### 4.9 密码生成器

```kotlin
class PasswordGenerator @Inject constructor() {

    private val uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    private val lowercase = "abcdefghijklmnopqrstuvwxyz"
    private val numbers = "0123456789"
    private val special = "!@#$%^&*"
    private val ambiguous = "0O1lI"

    fun generate(options: PasswordOptions): String {
        var charset = ""
        if (options.includeUppercase) charset += uppercase
        if (options.includeLowercase) charset += lowercase
        if (options.includeNumbers) charset += numbers
        if (options.includeSpecial) charset += special
        if (options.excludeAmbiguous) charset = charset.filter { it !in ambiguous }

        require(charset.isNotEmpty()) { "至少选择一种字符类型" }

        val secureRandom = SecureRandom()
        return (1..options.length)
            .map { charset[secureRandom.nextInt(charset.length)] }
            .joinToString("")
    }
}
```

---

### 4.10 剪贴板安全（FR-017）

```kotlin
class SecureClipboardManager @Inject constructor(
    private val context: Context
) {
    private val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    private var clearJob: Job? = null

    fun copyPassword(password: String, scope: CoroutineScope) {
        // 写入剪贴板
        val clip = ClipData.newPlainText("password", password)
        clipboard.setPrimaryClip(clip)

        // 取消之前的定时器
        clearJob?.cancel()

        // 启动 10 秒倒计时
        clearJob = scope.launch {
            delay(10_000)
            clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
        }
    }

    fun cancelClearTimer() {
        clearJob?.cancel()
    }
}
```

---

## 5. 与 Edge 端功能对照表

| 功能 | Edge 插件 | Android App | 说明 |
|------|----------|-------------|------|
| 保险库查看/搜索 | ✅ | ✅ | Android 端额外支持按包名搜索 |
| 添加/编辑/删除凭据 | ✅ | ✅ | 数据模型完全一致 |
| 密码生成器 | ✅ | ✅ | 同一算法，同一默认参数 |
| TOTP 显示 | ✅ | ✅ | 同一 RFC 6238 实现 |
| 自动填充 | ✅（浏览器内） | ✅（系统级，所有 App） | Android 覆盖范围更广 |
| 保存密码提示 | ✅ | ✅（通过 `onSaveRequest`） | Android 由系统 UI 触发 |
| Passkey | ✅（WebAuthn 桥接） | ✅（CredentialProvider） | 私钥存储格式需跨端兼容 |
| 生物识别解锁 | ❌ | ✅ | Android 独占 |
| Cookie 同步 | ✅ | ❌ | spec 明确 Android 端不涉及 |
| 多端同步 | ✅ | ✅ | 同一同步协议 |
| 离线编辑 | ✅ | ✅ | 同一 pending changes 队列模型 |
| 剪贴板安全 | ✅ | ✅ | 同一 10 秒策略 |
| 域名关联 | ✅ | ✅ | 规则由服务端同步，两端共享 |
| 拒绝保存列表 | ✅（chrome.storage） | ✅（Room） | 本地存储，不同步 |

---

## 6. 安全方案

### 6.1 密钥存储层次

```
┌──────────────────────────────────────────────────────────────┐
│                        密钥存储架构                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  主密码          → 仅存在于用户记忆中，从不存储                  │
│                                                              │
│  User Key (64B)  → 内存中（解锁时）                            │
│                  → 生物识别场景：用 Biometric Key 加密后存       │
│                    EncryptedSharedPreferences                 │
│                                                              │
│  Biometric Key   → Android Keystore（要求生物识别认证）         │
│                                                              │
│  JWT Token       → EncryptedSharedPreferences                 │
│                                                              │
│  保险库数据       → Room 数据库（加密后的 blob）                │
│                                                              │
│  同步队列         → Room 数据库（加密后的 blob）                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 数据库加密（可选增强）

如需对 SQLite 数据库文件整体加密，引入 SQLCipher：

```kotlin
// Room + SQLCipher
val factory = SupportFactory(sqlitePassword)  // 从 User Key 派生
val db = Room.databaseBuilder(context, PwBookDatabase::class.java, "pwbook.db")
    .openHelperFactory(factory)
    .build()
```

**权衡**: SQLCipher 增加约 2MB APK 体积和一定的性能开销。对于个人使用的密码管理器，EncryptedSharedPreferences + 单独加密数据字段通常已足够。可作为 v2 增强项。

### 6.3 内存安全

```kotlin
object SecureMemory {
    /**
     * 敏感数据使用后立即清零，不依赖 GC
     */
    fun clear(array: ByteArray) {
        Arrays.fill(array, 0)
    }

    fun clear(array: CharArray) {
        Arrays.fill(array, ' ')
    }

    /**
     * 保险库锁定时，清零内存中的 User Key
     */
    fun purgeUserKey() {
        userKey?.let { clear(it) }
        userKey = null
    }
}
```

---

## 7. 构建与测试

### 7.1 Gradle 配置要点

```kotlin
// app/build.gradle.kts
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
    kotlin("plugin.serialization")
}

android {
    namespace = "com.pwbook"
    compileSdk = 35

    defaultConfig {
        minSdk = 28  // Android 9+，覆盖主流设备
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.15"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlinOptions {
        jvmTarget = "21"
    }
}

dependencies {
    // Compose
    implementation(platform("androidx.compose:compose-bom:2025.04.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.9")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.55")
    ksp("com.google.dagger:hilt-compiler:2.55")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")

    // Room
    implementation("androidx.room:room-runtime:2.7.0")
    implementation("androidx.room:room-ktx:2.7.0")
    ksp("androidx.room:room-compiler:2.7.0")

    // Ktor
    implementation("io.ktor:ktor-client-okhttp:3.1.0")
    implementation("io.ktor:ktor-client-content-negotiation:3.1.0")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.1.0")
    implementation("io.ktor:ktor-client-websockets:3.1.0")

    // Security
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.bouncycastle:bcprov-jdk18on:1.79")

    // Biometric
    implementation("androidx.biometric:biometric:1.4.0-alpha03")

    // Credentials (Passkey)
    implementation("androidx.credentials:credentials:1.7.0-alpha01")

    // WorkManager
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    // Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.0")

    // Testing
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testImplementation("io.mockk:mockk:1.13.14")
    testImplementation("app.cash.turbine:turbine:1.2.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
```

### 7.2 测试策略

| 类型 | 工具 | 覆盖范围 |
|------|------|---------|
| 单元测试 | JUnit 5 + MockK | Crypto、URI Matcher、Password Generator、TOTP、Sync Conflict Resolver |
| Flow 测试 | Turbine | Repository 返回的 Flow 状态序列 |
| Compose UI 测试 | Compose Test + Espresso | 屏幕交互、导航流程 |
| 集成测试 | Hilt Android Test | DAO + Repository + 数据库 |
| 加密兼容性测试 | 共享测试向量 | 验证 Android 加密结果与 Edge 端可互解密 |

**加密兼容性测试**（关键）:

```kotlin
@Test
fun `android encrypt should be decryptable by edge protocol`() {
    // 使用与 Edge 端相同的测试向量
    val userKey = hexToBytes("aabbccdd...")  // 64 bytes
    val plaintext = "{\"username\":\"test\",\"password\":\"secret\"}"

    // Android 端加密
    val encrypted = androidCrypto.encryptAesGcm(plaintext.toByteArray(), userKey)

    // 验证 Edge 端（JS Web Crypto）可解密
    val decrypted = edgeCrypto.decryptAesGcm(encrypted, userKey)
    assertEquals(plaintext, decrypted.decodeToString())
}
```

---

## 8. 与 Bitwarden Android 的对比总结

| 方面 | Bitwarden Android | pw-book Android | 差异说明 |
|------|-------------------|-----------------|----------|
| UI 框架 | Jetpack Compose | Jetpack Compose | 一致 |
| DI | Dagger Hilt | Dagger Hilt | 一致 |
| 网络 | Retrofit 2 + OkHttp | Ktor Client | Ktor 更轻量，与 Kotlin 原生契合 |
| 自动填充 | `AutofillService` | `AutofillService` | 一致 |
| Passkey | `CredentialProviderService` | `CredentialProviderService` | 一致 |
| 加密 | AES-256-CBC + HMAC | **AES-256-GCM** | pw-book 采用更现代的认证加密 |
| KDF | Argon2id / PBKDF2 | Argon2id / PBKDF2 | 一致 |
| 后端 | C# + ASP.NET Core | **Node.js + Fastify** | pw-book 轻量自托管 |
| 同步 | SignalR WebSocket | **WebSocket (ws) + REST 轮询** | 简化方案 |
| 离线编辑 | **不支持** | **支持** | pw-book 的差异化特性 |
| 数据库加密 | SQLCipher | Room（可选 SQLCipher） | 初期简化，后期增强 |
| 架构模式 | MVVM + Repository | MVVM + Repository | 一致 |
| 多模块 | app/core/data/network/ui | app（单模块起步） | pw-book 初期单模块，复杂后拆分 |

---

## 9. 实施优先级建议

### Phase 1: 基础保险库（MVP）
1. 项目搭建（Gradle、Hilt、Room、Compose Navigation）
2. 加密核心实现（Argon2id、AES-256-GCM、与 Edge 端协议对齐）
3. 解锁流程（主密码解锁）
4. 保险库列表 / 搜索 / 详情 / 编辑
5. 密码生成器
6. 本地存储（Room + Entity）

### Phase 2: 同步与自动填充
7. Ktor Client + 同步 API 对接
8. 离线变更队列（SyncQueue）
9. WorkManager 定时同步
10. `AutofillService` 实现（账号密码填充）
11. `onSaveRequest` 保存密码

### Phase 3: 增强安全与 Passkey
12. 生物识别解锁（BiometricPrompt + Keystore）
13. 剪贴板安全（10 秒自动清除）
14. TOTP 显示
15. `CredentialProviderService` Passkey 支持
16. 自动锁定（后台超时、无操作超时）

### Phase 4:  polish
17. 性能优化（LazyColumn、数据库索引、加密缓存）
18. 数据库加密（SQLCipher）
19. 单元测试覆盖 > 80%
20. 应用上架准备
