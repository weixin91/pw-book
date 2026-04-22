# 技术调研报告：密码管理应用

**来源项目**: [bitwarden/clients](https://github.com/bitwarden/clients)  
**调研日期**: 2026/04/22  
**调研目标**: 为自托管密码管理器（Edge 插件 + Android App）获取技术方案参考

---

## 1. 项目整体结构参考

Bitwarden 采用 **Nx Monorepo** 管理多个客户端应用：

```
apps/
  browser/     # 浏览器扩展 (Angular + Web Extension API)
  cli/         # 命令行工具
  desktop/     # 桌面应用 (Electron + Angular + Rust)
  web/         # Web Vault
libs/
  common/      # 核心业务逻辑
  platform/    # 平台抽象层
  vault/       # 保险库管理
  auth/        # 认证服务
  ...
```

**对我们的启示**：
- 将共享逻辑抽取为独立库，避免重复实现
- 浏览器扩展使用 TypeScript + Manifest V3 是行业标准
- 移动端 Bitwarden 最终选择 **原生开发**（Kotlin/Swift），放弃了 Xamarin/.NET MAUI

---

## 2. 浏览器扩展技术方案

### 2.1 技术栈

| 技术 | Bitwarden 选择 | 我们的建议 |
|------|---------------|-----------|
| 框架 | Angular | **原生 TypeScript**（轻量，无需重型框架） |
| 构建工具 | Webpack 5 | **Vite**（更快，MV3 支持好） |
| Manifest | V3 | **V3**（Chrome/Edge 强制要求） |
| 样式 | Tailwind CSS | 视 UI 复杂度而定 |
| 状态管理 | RxJS + 自定义服务 | **轻量自定义**或 RxJS |

### 2.2 架构设计（四执行上下文）

Bitwarden 浏览器扩展在四个隔离上下文中运行：

1. **Background Service Worker** — 核心业务逻辑、API 通信、保险库解密
2. **Popup** — 点击扩展图标后的主 UI
3. **Content Scripts** — 自动填充、表单检测
4. **Offscreen Documents** — MV3 限制下的剪贴板操作 workaround

**关键抽象层**：`BrowserApi` 封装所有原生 API 调用，提供跨浏览器兼容性。

### 2.3 自动填充实现

**表单检测**：
- `CollectAutofillContentService` 遍历 DOM，识别用户名/密码输入框
- 解析语义标签、placeholder 文本、ARIA 属性
- 使用 `MutationObserver` 监听动态添加的字段
- 支持 Shadow DOM 遍历

**登录成功判定（密码保存提示触发逻辑）**：

登录成功判定是自动填充系统中最复杂的环节，需要覆盖多种登录模式：

| 登录模式 | 检测策略 | 说明 |
|---------|---------|------|
| **传统表单提交** | 拦截 `form.submit()` 和 `submit` 事件，捕获提交的 username/password | 最基础的检测方式 |
| **AJAX/Fetch 登录** | 拦截 `XMLHttpRequest` / `fetch`，检测请求体中包含密码字段的 POST 请求，结合响应状态码（200）判断 | 需要重写原生 API 进行拦截 |
| **多步骤登录** | 第一步仅捕获 username；第二步检测到密码输入后，合并两步数据判断 | 如 Google、Microsoft 的分步登录 |
| **OAuth/SSO 重定向** | 不可检测。此类场景**不在 FR-001 覆盖范围内**，接受不提示保存 | 用户在第三方完成认证后返回，扩展无法获知登录凭据 |
| **页面刷新/重定向后** | 表单提交后若发生 302 重定向，content script 会重新加载。需要在 background script 中**暂存表单提交数据**（最长 10 秒），等待 `chrome.webNavigation.onCompleted` 事件后，在新页面判断 URL 是否变化，再决定是否弹出保存提示 | **关键防断点** |

**登录成功判定的综合策略**：
1. Content script 在检测到表单提交时，立即将表单数据（username, password, action URL）发送到 background script 暂存
2. Background script 记录提交时间戳，启动 10 秒计时器
3. 同时监听 `chrome.webNavigation.onCompleted` 事件
4. 如果在 10 秒内发生导航完成，且新页面与登录页面不同（URL 变化），则判定登录成功，弹出保存提示
5. 如果 10 秒内未发生导航，但检测到 AJAX 响应成功（通过拦截的 XHR/fetch 回调），也判定成功
6. 如果页面刷新后表单数据丢失（content script 重建），从 background 的暂存区恢复数据

**覆盖预估**：传统表单提交 + AJAX 登录可覆盖约 80-85% 的网站；OAuth/SSO 登录（约占 15-20%）因技术限制无法覆盖，属于已知限制，spec 已接受（FR-022 允许降级）。

**自动填充逻辑**：
- `InsertAutofillContentService` 向匹配字段填充数据
- 内容脚本与后台脚本通过 `chrome.runtime.sendMessage` 通信
- 内联菜单使用自定义 Web Component + Shadow DOM 防止页面窃取
- 填充后记录 `lastUsedAt` 时间戳，用于 FR-019 默认填充最近使用的账号

**域名匹配**：
- 基础域名提取（如 `tieba.baidu.com` → `baidu.com`）
- 用户配置的域名关联规则表
- URI 匹配算法支持通配符和正则

**性能优化与防护**：

| 措施 | 实现 | 目的 |
|------|------|------|
| **MutationObserver 节流** | Debounce 100ms，最多每 500ms 执行一次完整扫描 | 防止 DOM 频繁变化导致 CPU 飙升 |
| **元素数量上限** | 单页最多扫描 500 个 `<input>` 元素，超出则停止扫描并标记"页面过于复杂" | 防止极端页面（如大型表格、无限滚动）导致卡顿 |
| **requestIdleCallback** | 非关键扫描（如内联菜单定位）使用 `requestIdleCallback` 延迟到浏览器空闲时执行 | 优先保证页面交互响应性 |
| **iframe 选择性注入** | 仅向同域 iframe 注入 content script；跨域 iframe 跳过（安全限制） | 减少不必要的脚本注入和内存占用 |
| **SPA 路由变化监听** | 监听 `history.pushState` / `popstate`，仅在路由变化后触发重新扫描 | 避免在 SPA 内部状态变化时重复全量扫描 |
| **content script 最小化** | 基础 content script（`content-message-handler.js`）仅 3KB，负责消息转发；自动填充功能按需注入（`trigger-autofill-script-injection.ts`） | 减少所有页面的基础负担 |

**非标准登录表单降级策略（FR-022）**：

| 非标准场景 | 检测方式 | 降级行为 |
|-----------|---------|---------|
| **非标准字段名** | 解析失败：无法通过语义分析匹配到 username/password 字段 | 静默跳过，不填充也不提示 |
| **iframe 嵌套（同域）** | 同域 iframe 中检测到登录表单，但字段名非标准 | 尝试填充；若失败则静默跳过 |
| **iframe 嵌套（跨域）** | 跨域 iframe 无法注入 content script | 静默跳过（无法访问） |
| **Shadow DOM 内表单** | 遍历 Shadow Root，但若 Shadow DOM  closed 且无法穿透 | 静默跳过 |
| **Web Component 封装** | 自定义元素内部包含标准 input，但无法从外部识别语义 | 尝试通过事件委托和焦点追踪间接识别；失败则跳过 |
| **Canvas/WebGL 渲染的输入** | 非 DOM 输入框 | 静默跳过（无法检测） |
| **单页应用动态路由** | URL 不变但页面内容完全替换 | 依赖路由变化监听重新扫描；若检测不到路由变化则 5 秒后超时跳过 |

### 2.4 Cookie 同步

Bitwarden 通过浏览器扩展 API (`chrome.cookies`) 提取 Cookie：
- 需要 `cookies` 权限
- 加密后通过同步 API 上传到服务端
- 在其他设备上无法直接注入 Cookie（安全限制）

**注意**：现代浏览器的 Cookie 安全策略（SameSite、HttpOnly、Secure）限制了跨设备 Cookie 同步的实际效果。建议实现时仅同步非 HttpOnly Cookie，并明确告知用户限制。

---

## 3. 移动端（Android）技术方案

### 3.1 Bitwarden 的选择与演进

| 时期 | 技术 | 状态 |
|------|------|------|
| 2016–2024 | Xamarin (C#) | 已退役 |
| 2024 | .NET MAUI | 临时过渡 |
| 2025至今 | **Kotlin (Android) / Swift (iOS)** | 生产环境 |

Bitwarden 明确**不使用**跨平台框架（Cordova、Capacitor、React Native、Flutter），原因是：
- 原生自动填充服务需要平台级集成
- Passkey 需要 Credential Provider Extension
- 生物识别需要原生 API
- 安全关键型应用需要最小化抽象层

### 3.2 推荐技术栈（Android）

| 类别 | 技术 | 用途 |
|------|------|------|
| UI | **Jetpack Compose** | 声明式 UI，现代 Android 标准 |
| 架构 | MVVM + Repository Pattern | 数据流管理 |
| 依赖注入 | **Hilt** | 编译期 DI |
| 异步 | **Kotlin Coroutines + Flow** | 响应式数据流 |
| 网络 | **Ktor Client** 或 Retrofit | API 通信 |
| 本地存储 | **Room** | SQLite ORM |
| 安全 | **AndroidX Security (EncryptedSharedPreferences)** | 密钥管理 |
| 生物识别 | **AndroidX Biometrics** | 指纹/面部识别 |
| 自动填充 | **AndroidX Autofill** | 系统级自动填充 |
| 凭据管理 | **AndroidX Credentials** | Passkey 支持 |
| 序列化 | **kotlinx.serialization** | JSON 处理 |

---

## 4. 加密与安全方案

### 4.1 端到端加密架构

Bitwarden 采用 **零知识端到端加密**：
- 所有加密/解密在客户端完成
- 服务器仅存储加密 blob，无法解密

**密钥层次结构**：

```
主密码 + 邮箱(Salt) → KDF → 256-bit Master Key
                           ↓
                    HKDF 扩展 → 512-bit Stretched Master Key
                           ↓
                    解密 Encrypted User Key
                           ↓
                    512-bit User Key (AES-256 + HMAC)
                           ↓
                    加密/解密所有保险库数据
```

### 4.2 密钥派生算法（KDF）

| 算法 | 参数 | 建议 |
|------|------|------|
| **PBKDF2-SHA256** | 600,000 次迭代 | 兼容性好，FIPS 合规 |
| **Argon2id** | 内存 64MiB，迭代 3 次，并行度 4 | **推荐**，抗 GPU/ASIC |

**我们的建议**：支持两种算法，默认 Argon2id，允许用户选择 PBKDF2 以获得更好的跨平台兼容性。

### 4.3 数据加密算法

| 用途 | 算法 |
|------|------|
| 保险库数据加密 | **AES-256-GCM**（认证加密，现代标准） |
| 密钥保护 | AES-256-GCM 加密 User Key |
| 随机数生成 | `crypto.getRandomValues` (Web) / `SecureRandom` (Android) |

**注意**：Bitwarden 使用 AES-256-CBC + HMAC-SHA256，但现代实践推荐使用 **AES-256-GCM**（内置认证，避免组合加密和 MAC 的复杂性）。

### 4.4 恢复密钥

Bitwarden 的恢复密钥机制：
- 首次设置时生成高熵随机字符串
- 用于重新加密 User Key，不直接存储主密码
- 用户必须自行安全保存

**我们的实现建议**：
- 生成 32 字节随机数，Base32 编码为可读格式
- 恢复密钥派生独立的恢复主密钥，用于解密 Encrypted User Key
- 恢复流程：验证恢复密钥 → 解密 User Key → 用户设置新主密码 → 用新主密码重新加密 User Key

---

## 5. 同步机制

### 5.1 同步协议

Bitwarden 同步 API：
- `GET /api/sync` — 全量同步
- `GET /api/sync?since=lastSyncDate` — 增量同步
- WebSocket "Live Sync" — 实时推送变更

**我们的建议**（简化版）：
- REST API 轮询 + 可选 WebSocket
- 增量同步基于 `lastModified` 时间戳
- 离线编辑支持需要客户端变更队列（Bitwarden 当前不支持离线编辑）

### 5.2 冲突解决

Bitwarden 使用 **last-write-wins** 基于 `revisionDate`：
- 优点：实现简单
- 缺点：容易受时钟偏移影响，可能丢失数据

**我们的建议**：
- 采用 last-write-wins（满足 spec 要求）
- 为每个凭据条目维护 `modifiedAt` 时间戳（服务器时间）
- 离线编辑时，客户端保存本地修改队列，恢复在线后按时间顺序逐个同步
- 如果服务器版本更新，用本地版本覆盖（last-write-wins）

### 5.3 离线支持

Bitwarden 当前仅支持离线读取，**不支持离线编辑**。

**我们的 spec 要求离线编辑**，实现方案：
1. 所有数据缓存到本地存储（IndexedDB / Room）
2. 离线时的修改写入本地 "pending changes" 队列
3. 恢复在线后，按 FIFO 顺序提交变更到服务器
4. 每条变更携带客户端生成的 `clientTimestamp`
5. 服务器用 last-write-wins 解决冲突

---

## 6. Passkey 与 TOTP

### 6.1 Passkey 支持

Bitwarden 的 Passkey 实现：
- 使用 **WebAuthn / FIDO2** 标准
- PRF (Pseudo-Random Function) Extension 用于密钥派生
- 原生 Credential Provider 集成（Android/iOS）
- 私钥永不离开加密保险库

**我们的实现建议**：
- **Edge 插件**: 使用 `navigator.credentials.create()` / `get()`，通过内容脚本拦截 WebAuthn 请求
- **Android**: 使用 AndroidX Credentials 库，实现 Credential Provider Service
- 存储：Passkey 私钥作为特殊类型的 Cipher 数据加密存储

### 6.2 TOTP 实现

Bitwarden Authenticator 参数：
- 默认：SHA-1, 6 位数字, 30 秒周期
- 支持 SHA-256/SHA-512（通过 `otpauth://` URI 配置）

**我们的实现建议**：
- 使用标准 TOTP 算法（RFC 6238）
- 支持解析 `otpauth://` URI
- 支持手动输入 secret key
- Android 端显示倒计时进度条

---

## 7. 自托管后端方案

### 7.1 Bitwarden 后端

Bitwarden 后端使用：
- C# + ASP.NET Core
- 多服务架构（API、Identity、Admin、Notifications 等）
- SQL Server / PostgreSQL / MySQL / SQLite
- Duende IdentityServer (OAuth2/OIDC)
- SignalR (WebSocket 实时通知)

### 7.2 我们的建议（轻量版）

考虑到自托管的易用性，推荐更轻量的技术栈：

| 组件 | 技术 | 理由 |
|------|------|------|
| 语言 | **TypeScript / Node.js 20+** | 与前端共享类型定义，生态丰富 |
| 框架 | **Fastify** | 高性能，低开销，插件生态好 |
| 数据库 | **SQLite** | 单文件零配置，个人使用足够 |
| ORM | **Prisma** | 类型安全，迁移方便 |
| 认证 | **JWT (jose)** | 轻量，满足需求 |
| 实时通知 | **WebSocket (ws)** | 可选，用于即时同步推送 |
| 容器化 | **Docker + Docker Compose** | 一键部署 |

**API 设计原则**：
- RESTful API
- 所有请求携带 JWT Bearer Token
- 服务端仅存储加密数据，不解密
- 核心端点：`/sync`, `/ciphers`, `/folders`, `/settings`

---

## 8. 技术决策总结

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Edge 插件框架 | 原生 TypeScript + Vite | 轻量、现代、MV3 友好 |
| Android 框架 | Kotlin + Jetpack Compose | 原生体验、原生自动填充、Passkey 支持 |
| 共享核心 | JSON Schema + 协议文档 | 避免跨平台框架复杂性，两端独立实现 |
| 后端 | Node.js + Fastify + SQLite | 轻量、自托管友好、单文件零配置 |
| KDF | Argon2id（默认）+ PBKDF2（可选） | 安全性与兼容性平衡 |
| 加密算法 | AES-256-GCM | 现代认证加密标准 |
| 同步协议 | REST + 增量同步 + WebSocket（可选） | 简单可靠 |
| 冲突解决 | last-write-wins | 满足 spec 要求，实现简单 |
| 离线编辑 | 本地变更队列 | 满足 spec 要求，优于 Bitwarden 当前实现 |

---

## 9. 风险与注意事项

1. **自动填充的可靠性**：Bitwarden 投入大量工程资源处理各种网站的非标准表单。初期版本应优先覆盖主流网站，接受对部分非标准页面的降级处理。
2. **MV3 限制**：Chrome Extension Manifest V3 对 Service Worker 生命周期有严格限制，后台任务（如定时同步）需要使用 `chrome.alarms` API。
3. **Android 自动填充服务**：需要实现 `AutofillService`，处理系统级的自动填充请求，与浏览器扩展的自动填充是两套独立实现。
4. **Passkey 复杂度**：WebAuthn/FIDO2 协议复杂，CTAP2 通信涉及多个抽象层。建议分阶段实现，先支持 TOTP，再支持 Passkey。
5. **端到端加密的正确性**：加密实现必须经过安全审计。建议使用经过验证的库（Web Crypto API / Tink / BouncyCastle），避免自行实现加密原语。
