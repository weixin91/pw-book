# pw-book 代码审查报告

**审查日期**: 2026-05-05
**审查范围**: Android App、Backend、Edge Extension、packages/shared-types
**审查维度**: 安全漏洞、性能问题、稳定性、代码精简

---

## 执行摘要

本次审查共发现 **71 项问题**，按严重程度分布如下：

| 等级 | 数量 | 说明 |
|------|------|------|
| Critical (10) | 13 | 可能导致密码泄露或数据被篡改 |
| High (7-9) | 25 | 安全隐患、数据丢失风险或明显性能瓶颈 |
| Medium (5-6) | 22 | 需要关注但短期内风险可控 |
| Low (2-4) | 11 | 代码精简和轻微问题 |

**核心结论**: 项目目前存在多个**可导致密码直接泄露**的安全漏洞，主要集中在：

1. **密钥/密码被明文写入系统日志/磁盘** (Android Logcat、Edge chrome.storage.local)
2. **传输层安全缺失** (HTTP 明文通信、未验证的 WebSocket 地址)
3. **服务端数据隔离漏洞** (跨租户覆盖/删除)
4. **自动填充安全决策错误** (URI 子串匹配、Passkey UV 标志伪造)
5. **KDF 强度不足** (Edge PBKDF2 仅 1 次迭代)
6. **索引元数据未加密** (Android Room 索引表、Edge cipher-index)

**建议**: 优先修复全部 13 项 Critical 问题和 10 分制的 9 分以上问题(共 15 项)，再进行 High 级别修复。完整修复预计需 2-3 个迭代。

---

## 问题列表 (按推荐度倒序排列)

---

### 1. [CRITICAL] Android Logcat 泄漏主密钥与用户密钥
- **位置**: `apps/android/.../LoginViewModel.kt:103-126`, `UnlockVaultUseCase.kt:59-79`
- **类别**: 安全
- **推荐度**: 10/10
- **问题描述**: 登录和解锁流程中使用 `Timber` 将 `masterKey`、`encKey`、`macKey`、`decryptedUserKey` 的十六进制值以及 `masterPasswordHash` 的 Base64 值输出到 logcat。任何具有 `READ_LOGS` 权限的应用或 `adb` 连接均可读取。
- **影响**: 攻击者可获取主密钥，解密本地及同步到服务器的**所有密码、TOTP、Passkey 私钥**。
- **修改方案**: 立即删除所有密钥/哈希的 `Timber` 日志行。仅允许输出非敏感的操作结果（如"解锁成功"）。
- **是否业务必须**: 否。这些日志是调试代码，删除后**不影响任何功能**。

---

### 2. [CRITICAL] Edge 将 userKey 明文持久化存储在 chrome.storage.local
- **位置**: `apps/edge-extension/src/platform/storage.ts:158-169`
- **类别**: 安全
- **推荐度**: 10/10
- **问题描述**: "从不锁定"模式下，将解密的 `userKey`（64 字节 Uint8Array）直接写入 `chrome.storage.local`。该存储以明文 LevelDB 形式存放在用户数据目录，任何能访问文件系统的程序均可读取。
- **影响**: 主加密密钥以明文落盘，一旦设备被入侵或磁盘被离线分析，端到端加密形同虚设。
- **修改方案**: 1. 彻底移除向 `chrome.storage.local` 写入 `userKey` 的逻辑；2. "从不锁定"模式改用 `chrome.storage.session`（浏览器重启后失效），或每次启动要求重新输入主密码；3. 若必须免密，使用操作系统密钥链（Windows DPAPI / macOS Keychain）存储加密后的密钥。
- **是否业务必须**: 否。当前方案是便利性与安全的错误权衡，修改后用户需重新解锁，但数据安全大幅提升。
- **修复状态**: 不修复

---

### 3. [CRITICAL] Backend sync/push 接口存在跨租户覆盖/删除漏洞
- **位置**: `apps/backend/src/sync/routes.ts:111-158`
- **类别**: 安全
- **推荐度**: 10/10
- **问题描述**: `/api/sync/push` 处理每条 change 时，先用 `findUnique({where:{id}})` 检查是否存在，但未校验 `existing.userId` 是否等于当前用户。若存在则进入 `upsert` 的 update 分支，update 仅按 `id` 更新，未带 `userId` 过滤。DELETE 分支同理仅按 `id` 软删。
- **影响**: 经认证用户可**越权篡改/删除其他用户的密文凭据**。虽然密文受主密钥加密，但被覆盖后受害者将丢失原数据。
- **修改方案**: 在 push 循环中每条 change 都校验 `existing` 不存在或 `existing.userId === userId`，否则加入 `rejected`。update 改为 `prisma.cipher.update({where:{id, userId}, ...})`；DELETE 分支同理加入 ownership 校验。推荐整体包在 `prisma.$transaction` 中。
- **是否业务必须**: 否。这是严重的权限隔离缺陷，修复后**不会破坏正常同步**，反而能防止错误覆盖。

---

### 4. [CRITICAL] Android 全局允许明文流量(HTTP)
- **位置**: `apps/android/app/src/main/res/xml/network_security_config.xml`
- **类别**: 安全
- **推荐度**: 10/10
- **问题描述**: `network_security_config` 中设置 `<base-config cleartextTrafficPermitted="true" />`，允许所有域名的明文 HTTP 通信。
- **影响**: 若用户未配置 HTTPS 服务器地址，JWT Token、加密保险库数据、同步内容全部通过明文传输，可被中间人截获。
- **修改方案**: 将 `cleartextTrafficPermitted` 设为 `false`；若必须支持内网 HTTP，使用 `<domain-config>` 白名单严格限定，并强制默认使用 HTTPS。
- **是否业务必须**: 否。当前默认服务器地址为 `http://10.0.2.2:3000`（开发环境残留）。修改后开发测试需配置自签名证书或调试例外，生产环境**应强制 HTTPS**。
- **修复状态**: 不修复

---

### 5. [CRITICAL] Android HTTP 客户端记录完整请求/响应体
- **位置**: `apps/android/app/src/main/java/com/pwbook/di/NetworkModule.kt:44,75`
- **类别**: 安全
- **推荐度**: 10/10
- **问题描述**: Ktor 客户端配置 `Logging` 级别为 `LogLevel.BODY`，会记录所有 HTTP 请求和响应的完整 body（含 `accessToken`、`refreshToken`、加密保险库数据等）到系统日志。
- **影响**: Token 和加密数据被写入系统日志，可被其他应用或 adb 读取。
- **修改方案**: 将 `LogLevel.BODY` 改为 `LogLevel.NONE`（Release 环境），或在 `BuildConfig.DEBUG` 条件下动态启用。
- **是否业务必须**: 否。BODY 日志仅用于开发调试，生产环境必须关闭。**不影响功能**。

---

### 6. [CRITICAL] Android WebSocket 硬编码明文地址并泄漏 Token
- **位置**: `apps/android/app/src/main/java/com/pwbook/data/remote/websocket/SyncWebSocketClient.kt:89,94`
- **类别**: 安全
- **推荐度**: 10/10
- **问题描述**: WebSocket 地址硬编码为 `ws://10.0.2.2:3000/ws`（Android 模拟器回环地址），忽略用户配置的服务器地址，且使用明文 `ws://` 协议。连接成功后第一条消息以 JSON 明文发送 `accessToken`。
- **影响**: 同步通道完全明文，Token 被中间人截获后可冒充用户执行全量同步、删除数据等操作。
- **修改方案**: 使用用户配置的 `serverUrl` 动态生成 `wss://` 地址；将 token 放在安全的子协议头或 TLS 建立后的受控帧中。
- **是否业务必须**: 否。当前硬编码地址是开发残留，必须改为可配置并强制 wss。真机/生产环境**当前无法使用 WebSocket 同步**。

---

### 7. [CRITICAL] Android Passkey 生物识别不可用时伪造 UV 标志
- **位置**: `apps/android/app/src/main/java/com/pwbook/service/credential/PasskeyGetActivity.kt:282-286`, `crypto/PasskeyCrypto.kt:111`
- **类别**: 安全
- **推荐度**: 10/10
- **问题描述**: `authenticateWithBiometric()` 在设备无法提供 `BIOMETRIC_STRONG` 时直接返回 `true`，跳过用户验证。同时 `buildAuthenticatorData` 在 Get 流程中无条件设置 `flags |= 0x04` (UV=1)，向 RP 声称已完成用户验证。
- **影响**: 攻击者可在无生物识别/无密码的情况下直接使用 Passkey 完成认证，RP 侧因 UV=1 而信任该断言，造成身份冒用。
- **修改方案**: 生物识别不可用时必须返回 `false` 并取消断言签名；仅在实际完成生物识别或主密码验证后才设置 UV=1。无生物识别的设备需回退到主密码验证。
- **注意事项**: 密码库未解锁时，用户可能需要连续解锁两次（解锁密码库 + Passkey 主密码验证），需评估交互体验。
- **是否业务必须**: 否。当前实现为了"体验"在生物识别不可用时放行，但这直接破坏 WebAuthn 安全模型。修改后无生物识别的设备需回退验证，但**不会破坏正常流程**。

---

### 8. [CRITICAL] Android 自动填充 URI 匹配使用危险子串包含
- **位置**: `apps/android/.../ui/screens/VaultListScreen.kt:171-172`, `VaultListViewModel.kt:74-76`
- **类别**: 安全
- **推荐度**: 9/10
- **问题描述**: 凭据匹配逻辑使用 `targetUri.contains(uri)` 进行子串匹配。例如用户保存了 `https://example.com`，访问 `https://example.com.evil.com` 时也会匹配成功。
- **影响**: 攻击者注册包含合法域名的子域名即可诱骗自动填充，造成密码被填充到钓鱼站点。
- **修改方案**: 统一使用 `UriMatcher.isMatch()` 进行规范化域名级匹配，禁止直接使用 `String.contains()` 做 URI 安全决策。
- **是否业务必须**: 当前子串匹配是为了"模糊匹配"，但带来了严重的凭证混淆风险。应改用基于 baseDomain 的精确/规则匹配。功能不会异常，反而更安全。

---

### 9. [CRITICAL] Edge Cipher 索引元数据以明文存储
- **位置**: `apps/edge-extension/src/crypto/cipher-index.ts:22, 79-89`
- **类别**: 安全
- **推荐度**: 9/10
- **问题描述**: `CipherIndexService` 将 `cipherIndex` 数组（包含 `domains`、`rpIds`、`usernameHash`、`hasLogin`、`hasPasskey` 等字段）直接存入 `chrome.storage.local`。虽然 username 被 SHA-256 截断，但域名列表、rpId 列表、凭据类型标记均为明文。
- **影响**: 攻击者可通过读取本地存储获知用户拥有哪些网站账号、哪些有 Passkey，构成严重的隐私泄露。
- **修改方案**: 1. 将索引数据加密后存储（使用 HKDF 从 userKey 派生索引加密密钥，AES-GCM 加密整个索引数组）；2. 每次解锁时解密索引到内存，锁定时清除；3. 重建索引操作在内存中进行。
- **是否业务必须**: 当前明文索引是为了提升查询性能。可改用可搜索加密方案，或接受稍慢的查询以换取安全。功能不受影响。
- **修复状态**: 不修复

---

### 10. [CRITICAL] Edge WebAuthn postMessage 未验证 event.origin
- **位置**: `apps/edge-extension/src/content/webauthn-handler.ts:37-39`, `content/webauthn-page.ts:89-92`
- **类别**: 安全
- **推荐度**: 9/10
- **问题描述**: `webauthn-handler.ts` 的 message 监听器仅检查 `event.source !== window`，未验证 `event.origin`。`webauthn-page.ts` 发送消息时指定了 `targetOrigin`，但接收端未校验。
- **影响**: 恶意页面（通过 iframe 嵌入或 `window.open` 打开的钓鱼页面）可向扩展发送伪造的 WebAuthn 请求，可能导致凭据被错误注册到攻击者控制的 RP。
- **修改方案**: 在监听器中增加 `event.origin === window.location.origin` 校验；拒绝所有非当前页面 origin 的消息。
- **是否业务必须**: 否。这是安全校验缺失，修复后**不会破坏正常 WebAuthn 流程**。

---

### 11. [HIGH] Edge deriveMasterPasswordHash 仅使用 1 次 PBKDF2 迭代
- **位置**: `apps/edge-extension/src/crypto/crypto-service.ts:51-74`
- **类别**: 安全
- **推荐度**: 9/10
- **问题描述**: `deriveMasterPasswordHash` 在计算主密码哈希（用于服务端登录验证）时，PBKDF2 的 `iterations` 被硬编码为 `1`。
- **影响**: 主密码哈希极易被暴力破解。一旦服务端数据库泄露，攻击者可用极低成本穷举弱密码，进而解密用户保险库。
- **修改方案**: 将 `iterations` 提升至至少 `600,000`（OWASP 2023 推荐值），与 Android 端保持一致。**需同步修改 Backend** 的登录验证参数，否则两端不兼容。
- **是否业务必须**: 否。当前 1 次迭代是严重安全缺陷。提升至 600k 需要 Backend 同步调整，但属于正确修复。

---

### 12. [HIGH] Backend 恢复接口在服务器端处理明文恢复密钥
- **位置**: `apps/backend/src/auth/recover.ts:16-46`
- **类别**: 安全
- **推荐度**: 9/10
- **问题描述**: `/api/auth/recover` 接收明文 `recoveryKey`，并在服务端通过 `deriveRecoveryKeyHash` 用邮箱派生 salt+PBKDF2 计算 hash 与 `user.recoveryKeyHash` 比对。服务端在请求处理过程中持有恢复密钥明文。
- **影响**: 恢复密钥被服务端处理时一旦泄露（日志、内存 dump、错误上报），攻击者可越过端到端加密重置密码、获取保管库主密钥。
- **修改方案**: **客户端**用同一 KDF 派生 `recoveryKeyHash` 后再发送；服务端只比较哈希值（`crypto.timingSafeEqual`）。同时禁止在请求/响应日志中记录请求体，并对 `/recover` 增加严格速率限制（按邮箱+IP）。
- **是否业务必须**: 需配合客户端改造；过渡期至少应禁用请求体日志并加强速率限制。当前服务端处理明文违背 E2E 零知识原则。

---

### 13. [HIGH] Backend /api/auth/recover 缺少速率限制
- **位置**: `apps/backend/src/auth/recover.ts:35`
- **类别**: 安全
- **推荐度**: 9/10
- **问题描述**: 登录路由有 `loginRateLimitHook`，但 recover 路由没有任何速率限制。攻击者可对 recoveryKey（常为 24 字符的可打印随机串）持续暴力枚举。
- **影响**: 恢复密钥被持续爆破；一旦命中即可重置主密码并接管账号。
- **修改方案**: 为 `/recover` 增加更严格的速率限制（如 5 次/小时/邮箱），失败时延迟响应，必要时在多次失败后冻结账号或要求邮件验证。
- **是否业务必须**: 否。这是安全防护缺失，修复后不影响正常恢复流程。

---

### 14. [HIGH] Backend recover.ts 自建 PrismaClient，绕过单例
- **位置**: `apps/backend/src/auth/recover.ts:7`
- **类别**: 安全/稳定性
- **推荐度**: 8/10
- **问题描述**: `recover.ts` 直接 `new PrismaClient()`，没有复用 `db/prisma.ts` 的单例。开发热重载或多次模块求值会建立多个连接池。
- **影响**: 连接耗尽、配置不一致、测试 mock 失效。
- **修改方案**: 改为 `import { prisma } from '../db/prisma.js'`。
- **是否业务必须**: 否。简单修复，不影响功能。

---

### 15. [HIGH] Backend 缺少安全 HTTP 头（Helmet/CSP/HSTS）
- **位置**: `apps/backend/src/index.ts:19-40`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: Fastify 实例只注册了 cors，没有 `@fastify/helmet` 或等价的安全响应头中间件。
- **影响**: API 域被加载到 iframe 或被 XSS 注入时可能被滥用；缺少 HSTS 增加首次连接降级风险。
- **修改方案**: 注册 `@fastify/helmet`，开启 CSP（API 可设为非常严格）、HSTS（生产）、frameguard、noSniff、referrerPolicy。
- **是否业务必须**: 否。这是基础安全加固，不影响 API 功能。

---

### 16. [HIGH] Backend CORS 配置过于宽松（origin: true + credentials: true）
- **位置**: `apps/backend/src/index.ts:27-30`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: `origin: true` 会反射任何 Origin 并允许 credentials，等同于关闭跨域防护。当前认证基于 `Authorization header`（Bearer），cookie 风险较低。
- **影响**: 若未来引入 cookie 会话或 CSRF 敏感写接口，将允许任意网站携带凭据访问 API。
- **修改方案**: 通过环境变量配置允许的 origin 白名单（`chrome-extension://<id>`、本地开发地址）。或在使用 Bearer 的前提下设 `credentials: false`。
- **是否业务必须**: Edge 插件需要从 `chrome-extension` 协议访问；可通过白名单方式精确放开。不会影响正常访问。

---

### 17. [HIGH] Backend /api/auth/prelogin 暴露用户存在性
- **位置**: `apps/backend/src/auth/routes.ts:44-57`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: `prelogin` 直接返回 KDF 参数与 `encryptedRecoveryKey`，且未注册时返回 401。攻击者可枚举哪些邮箱已注册，并拿到 `encryptedRecoveryKey`（可离线爆破）。
- **修改方案**: 对未注册邮箱也返回一个稳定派生（per-email 确定性）的伪造 KDF 参数与随机但稳定的 `encryptedRecoveryKey` 占位；并对 prelogin 加速率限制。考虑不返回 `encryptedRecoveryKey`，仅在登录/恢复时返回。
- **是否业务必须**: 若客户端依赖 `encryptedRecoveryKey` 在 prelogin 阶段获取，需联动调整。当前返回方式导致用户枚举侧信道。
- **修复状态**: 不修复

---

### 18. [HIGH] Android 索引表以明文存储用户站点元数据
- **位置**: `apps/android/.../data/local/entity/CipherIndexEntity.kt`, `domain/index/CipherIndexBuilder.kt:64-91`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: `cipher_index` 表的 `domainsJson` 和 `rpIdsJson` 字段以明文 JSON 存储用户凭据关联的域名和 Passkey 的 rpId。
- **影响**: 攻击者或取证工具可直接读取数据库获知用户拥有哪些网站账号，构成严重的隐私泄露。
- **修改方案**: 对 `domainsJson`/`rpIdsJson` 进行加密存储（使用主密钥派生的索引加密密钥），或在查询时改为内存中动态解密。
- **是否业务必须**: 当前明文索引是为了提升自动填充查询性能。可改用可搜索加密方案，或接受稍慢的查询以换取安全。
- **修复状态**: 不修复

---

### 19. [HIGH] Android 剪贴板未标记敏感且明文留存密码
- **位置**: `apps/android/.../domain/usecase/CopyPasswordUseCase.kt:32-34,48-52`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: 复制密码时未使用 `ClipDescription.EXTRA_IS_SENSITIVE`（Android 13+），导致密码在系统剪贴板预览中可见。同时 `lastCopiedPassword` 以普通 `String` 保存在内存中。
- **影响**: 其他应用或系统 UI 可读取剪贴板中的密码；内存中的密码残留增加被提取风险。
- **修改方案**: 对 Android 13+ 设置 `EXTRA_IS_SENSITIVE`；使用 `CharArray` 并在超时或替换时显式 `fill(0)` 清理。
- **是否业务必须**: 否。修改后剪贴板行为更符合安全规范，不影响复制/清除功能。

---

### 20. [HIGH] Edge Pending 表单密码明文存储在 chrome.storage.local
- **位置**: `apps/edge-extension/src/background/background.ts:28-35, 69-71, 161-175`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: `FORM_SUBMITTED` 处理逻辑将包含 username 和 password 的表单数据写入 `chrome.storage.local`（键名为 `_pwbook_pending_${tabId}`），用于 Service Worker 终止后的恢复。虽然设置了 10 秒 TTL，但数据在 local storage 中以明文 JSON 存在。
- **影响**: 用户密码在本地磁盘上短暂明文存储，可被本地恶意程序或浏览器扩展读取。若浏览器在写入后崩溃，密码可能长期残留。
- **修改方案**: 1. 使用 `chrome.storage.session` 存储 pending 数据（SW 终止后自动清除）；2. 若必须使用 local，先用 userKey 加密后再存储；3. 启动时增加清理过期 pending 数据的逻辑。
- **是否业务必须**: 否。这是 SW 重启恢复机制，改用 session storage 或加密存储后功能不变。

---

### 21. [HIGH] Edge localStorage 桥接缺乏发送者校验
- **位置**: `apps/edge-extension/src/content/localstorage-bridge.ts:34-53`, `cookie/cookie-injector.ts:98-121`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: `initLocalStorageBridge` 监听 `chrome.runtime.onMessage`，对 `GET_LOCAL_STORAGE` 和 `SET_LOCAL_STORAGE` 消息未校验 `sender` 身份。
- **影响**: 恶意脚本或扩展可跨域读取/篡改用户 localStorage，窃取会话令牌、篡改应用状态。
- **修改方案**: 1. 校验 `sender.tab?.url` 的域名与目标 localStorage 域名是否匹配；2. 仅接受来自扩展自身 background script 的消息；3. 对 SET 增加白名单域名校验。
- **是否业务必须**: 否。这是权限校验缺失，修复后不影响正常 cookie 同步功能。

---

### 22. [HIGH] Edge 同步默认使用 HTTP 而非 HTTPS
- **位置**: `apps/edge-extension/src/platform/storage.ts:124-127`, `sync/sync-client.ts:15-20`, `sync/websocket-client.ts:28-30`
- **类别**: 安全
- **推荐度**: 8/10
- **问题描述**: `StorageService.getServerUrl` 默认返回 `"http://localhost:3000"`，SyncClient 和 WebSocketClient 直接使用该 URL 进行同步。
- **影响**: 生产环境中若用户未手动修改为 HTTPS，所有同步流量将以明文传输，中间人可截获 JWT Token、加密凭据等。
- **修改方案**: 1. 默认 URL 改为 `https://`；2. 在 SyncClient 中强制检查 `baseUrl` 以 `https://` 开头，拒绝 `http://`（localhost 开发环境可白名单）；3. WebSocket 同样强制 `wss://`。
- **是否业务必须**: 否。当前默认是开发环境配置，生产应强制 HTTPS。修改后开发需手动配置白名单。
- **修复状态**: 不修复

---

### 23. [HIGH] Android 缺少 Room 迁移 1→2 导致升级崩溃
- **位置**: `apps/android/.../data/local/AppDatabase.kt:30`, `di/DatabaseModule.kt:60-81`
- **类别**: 稳定性
- **推荐度**: 8/10
- **问题描述**: 数据库版本为 3，但只提供了 `MIGRATION_2_3`。若用户设备上存在版本 1 或 2 的数据库，应用启动时将抛出 `IllegalStateException` 崩溃。
- **影响**: 老用户升级后应用无法启动，数据虽在但无法访问，等同于数据丢失。
- **修改方案**: 补充 `MIGRATION_1_2`；若版本 1/2 从未发布，应在代码中注释说明并确保所有测试环境重建数据库。
- **是否业务必须**: 如果历史版本确实未对外发布，可接受；否则必须补齐迁移。这是一个风险点，建议补齐或加 `fallbackToDestructiveMigration()` 并注释。

---

### 24. [HIGH] Android 同步失败被静默吞掉
- **位置**: `apps/android/.../sync/SyncManager.kt:187-197`
- **类别**: 稳定性
- **推荐度**: 7/10
- **问题描述**: `syncAll()` 对 `pushPendingChanges()` 和 `incrementalSync()` 调用 `getOrNull()`，失败时返回 `null`，但最终始终返回 `Result.success()`。
- **影响**: 同步冲突、网络中断、服务器错误等被掩盖，用户界面可能显示"已同步"但实际数据未推送或未拉取，造成数据不一致。
- **修改方案**: 若 push 或 pull 失败，应返回 `Result.failure()` 并包含具体异常；UI 根据失败原因提示用户重试。
- **是否业务必须**: 当前实现是为了避免同步异常打断用户操作，但应至少将错误状态暴露给 UI。修改后用户体验会更好（看到真实状态）。

---

### 25. [HIGH] Android WebSocket 重连延迟整数溢出导致崩溃或风暴
- **位置**: `apps/android/.../data/remote/websocket/SyncWebSocketClient.kt:171-172`
- **类别**: 稳定性/性能
- **推荐度**: 7/10
- **问题描述**: `scheduleReconnect()` 使用 `1 shl reconnectAttempt` 计算延迟。当 `reconnectAttempt >= 31` 时，Int 左移产生负数；达到 32 时回绕为 1，导致重连风暴。
- **影响**: 长时间离线后应用崩溃；或进入高频重连风暴，耗尽电池和服务器资源。
- **修改方案**: 改用指数退避公式：`delayMs = min(1000L * 2.pow(reconnectAttempt), maxReconnectDelayMs)`，并将 `reconnectAttempt` 上限设为 8-10。
- **是否业务必须**: 否。纯实现缺陷，修复后重连行为更稳定。

---

### 26. [HIGH] Android 本地数据库未启用加密
- **位置**: `apps/android/.../data/local/AppDatabase.kt:30-32`, `di/DatabaseModule.kt:28-35`
- **类别**: 安全
- **推荐度**: 7/10
- **问题描述**: Room 数据库 `pwbook.db` 未使用 SQLCipher 或 Android 数据库加密。在已 root 设备或物理提取中，数据库文件可直接读取。
- **影响**: 虽然 `cipher.data` 已加密，但索引元数据、同步队列、设置、拒绝站点列表等全部明文暴露。
- **修改方案**: 集成 SQLCipher 或 `androidx.security` 数据库加密方案，使用独立的数据库加密密钥（可由生物识别或主密码保护）。
- **是否业务必须**: 加密数据库会增加少量初始化开销，不影响业务逻辑。对于密码管理器而言是合理投入。

---

### 27. [HIGH] Backend WebSocket 未限制消息体大小、未做认证超时
- **位置**: `apps/backend/src/websocket/server.ts:18-72`
- **类别**: 安全
- **推荐度**: 7/10
- **问题描述**: `WebSocketServer` 没有设置 `maxPayload`，攻击者可发送超大 JSON 触发 OOM。连接建立后没有认证超时。已认证连接不会因 `securityStamp` 变更而强制断开。
- **影响**: DoS/内存压力；账号恢复后旧设备 WS 仍能监听同步通知。
- **修改方案**: 1. `new WebSocketServer({server, path:'/ws', maxPayload: 64*1024})`；2. 连接 5s 内未完成 AUTH 则关闭；3. 周期性重新 verifyToken 并比对 securityStamp；4. recover/logout 时主动踢下线。
- **是否业务必须**: 否。安全加固，不影响正常 WebSocket 功能。

---

### 28. [HIGH] Backend 登录速率限制按邮箱单维度，且无 IP 维度
- **位置**: `apps/backend/src/rate-limiter.ts:13-83`
- **类别**: 安全
- **推荐度**: 7/10
- **问题描述**: `loginAttempts` 按 email 限速，攻击者轮换邮箱即可绕过；且 Map 永不清理。`/refresh`、`/prelogin`、`/recover` 均无任何限流。
- **影响**: 暴力破解可绕过；内存可被填充。
- **修改方案**: 增加 IP 维度限速（`@fastify/rate-limit`），同时保留 email 维度；定期清理过期条目；为 `/refresh` `/prelogin` `/recover` 增加全局/路径限速。
- **是否业务必须**: 否。安全防护增强，不影响正常登录。
- **修复状态**: 不修复

---

### 29. [HIGH] Backend Cipher CRUD 使用 findFirst 校验 + update/delete by id 的 TOCTOU 模式
- **位置**: `apps/backend/src/ciphers/routes.ts:55-94`
- **类别**: 安全
- **推荐度**: 7/10
- **问题描述**: PUT/DELETE/GET 先 `findFirst({id,userId})` 再 `update/delete({where:{id}})`，所有权校验与写操作分两步。POST 用 `findUnique({id})` 检查存在，会因他人占用相同 id 抛"ID 已存在"，泄露其他用户 ID 存在性。PUT 不过滤 `deletedAt`。
- **影响**: 竞态下可能绕过权限；可恢复软删数据；ID 枚举侧信道。
- **修改方案**: PUT 改为 `prisma.cipher.updateMany({where:{id, userId, deletedAt: null}, data:...})`；DELETE 同理；GET 加 `deletedAt: null`。POST 不必预查 id，靠 Prisma 唯一约束捕获 P2002 后返回 409，且对外用统一错误不区分原因。
- **是否业务必须**: 否。这是更安全的写法，功能不变。

---

### 30. [HIGH] Edge 同步冲突处理可能丢弃用户数据
- **位置**: `apps/edge-extension/src/sync/sync-scheduler.ts:128-135`
- **类别**: 稳定性
- **推荐度**: 7/10
- **问题描述**: `flushPendingChanges` 中对 conflicts 的处理：若 `retryCount >= 5` 则直接 `dequeue` 丢弃变更。
- **影响**: 在持续冲突场景下，本地修改可能永久丢失。
- **修改方案**: 1. 冲突时将凭据标记为"需手动解决"并提示用户；2. 实现 last-write-wins 策略（保留较新的 `modifiedAt`）；3. 将丢弃的变更备份到单独的 conflict storage 中。
- **是否业务必须**: 当前实现是简化策略，但数据丢失不可接受。建议改为 last-write-wins + 提示，不会破坏功能。
- **修复状态**: 不修复

---

### 31. [HIGH] Edge Manifest 声明 `<all_urls>` 和 `all_frames` 权限过宽
- **位置**: `apps/edge-extension/src/manifest.json:13-26`
- **类别**: 安全
- **推荐度**: 7/10
- **问题描述**: `host_permissions` 包含 `<all_urls>`，`content_scripts` 的 `matches` 也使用 `<all_urls>` 且 `all_frames: true`。
- **影响**: 扩展被入侵时，攻击者可读取所有网站内容、拦截所有表单提交。
- **修改方案**: 1. 将 `host_permissions` 改为按需申请（`activeTab` + 用户触发时临时权限）；2. 将 `all_frames` 改为 `false`（主 frame 已足够）；3. 在选项页中提供站点白名单配置。
- **是否业务必须**: 当前全量注入是为了自动填充的"无感"体验。改为按需/主 frame 后，用户可能需要在首次访问新站点时确认，但大幅降低了攻击面。
- **修复状态**: 不修复

---

### 32. [HIGH] Edge passkey-prompt.ts 使用 innerHTML
- **位置**: `apps/edge-extension/src/content/passkey-prompt.ts:113`
- **类别**: 安全
- **推荐度**: 7/10
- **问题描述**: `showPasskeySavePrompt` 中使用 `list.innerHTML = ""` 清空列表。候选数据通过 `textContent` 赋值，但 `innerHTML` 模式增加了未来误用风险。
- **影响**: 若后续代码修改引入动态 HTML 拼接，Bitwarden 导入数据中的恶意名称可导致 XSS。
- **修改方案**: 将 `list.innerHTML = ""` 改为 `while (list.firstChild) list.removeChild(list.firstChild)`；建立 ESLint 规则禁止在 content script 中使用 `innerHTML`。
- **是否业务必须**: 否。安全习惯改进，不影响功能。

---

### 33. [HIGH] Edge Cookie 同步未过滤 HttpOnly/Secure Cookie
- **位置**: `apps/edge-extension/src/cookie/cookie-extractor.ts:36-50, 56-80`
- **类别**: 安全
- **推荐度**: 7/10
- **问题描述**: `extractCookiesForDomain` 仅过滤了名称匹配 `SENSITIVE_PATTERNS` 的 Cookie，未按安全属性过滤。HttpOnly、Secure、SameSite=Strict 的 Cookie 仍会被提取并同步。
- **影响**: 将 HttpOnly Cookie 同步到其他设备可能绕过同源策略保护，增加会话劫持风险。
- **修改方案**: 1. 默认跳过 `httpOnly=true` 的 Cookie；2. 对 Secure Cookie 仅在目标站点支持 HTTPS 时注入；3. 在同步配置中增加显式开关，默认关闭。
- **是否业务必须**: 这是安全与便利的权衡。默认跳过 HttpOnly 后，部分需要 cookie 同步的高级场景可能受影响，但可通过配置开关恢复。
- **修复状态**: 不修复

---

### 34. [HIGH] Edge MV3 Service Worker 锁定时器在 SW 终止后失效
- **位置**: `apps/edge-extension/src/background/lock-timer.ts:25-33`
- **类别**: 安全/稳定性
- **推荐度**: 7/10
- **问题描述**: `startLockTimer` 使用 `setTimeout` 实现自动锁定。MV3 Service Worker 在空闲 30 秒后会被浏览器终止，`setTimeout` 不会保留。
- **影响**: SW 终止后，保险库可能长时间保持解锁状态，违反安全策略。
- **修改方案**: 使用 `chrome.alarms API`（已在 manifest 中声明权限）替代 `setTimeout`；创建 `"lockVault"` alarm，在解锁时设置延迟触发；在 alarm 回调中执行锁定逻辑。alarms 在 SW 重启后会自动恢复。
- **是否业务必须**: 否。这是 MV3 的已知限制，使用 alarms 是正确的实现方式。功能不受影响。

---

### 35. [HIGH] Edge 与 Android 域名匹配 TLD 列表不一致
- **位置**: `apps/edge-extension/src/autofill/domain-utils.ts:12-21`, `apps/android/.../domain/matcher/UriMatcher.kt:9-14`
- **类别**: 安全/精简
- **推荐度**: 8.5/10
- **问题描述**: Edge 端 `MULTI_PART_SUFFIXES` 有 21 个条目，Android 端 `MULTI_SEGMENT_TLDS` 有 26 个条目，内容不同。这导致同一 URI 在两端可能解析出不同的 baseDomain。
- **影响**: 用户在 Edge 保存的凭据在 Android 上可能无法匹配，反之亦然。跨平台自动填充行为不一致。
- **修改方案**: 将 TLD 列表提取为跨平台共享的单一数据源（如 JSON 配置文件），在构建时同步生成到各平台代码中。至少统一两个列表的并集。
- **是否业务必须**: 这是跨平台兼容的基础，不一致本身就是缺陷。统一后两端行为一致，不会破坏功能。

---

### 36. [HIGH] TOTP base32 解码错误处理不一致
- **位置**: `apps/edge-extension/src/crypto/totp.ts:34-37`, `apps/android/.../crypto/TotpGenerator.kt:78-80`
- **类别**: 安全/精简
- **推荐度**: 8/10
- **问题描述**: Edge 端 base32Decode 遇到非法字符时抛出 Error；Android 端使用 `continue` 静默忽略。同一 TOTP 密钥在两端可能解析失败或生成错误结果。
- **影响**: 用户导入含非法字符的 TOTP 密钥后，Edge 端无法使用，Android 端生成错误验证码，跨平台 TOTP 功能不可用。
- **修改方案**: 统一为抛出异常（严格模式），并在导入/解析层统一做清洗（去除空格、连字符）。两端行为必须一致。
- **是否业务必须**: 这是跨平台兼容缺陷，统一后功能更可靠。非法字符的密钥本就不应被接受。

---

### 37. [MEDIUM] Backend sync/push 循环未使用事务，部分失败导致状态分裂
- **位置**: `apps/backend/src/sync/routes.ts:110-158`
- **类别**: 稳定性
- **推荐度**: 6/10
- **问题描述**: 对 changes 列表逐条 await upsert，任一失败仅记录到 rejected，但前面成功的写入已落库且不会回滚。同时 `broadcastSyncRequired` 一定会触发。
- **影响**: 客户端难以幂等重放；与 checksum/syncToken 的对账复杂化。
- **修改方案**: 整体包 `prisma.$transaction`，或按 batch 分组事务；只有当 `accepted.length>0` 时再广播 `SYNC_REQUIRED`。
- **是否业务必须**: 事务化写入是正确的设计。但需注意 Prisma 的 interactive transaction 有超时限制（默认 5s），大 batch 需要分批。功能不受影响。

---

### 38. [MEDIUM] Backend 备份使用 `exec` 调用 sqlite3 CLI，依赖外部二进制
- **位置**: `apps/backend/src/backup/scheduler.ts:27-50`
- **类别**: 稳定性
- **推荐度**: 6/10
- **问题描述**: 依赖系统已安装 sqlite3 命令；`validatePath` 把 `:` 视为非法字符，Windows 盘符 `C:` 会被拒绝。
- **影响**: Windows/容器内非标准路径下 `BACKUP_ENABLED=true` 即抛错并跳过备份。
- **修改方案**: 用 `better-sqlite3` 或 Prisma 自身能力做在线备份；如保留 exec，用 `spawn + 参数数组` 而非字符串拼接。
- **是否业务必须**: 若部署仅在 Linux 容器中，可保留现状但需放宽路径校验。建议迁移到 Node 内建方案。
- **修复状态**: 不修复

---

### 39. [MEDIUM] Android 自动填充保存回调提前返回成功
- **位置**: `apps/android/.../service/autofill/PwBookAutofillService.kt:219`
- **类别**: 稳定性
- **推荐度**: 6/10
- **问题描述**: `onSaveRequest` 在启动协程处理保存后立即调用 `callback.onSuccess()`，未等待实际保存完成。
- **影响**: 用户以为密码已保存，实际未保存，导致后续无法自动填充。
- **修改方案**: 将 `callback.onSuccess()` 移至协程内部，在保存真正完成后调用；异常时调用 `callback.onFailure()`。
- **是否业务必须**: 需要调整协程与回调的交互顺序，不影响整体保存逻辑。修改后行为更正确。

---

### 40. [MEDIUM] Android 即时同步可并发触发多个 Worker
- **位置**: `apps/android/.../sync/SyncWorker.kt:86-96`
- **类别**: 稳定性/性能
- **推荐度**: 6/10
- **问题描述**: `triggerImmediate()` 使用普通 `enqueue` 提交 `OneTimeWorkRequest`，未设置唯一工作名称。
- **影响**: 快速多次触发会产生多个并发的 SyncWorker，可能导致服务器冲突、重复推送、竞态条件。
- **修改方案**: 使用 `enqueueUniqueWork()` 替代 `enqueue()`，策略设为 `REPLACE` 或 `KEEP`。
- **是否业务必须**: 否。防止重复同步，不影响正常同步功能。

---

### 41. [MEDIUM] Android 同步队列重试计数永不递增且无死信机制
- **位置**: `apps/android/.../sync/SyncManager.kt`, `sync/PendingChangesQueue.kt:48-50`
- **类别**: 稳定性
- **推荐度**: 6/10
- **问题描述**: `PendingChangesQueue` 提供了 `incrementRetry()` 方法，但 `SyncManager` 在任何路径上均未调用。失败条目会被无限次重试。
- **影响**: 永久被拒绝的变更会永远留在队列中，每次同步都尝试推送，`pendingCount` 永远不为零。
- **修改方案**: 推送失败后调用 `incrementRetry()`；设置最大重试阈值（如 10 次），超限后移入死信表或通知用户手动处理。
- **是否业务必须**: 需要增加重试和失败处理逻辑，不影响正常成功路径。

---

### 42. [MEDIUM] Android Passkey 凭据查找采用 O(N) 全量解密
- **位置**: `apps/android/.../data/repository/CipherRepository.kt:95-101`
- **类别**: 性能
- **推荐度**: 5/10
- **问题描述**: `findByCredentialId()` 加载该用户的所有 LOGIN 类型凭据，并对每条逐一解密，直到找到匹配的 credentialId。
- **影响**: 保险库中 LOGIN 凭据较多时，Passkey 认证响应延迟显著增加；CPU 密集解密在主线程调用者中也可能造成卡顿。
- **修改方案**: 复用现有索引机制。调整 `PasskeyGetActivity` 的查找顺序：先从 `requestJson` 解析 `rpId`，调用 `cipherIndexStore.filterByRpId()` 预筛选出该站点的候选凭据，再对少量候选逐一解密匹配 `credentialId`。同一 rpId 下多账号时仍需逐个解密，但保险库 LOGIN 凭据整体规模不再影响查找性能。
- **是否业务必须**: 当前实现是为了避免明文存储 credentialId。可通过加密索引或内存缓存优化，不影响业务逻辑。

---

### 43. [MEDIUM] Backend 全量 sync 与 push 后再次 findMany 计算 checksum 为 O(N)
- **位置**: `apps/backend/src/sync/routes.ts:55-99,160-163`; `prisma/schema.prisma`
- **类别**: 性能
- **推荐度**: 5/10
- **问题描述**: push 之后再次 `findMany` 全部 ciphers 计算 checksum，对大账户每次 push 都是 O(N)。缺少 `[userId, deletedAt]` 索引。
- **影响**: 大量凭据时 push 延迟显著上升，阻塞事件循环。
- **修改方案**: checksum 改为增量维护（保存上次 checksum 与 modifiedAt 序列），或仅在客户端要求时返回。增加 `[userId, deletedAt]` 索引。
- **是否业务必须**: 性能优化，不影响功能。

---

### 44. [MEDIUM] Edge VaultList 全量解密导致大保险库卡顿
- **位置**: `apps/edge-extension/src/popup/components/VaultList.tsx:67-100`
- **类别**: 性能
- **推荐度**: 6/10
- **问题描述**: `loadItems` 对全部 ciphers 执行 `Promise.all` 并行解密，保险库条目较多时（500+），同时触发大量 AES-GCM 解密操作，阻塞 popup UI 渲染。
- **影响**: Popup 打开延迟显著增加，低端设备上可能导致浏览器提示"页面无响应"。
- **修改方案**: 1. 实现分页/虚拟滚动，仅解密视口内条目；2. 将解密操作移到 background script 的 Web Worker 中执行；3. 缓存已解密的元数据。
- **是否业务必须**: 性能优化。对大用户群体是必需的，小保险库无感知。

---

### 45. [MEDIUM] Edge CipherIndexService.setAll 全量重写索引
- **位置**: `apps/edge-extension/src/crypto/cipher-index.ts:86-89, 111-121`
- **类别**: 性能
- **推荐度**: 6/10
- **问题描述**: `updateOne` 和 `rebuild` 每次都将整个索引数组写入 `chrome.storage.local`。随着保险库增长，每次新增/编辑凭据都需序列化并写入越来越大的对象。
- **影响**: 写入延迟随保险库规模线性增长；`chrome.storage.local` 有 5MB 配额限制，大保险库可能触发 `QUOTA_BYTES` 错误。
- **修改方案**: 1. 将索引存储迁移到 IndexedDB，支持单条读写；2. 或拆分键策略：`cipherIndex_${id}` 对应独立键，避免全量重写。
- **是否业务必须**: 性能优化。小保险库无感知，大保险库必须优化。
- **修复状态**: 不修复

---

### 46. [MEDIUM] Edge content-script.ts 轮询扫描消耗主线程
- **位置**: `apps/edge-extension/src/content/content-script.ts:332-349`
- **类别**: 性能
- **推荐度**: 5/10
- **问题描述**: `setupAutoDetection` 中设置每 2 秒轮询扫描 DOM，最多 30 次（1 分钟）。后台标签页中仍会持续执行。
- **影响**: 后台标签页持续消耗 CPU 和电池电量。
- **修改方案**: 1. 使用 Page Visibility API，在页面不可见时停止轮询；2. 优先依赖 MutationObserver 和 focusin 事件，移除轮询兜底。
- **是否业务必须**: 轮询是兜底策略，移除后依赖事件驱动，对大多数页面足够。极少数静态页面可能漏检，但可接受。

---

### 47. [MEDIUM] Backend 错误处理器未屏蔽 ZodError 详细信息
- **位置**: `apps/backend/src/errors/handler.ts:15-37`
- **类别**: 安全
- **推荐度**: 5/10
- **问题描述**: `ZodError` 不是 `ApiError`，会落到通用 500 分支。开发环境会返回 `error.message`（含字段路径）。未处理 Prisma P2002 等错误。
- **影响**: 状态码语义错乱；调试模式信息泄露；客户端无法正确处理校验错误。
- **修改方案**: 识别 `ZodError` 返回 400 + issues；识别 `Prisma.PrismaClientKnownRequestError` 按 code 映射 4xx；对其他异常仅记录日志、对外返回简短文案。
- **是否业务必须**: 错误分类改进，不影响正常请求。

---

### 48. [MEDIUM] Edge SHOW_SAVE_PROMPT 未限制 frameId 导致多 frame 重复弹窗
- **位置**: `apps/edge-extension/src/background/background.ts:94-99, 126-131, 269-274`
- **类别**: 稳定性
- **推荐度**: 6/10
- **问题描述**: 发送 `SHOW_SAVE_PROMPT` 消息时未指定 `frameId`，消息会广播到 tab 的所有 frame。
- **影响**: 页面包含多个 iframe 时，每个 frame 的 content script 都会收到消息并触发保存提示。
- **修改方案**: 所有 `chrome.tabs.sendMessage` 发送 `SHOW_SAVE_PROMPT` 时增加 `{ frameId: 0 }` 选项，仅向主 frame 发送。
- **是否业务必须**: 否。功能不受影响，只是减少重复弹窗。

---

### 49. [MEDIUM] Edge 新建凭据时 userId 为空字符串
- **位置**: `apps/edge-extension/src/popup/components/CipherForm.tsx:180-189`
- **类别**: 稳定性
- **推荐度**: 6/10
- **问题描述**: 新建凭据时 `cipher.userId` 被硬编码为空字符串。
- **影响**: 服务端若依赖 `userId` 进行数据隔离，空字符串可能导致安全漏洞或同步失败。
- **修改方案**: 从 `StorageService.getProfile()` 获取当前用户 ID 并填入；服务端增加 userId 非空校验。
- **是否业务必须**: 当前服务端可能重新填充 userId，但前端正确填写是防御性编程。不影响功能。

---

### 50. [MEDIUM] Edge 与 Android 密码生成器默认参数与 UI 暴露不一致
- **位置**: `apps/edge-extension/src/popup/settings.ts:17-26`, `apps/android/.../PasswordGeneratorViewModel.kt:16-23`, `GeneratePasswordUseCase.kt:8-16`
- **类别**: 精简
- **推荐度**: 6/10
- **问题描述**: Edge 端暴露 `minNumbers`/`minSpecial` 设置项（默认各 1），Android 端 UI 不包含这两个参数，但底层支持。
- **影响**: 跨平台密码生成策略不一致。
- **修改方案**: 在 Android 的 UI 状态中添加 `minNumbers`/`minSpecial` 字段，默认值为 1，与 Edge 保持一致。
- **是否业务必须**: 跨平台体验一致性问题。统一后不影响现有功能。

---

### 51. [MEDIUM] 魔法数字分散在多处，缺乏统一配置
- **位置**: 多处超时/间隔常量
- **类别**: 精简
- **推荐度**: 5.5/10
- **问题描述**: `FORM_DATA_TTL=10s`、`FALLBACK_DELAY=5s`、`DEFAULT_TIMEOUT_MIN=15`、`maxReconnectAttempts=5` 等分散在各文件中。
- **影响**: 产品调优困难，容易遗漏。
- **修改方案**: 创建 `apps/edge-extension/src/config/constants.ts` 和 Android 对应的 `Constants.kt`，集中管理所有超时、间隔、阈值。
- **是否业务必须**: 配置管理改进，不影响功能。

---

### 52. [MEDIUM] Backend 与 Edge 各自实现 deriveRecoveryKeyHash
- **位置**: `apps/backend/src/auth/recover.ts:16-32`, `apps/edge-extension/src/crypto/crypto-service.ts:274-298`
- **类别**: 精简
- **推荐度**: 5.5/10
- **问题描述**: 两端都存在 `deriveRecoveryKeyHash`，逻辑几乎相同（PBKDF2-SHA256, 100k iterations）。
- **影响**: 维护负担，迭代次数调整时容易遗漏一端。
- **修改方案**: 将 KDF 相关常数提取到 `shared-types` 或独立配置包中。后端应引用共享实现。
- **是否业务必须**: 代码组织改进，不影响功能。注意后端和前端语言不同，常数可共享但实现需各自保留。

---

### 53. [MEDIUM] Backend sync.test.ts 冲突测试断言过于宽松
- **位置**: `apps/backend/tests/integration/sync.test.ts:183`
- **类别**: 精简
- **推荐度**: 7/10
- **问题描述**: 断言为 `expect(body.conflicts.length).toBeGreaterThanOrEqual(0)`，对任何结果都通过（包括 0 冲突）。
- **影响**: 测试无法捕获冲突解决逻辑的回归问题。
- **修改方案**: 改为严格验证：当客户端 `modifiedAt` 早于服务端时，`expect(body.conflicts).toContain(changeId)`。
- **是否业务必须**: 测试质量改进，不影响生产代码。

---

### 54. [MEDIUM] 缺少跨平台加密兼容性测试覆盖
- **位置**: 测试目录
- **类别**: 精简
- **推荐度**: 6.5/10
- **问题描述**: Android 有 `CryptoCompatibilityTest`，但 Edge 端没有反向验证。TOTP、Base64Url、Passkey CBOR 等缺少交叉验证。
- **影响**: 无法自动发现跨平台回归问题。
- **修改方案**: 建立共享的测试向量文件（如 `tests/vectors/totp-vectors.json`），两端都引用同一文件。CI 中增加交叉验证。
- **是否业务必须**: 测试基础设施改进，不影响生产功能。

---

### 55. [MEDIUM] content-script.ts 检测逻辑过于复杂
- **位置**: `apps/edge-extension/src/content/content-script.ts:249-350`
- **类别**: 精简/性能
- **推荐度**: 5/10
- **问题描述**: 同时使用了 MutationObserver（2 秒冷却）、focusin 事件、click 事件（300ms+800ms 双延迟）、2 秒轮询（最多 30 次）四种检测机制。大量 `console.log` 残留。
- **影响**: 性能开销（频繁 DOM 扫描），代码难以维护。
- **修改方案**: 简化检测策略：保留 MutationObserver + focusin 即可覆盖 95% 场景，删除轮询和 click 延迟扫描。将 `console.log` 替换为可开关的 debug 工具。
- **是否业务必须**: 简化检测策略不会影响主流页面的自动填充检测。极少数复杂 SPA 可能有短暂延迟，但可接受。

---

### 56. [MEDIUM] SyncScheduler.flushPendingChanges cipher 构造过于简化
- **位置**: `apps/edge-extension/src/sync/sync-scheduler.ts:95-112`
- **类别**: 精简/稳定性
- **推荐度**: 5/10
- **问题描述**: `flushPendingChanges` 推送时 `userId` 固定为空字符串、`type` 固定为 1、`favorite/reprompt` 固定为 false/0、时间戳都使用 `clientTimestamp`。
- **影响**: 若 pending change 来自 UPDATE 操作，这些字段会被错误覆盖。为未来扩展埋下隐患。
- **修改方案**: `PendingChange` 中应携带 cipher 的完整字段，推送时原样传递，而非硬编码默认值。
- **是否业务必须**: 当前仅支持 LOGIN 类型，所以功能正常。但为扩展做准备时应修复。

---

### 57. [MEDIUM] Edge E2E 测试中 chrome.storage.mock 重复定义
- **位置**: `apps/edge-extension/tests/e2e/sync.test.ts`, `autofill.test.ts`
- **类别**: 精简
- **推荐度**: 5/10
- **问题描述**: 每个测试文件都重复定义 chrome API mock。
- **影响**: 测试维护成本高，mock 行为不一致风险。
- **修改方案**: 提取统一的 `test/setup.ts` 或 `test/mocks/chrome-mock.ts`，在 vitest 配置中全局注入。
- **是否业务必须**: 测试重构，不影响生产代码。

---

### 58. [LOW] Backend masterPasswordHash 比较非常量时间
- **位置**: `apps/backend/src/auth/routes.ts:116`
- **类别**: 安全
- **推荐度**: 4/10
- **问题描述**: `user.masterPasswordHash !== body.masterPasswordHash` 用 JS 字符串比较。
- **影响**: 理论上的时序攻击。两侧都是哈希值，可行性较低。
- **修改方案**: 使用 `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`。`recoveryKeyHash` 比较同理。
- **是否业务必须**: 安全加固，不影响功能。

---

### 59. [LOW] Backend POST /api/ciphers 允许客户端指定任意 id
- **位置**: `apps/backend/src/ciphers/routes.ts:17-44`
- **类别**: 安全
- **推荐度**: 5/10
- **问题描述**: 客户端可以传入任意 id 字符串。可被用作 id 探测和冲突攻击。
- **修改方案**: 服务端用 cuid/uuid 生成 id 并返回；或对 id 做严格 UUIDv4 格式校验。
- **是否业务必须**: 若客户端依赖自生成 id 用于离线创建后同步，可保留客户端 id 但要求 UUIDv4 格式。

---

### 60. [LOW] Backend GET /api/sync 硬编码 deviceType=BROWSER
- **位置**: `apps/backend/src/sync/routes.ts:68-83`
- **类别**: 稳定性
- **推荐度**: 3/10
- **问题描述**: 若 token 不带 deviceId 则 create 分支强制 `deviceType=BROWSER`。
- **影响**: Android 端可能被记录成 BROWSER，设备审计混乱。
- **修改方案**: 要求 token 必须带 deviceId；或从 User-Agent 解析；缺失时直接 400。
- **是否业务必须**: 仅影响可观测性，不影响核心功能。

---

### 61. [LOW] Backend deletedCipherIds 全量同步丢失墓碑
- **位置**: `apps/backend/src/sync/routes.ts:60-91`
- **类别**: 稳定性
- **推荐度**: 3/10
- **问题描述**: `since` 模式下 `deletedCipherIds` 从结果过滤；非 since 模式下永远为空。
- **影响**: 首次或重置后客户端无法知道有哪些已删凭据，可能造成本地残留。
- **修改方案**: 首次同步直接发送 `deletedAt!=null` 的 id 列表；或在文档中说明客户端在 full sync 时应清空本地。
- **是否业务必须**: 取决于同步协议设计。当前逻辑下客户端应处理 full sync 清空逻辑。

---

### 62. [LOW] Backend domainAssociation 无唯一约束
- **位置**: `apps/backend/src/domain-assoc/routes.ts:41-58`
- **类别**: 安全/稳定性
- **推荐度**: 3/10
- **问题描述**: POST 没有去重检查，schema 也没有 `(userId, domains)` 唯一约束。
- **影响**: 数据库膨胀、客户端列表混乱。
- **修改方案**: 增加唯一约束或在路由层 upsert；对单用户记录数量加上限。
- **是否业务必须**: 数据完整性改进，不影响功能。

---

### 63. [LOW] Backend checksum.ts 未被使用的 validateSyncChecksum / buildSyncPayload
- **位置**: `apps/backend/src/sync/checksum.ts:21-35`
- **类别**: 精简
- **推荐度**: 2/10
- **问题描述**: 死代码，路由中未被引用。
- **修改方案**: 若契约文档要求保留则补充注释说明；否则删除。
- **是否业务必须**: 死代码清理，不影响功能。

---

### 64. [LOW] Android KdfType 参数被忽略，始终使用 PBKDF2
- **位置**: `apps/android/.../crypto/KeyDerivation.kt:18-24`
- **类别**: 安全/精简
- **推荐度**: 3/10
- **问题描述**: `deriveMasterKey()` 接收 `kdfType` 参数，但直接调用 `deriveKeyPbkdf2()`，忽略传入值。
- **影响**: 客户端与服务器 KDF 配置不一致。若服务器强制 Argon2id 将导致认证失败。
- **修改方案**: 根据 `kdfType` 分发到 Argon2id 或 PBKDF2；若 Edge 端不支持 Argon2id，应在协议层统一协商。
- **是否业务必须**: 当前是为了跨端兼容。应显式处理，避免配置漂移。

---

### 65. [LOW] Edge 登录检测引擎拦截 fetch/XHR 未恢复原始实现
- **位置**: `apps/edge-extension/src/autofill/login-detection.ts:126-166`
- **类别**: 安全/稳定性
- **推荐度**: 5/10
- **问题描述**: `interceptFetch` 和 `interceptXHR` 直接覆盖 `window.fetch` 和 `window.XMLHttpRequest`。扩展被禁用/卸载时原始实现无法恢复。
- **影响**: 页面其他脚本或扩展可能依赖原始行为，拦截可能导致兼容性问题。
- **修改方案**: 保存原始引用，在扩展卸载时恢复；或改用 PerformanceObserver 替代页面内 fetch 劫持。
- **是否业务必须**: MV3 下卸载恢复较困难。当前实现是自动填充的核心检测手段，改动需评估检测准确率影响。

---

### 66. [LOW] Edge 剪贴板清空机制不可靠
- **位置**: `apps/edge-extension/src/platform/clipboard.ts:6-35`
- **类别**: 安全
- **推荐度**: 5/10
- **问题描述**: `clear()` 仅当剪贴板当前内容等于 `lastCopiedValue` 时才清空。若用户在 10 秒内复制了其他内容，密码将永久留存。
- **修改方案**: 移除条件判断，直接写入空字符串；或使用 `document.execCommand('copy')` 在扩展上下文中执行清空。
- **是否业务必须**: 否。清空逻辑更可靠，不会影响正常复制功能。

---

### 67. [LOW] Edge WebSocketClient 未处理心跳超时
- **位置**: `apps/edge-extension/src/sync/websocket-client.ts:110-127`
- **类别**: 稳定性
- **推荐度**: 5/10
- **问题描述**: `startHeartbeat` 仅发送 PING 消息，但未设置 PONG 超时检测。
- **影响**: 服务器静默断开时，客户端可能长时间保持 OPEN 状态而不自知，同步通知延迟。
- **修改方案**: 发送 PING 后 10 秒内未收到 PONG 则主动关闭并重连；使用 WebSocket 的 ping/pong 帧替代应用层消息。
- **是否业务必须**: 连接保活改进，不影响正常功能。

---

### 68. [LOW] Edge getBaseDomain 简化 PSL 规则不完整
- **位置**: `apps/edge-extension/src/autofill/domain-utils.ts:12-20, 24-40`
- **类别**: 安全
- **推荐度**: 5/10
- **问题描述**: `MULTI_PART_SUFFIXES` 仅覆盖部分常见多段顶级域，缺少 `.github.io`、`.vercel.app` 等。
- **影响**: 在托管域名上不同子域名被错误视为同一基础域名，自动填充可能将凭据填充到错误页面。
- **修改方案**: 引入 `psl` npm 包或使用 Chrome 内置的 URL 解析获取 eTLD+1；定期从 Public Suffix List 更新规则。
- **是否业务必须**: 域名解析准确性改进。使用 `psl` 包会引入新依赖，但准确性大幅提升。

---

### 69. [LOW] Edge arrayBufferToBase64 / base64ToArrayBuffer 重复实现
- **位置**: `apps/edge-extension/src/crypto/crypto-service.ts`, `passkey-storage.ts`, `options/OptionsApp.tsx`
- **类别**: 精简
- **推荐度**: 3/10
- **问题描述**: Base64 编解码函数在三处各有一份几乎相同的实现。
- **修改方案**: 统一放到 `src/platform/base64.ts`。
- **是否业务必须**: 代码组织改进，不影响功能。

---

### 70. [LOW] Edge crypto-service.ts 中未使用的 RSA 相关函数
- **位置**: `apps/edge-extension/src/crypto/crypto-service.ts:212-233`
- **类别**: 精简
- **推荐度**: 3.5/10
- **问题描述**: `generateRsaKeyPair`、`exportPublicKeySpki`、`exportPrivateKeyPkcs8` 在 Edge 扩展中无引用。
- **修改方案**: 删除未使用的 RSA 相关函数。若未来需要，可从 git 历史恢复。
- **是否业务必须**: 死代码清理，不影响功能。

---

### 71. [LOW] Edge crypto-service.ts 中大量类型断言噪音
- **位置**: `apps/edge-extension/src/crypto/crypto-service.ts`
- **类别**: 精简
- **推荐度**: 2/10
- **问题描述**: 大量 `Uint8Array` 被强制断言为 `unknown as BufferSource`。
- **修改方案**: 创建辅助函数 `toBufferSource(buf: Uint8Array): BufferSource` 集中处理。
- **是否业务必须**: 类型清理，不影响功能。

---

## 修复路线图建议

### 第一阶段 (立即执行 — 1-2 天)
聚焦 **Critical (10 分)** 安全漏洞，共 13 项：

| # | 问题 | 模块 | 预估工作量 |
|---|------|------|-----------|
| 1 | 删除 Logcat 密钥日志 | Android | 30 分钟 |
| 2 | 移除 userKey 明文 storage.local 写入 | Edge | 2-4 小时 |
| 3 | sync/push 加 userId 校验 + 事务化 | Backend | 2-4 小时 |
| 4 | 关闭明文 HTTP (network_security_config) | Android | 30 分钟 |
| 5 | 关闭 Ktor BODY 日志 | Android | 30 分钟 |
| 6 | WebSocket 地址改为可配置 + wss | Android | 2 小时 |
| 7 | Passkey UV 标志改为条件设置 | Android | 2 小时 |
| 8 | URI 匹配改用 UriMatcher | Android | 2 小时 |
| 9 | Cipher 索引加密存储 | Edge | 4-8 小时 |
| 10 | WebAuthn postMessage 加 origin 校验 | Edge | 1 小时 |
| 11 | Edge PBKDF2 改为 600k 迭代 | Edge + Backend | 2-4 小时 |
| 12 | recover 接口加速率限制 + 客户端哈希 | Backend | 4 小时 |
| 13 | Pending 表单改用 session storage 或加密 | Edge | 2 小时 |

**总计**: 约 3-5 人日。

### 第二阶段 (本周内 — 3-5 天)
聚焦 **High (7-9 分)** 问题：
- Backend: recover 自建 PrismaClient、Helmet 安全头、CORS 白名单、prelogin 防枚举、速率限制增强、Cipher TOCTOU
- Android: 剪贴板敏感标记、索引明文存储、数据库加密、Room 迁移补齐、同步失败暴露、WebSocket 重连修复
- Edge: HTTP 强制 HTTPS、localStorage 桥接校验、Manifest 权限收紧、innerHTML 清理、Cookie 同步过滤、MV3 alarms 锁定、冲突处理改进
- 跨平台: TLD 列表统一、TOTP base32 统一

### 第三阶段 (下周 — 5-7 天)
聚焦 **Medium (5-6 分)** 问题：
- 性能优化（VaultList 分页、CipherIndex 单条读写、Passkey O(N) 查找）
- 稳定性增强（Worker 去重、同步队列死信、WebSocket 心跳超时）
- 代码精简（魔法数字集中、死代码删除、测试 mock 统一、跨平台测试向量）

---

## 附录: 按模块汇总

### Android (27 项)
- **Critical (6)**: Logcat 密钥泄漏、明文 HTTP、Ktor BODY 日志、WebSocket 硬编码明文、Passkey UV 伪造、URI 子串匹配
- **High (5)**: 剪贴板敏感标记、索引明文存储、数据库未加密、Room 迁移缺失、同步失败吞掉、WebSocket 重连溢出
- **Medium (5)**: 自动填充保存提前成功、Worker 并发、同步队列死信、Passkey O(N) 解密、KdfType 忽略
- **Low (1)**: KdfType 忽略

### Backend (20 项)
- **Critical (1)**: sync/push 跨租户覆盖
- **High (8)**: recover 明文处理密钥、recover 无速率限制、recover 自建 PrismaClient、缺少 Helmet、CORS 过宽、prelogin 枚举、WebSocket 无限制、速率限制不足、Cipher TOCTOU
- **Medium (6)**: 同步无事务、备份 exec 依赖、checksum O(N)、ZodError 未识别、设备类型硬编码、deletedCipherIds 丢失墓碑
- **Low (5)**: 常量时间比较、客户端指定 id、domainAssoc 无约束、checksum 死代码

### Edge Extension (35 项)
- **Critical (3)**: userKey 明文 storage、索引明文存储、WebAuthn origin 未校验
- **High (12)**: PBKDF2 1 次迭代、Pending 表单明文、localStorage 桥接无校验、默认 HTTP、Manifest 过宽、innerHTML、Cookie 未过滤 HttpOnly、MV3 定时器失效、冲突丢弃数据
- **Medium (14)**: 多 frame 弹窗、userId 空字符串、VaultList 全量解密、索引全量重写、轮询耗电、fetch 拦截未恢复、剪贴板清空不可靠、心跳超时
- **Low (6)**: Base64 重复、RSA 死代码、类型断言噪音、Popup 状态管理、InlineMenu 重复 DOM 操作

### 跨平台/精简 (9 项)
- **High (4)**: TLD 列表不一致、TOTP base32 不一致
- **Medium (5)**: 密码生成器参数不一致、recover 各自实现、魔法数字分散、测试断言宽松、缺少跨平台兼容性测试、content-script 复杂
