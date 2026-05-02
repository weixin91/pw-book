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

- **URI 解析**：所有可填充目标统一以 `Cipher.data.login.uris[].uri` 字符串存储，匹配前先经 `parseUri()` 解析为 `UriIdentifier { kind, hostname?, baseDomain?, packageName?, raw }`：
  - `http(s)://` → `kind: "web"`，提取 `hostname` 与 `baseDomain`
  - `androidapp://com.example` → `kind: "android"`，`packageName = "com.example"`
  - 其他 → `kind: "other"`，仅原样保留
- **基础域名提取**：维护多段顶级后缀白名单（`com.cn / co.uk / co.jp / com.hk / com.tw / com.au / co.kr / com.sg / com.br / com.mx / co.za / co.in / com.ar / com.tr / com.ua` 等），命中则取末三段（`shop.example.com.cn → example.com.cn`），否则取末两段（`a.b.example.com → example.com`），从而正确处理国别二级 TLD
- **子域名自动共享**：两条凭据 `baseDomain` 相等即视为可互填（实现 FR-006）
- **跨类型共享**：`web ↔ android` 间的关联**仅**通过用户在「域名关联规则表」中显式建立的 `DomainAssociation { domains[], packageNames[] }` 实现；网站之间的跨基础域名关联也走同一规则表
- **多 URI 凭据**：单条凭据可在 `uris[]` 中保存任意数量的网站和 APP 目标（例如 `https://www.baidu.com` + `androidapp://com.baidu.tieba`），自动填充时对每一条独立调用 `isUriMatch`，命中即可作为候选
- **不使用通配符或正则**：当前实现仅基于「主机/包名 + 基础域名」的精确比对，未引入 Bitwarden 的 `UriMatchType` 通配符/正则方案，以减少歧义与误填风险（后续如有需要再扩展 `LoginUri.match` 字段）

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

## 10. sync-your-cookie 项目研究

**来源项目**: [jackluson/sync-your-cookie](https://github.com/jackluson/sync-your-cookie)  
**调研日期**: 2026/04/27  
**调研目标**: 为 pw-book 的 Cookie 同步功能（US6）获取可落地的技术方案参考

### 10.1 项目概述

sync-your-cookie 是一款 Chrome/Edge 浏览器扩展，用于将 Cookie 和 localStorage 同步到 Cloudflare KV 或 GitHub Gist。核心定位是帮助开发者在不同设备/浏览器间共享登录状态。

**功能特性**:
- 支持同步 Cookie + localStorage 到 Cloudflare KV 或 GitHub Gist
- 按域名配置 `Auto Merge`（自动合并）和 `Auto Push`（自动推送）规则
- 使用 protobuf 编码 + gzip 压缩传输数据
- 提供管理面板（Side Panel）查看、复制、管理已同步数据
- 基于 Storage-key 的多账号隔离
- 可选的 AES-GCM 密码加密

### 10.2 架构设计

```
chrome-extension/
  lib/background/
    index.ts       # Service Worker 入口：cookie 变化监听、自动同步、初始化拉取
    listen.ts      # 消息处理器：Push / Pull / Remove / Edit Cookie
    subscribe.ts   # 存储订阅：状态变化时更新 Badge、Context Menu
  pages/
    popup/         # 弹窗：手动 Push/Pull、includeLocalStorage 开关
    sidepanel/     # 侧边栏管理面板：查看所有域名 Cookie、编辑单条 Cookie
    content/       # Content Script：localStorage 的读取与写入
    options/       # 设置页：账号配置（Cloudflare/GitHub）、全局选项
packages/
  protobuf/        # protobuf 定义 + 编解码 + gzip 压缩 + AES-GCM 加密
  shared/          # 核心同步逻辑：Cloudflare/GitHub API 封装、合并写入、读取解码
  storage/         # 本地存储抽象：cookieStorage、domainConfigStorage、accountStorage
```

**四执行上下文**（与 pw-book 相同）:
1. **Background Service Worker** — 核心业务逻辑、API 通信、cookie 变化监听
2. **Popup** — 手动触发同步、配置当前域名的自动规则
3. **Content Scripts** — localStorage 的读取和注入（因同源策略，必须通过 content script 操作）
4. **Side Panel** — 管理界面（Chrome Side Panel API）

### 10.3 编码与压缩方案

sync-your-cookie 采用三层编码策略来减小传输体积：

**第一层：protobuf 结构化编码**

```protobuf
syntax = "proto3";

message Cookie {
  string domain = 1;
  string name = 2;
  string storeId = 3;
  string value = 4;
  bool session = 5;
  bool hostOnly = 6;
  float expirationDate = 7;
  string path = 8;
  bool httpOnly = 9;
  bool secure = 10;
  string sameSite = 11;
}

message LocalStorageItem {
  string key = 1;
  string value = 2;
}

message DomainCookie {
  int64 createTime = 1;
  int64 updateTime = 2;
  repeated Cookie cookies = 5;
  repeated LocalStorageItem localStorageItems = 6;
  string userAgent = 7;
}

message CookiesMap {
  int64 createTime = 1;
  int64 updateTime = 2;
  map<string, DomainCookie> domainCookieMap = 5;
}
```

**第二层：gzip 压缩**

使用浏览器原生 `CompressionStream` / `DecompressionStream` API 对 protobuf 二进制数据进行 gzip 压缩。实测可将典型 Cookie 数据压缩至原始大小的 15-30%。

**第三层：可选 AES-GCM 加密**

- 算法：AES-256-GCM
- 密钥派生：PBKDF2-SHA256，100,000 次迭代，16 字节随机 salt
- 格式：`[MAGIC (4)] [VERSION (1)] [SALT (16)] [IV (12)] [CIPHERTEXT]`
- 加密后的数据再做 Base64 编码，便于文本存储（GitHub Gist）

**完整编码流程**:
```
Cookie 对象
  ↓ protobuf encode
二进制 Uint8Array
  ↓ gzip (CompressionStream)
压缩后的二进制
  ↓ Base64
Base64 字符串
  ↓ 可选 AES-GCM encrypt + Base64
加密后的 Base64 字符串（写入 KV/Gist）
```

**对我们的启示**：
- protobuf + gzip 的组合确实能显著减小传输体积，对于 Cookie 这种高频同步场景非常有价值
- 但 pw-book 已有端到端加密体系（User Key + AES-256-GCM），无需额外的基于用户密码的加密层。可直接用 User Key 加密 protobuf 编码后的二进制数据
- 如果采用 protobuf，需要引入 `protobufjs` 或类似的编解码库，增加约 50-100KB 打包体积。考虑到 pw-book 的 Cookie 同步是 P3 优先级，**初期可先用 JSON + gzip，后续如体积敏感再迁移到 protobuf**

### 10.4 同步规则设计

sync-your-cookie 的自动同步规则设计简洁而实用。pw-book 当前版本**仅保留手动 Push/Pull**，不实现自动同步，但规则配置按域名存储的方式仍然适用：

**按域名配置（DomainConfigStorage）**:
```typescript
interface DomainConfig {
  domainMap: {
    [host: string]: {
      includeLocalStorage?: boolean; // 是否同步 localStorage（默认 false）
      favIconUrl?: string;           // 站点图标（UI 展示）
      sourceUrl?: string;            // 来源 URL
    }
  }
}
```

**手动同步**：
- 用户通过 Popup 面板手动触发 Push/Pull
- Pull 后自动刷新页面（`chrome.tabs.reload`），使 Cookie 生效

**对我们的启示**：
- 按域名配置同步规则的方式非常实用，应在 pw-book 中采用
- pw-book 可将规则配置同步到服务端，实现多端规则共享

### 10.5 存储后端设计

sync-your-cookie 将**所有域名的 Cookie 数据存储在单个 KV key** 下：

- **Cloudflare KV**: 一个 namespace 中只有一个 key（`storageKey`），value 是整个 `CookiesMap` 的编码数据
- **GitHub Gist**: 一个 Gist 文件中存放所有数据
- **合并策略**: 读取旧数据 → 按域名更新对应字段 → 完整写回

**优点**：
- 实现简单，无需管理多个 key
- 天然支持多域名批量操作

**缺点**：
- 数据量大时读写开销增加（全量覆盖）
- 并发修改风险（两设备同时 push 可能丢失一方的变更）
- 无法单独获取某个域名的数据（必须下载全部）

**pw-book 的改进方向**：
- 每个域名独立存储记录（`POST /api/cookies` 按域名），支持增量获取
- 利用 pw-book 已有的同步协议（pending changes + last-write-wins）处理并发冲突
- 服务端存储结构化数据，而非单个大 blob

### 10.6 Cookie 注入与 localStorage 同步

**Cookie 注入**:
```typescript
for (const cookie of cookieDetails) {
  const cookieDetail: chrome.cookies.SetDetails = {
    domain: cookie.domain,
    name: cookie.name,
    url: constructedUrl,
    storeId: cookie.storeId,
    value: cookie.value,
    expirationDate: cookie.expirationDate,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite as chrome.cookies.SameSiteStatus,
  };
  chrome.cookies.set(cookieDetail);
}
```

**localStorage 同步**:
- 读取：Content Script 遍历 `localStorage` 所有 key-value，通过 `chrome.runtime.sendMessage` 回传
- 写入：Background 发送消息到 Content Script，Content Script 执行 `localStorage.setItem()`
- 受同源策略限制，只能操作当前页面的 localStorage

**HttpOnly Cookie 的限制**:
- `chrome.cookies.getAll()` 可以获取 HttpOnly Cookie
- 但 `chrome.cookies.set()` 注入 HttpOnly Cookie 需要目标域名匹配
- 某些安全策略（SameSite=Strict, Secure on HTTPS）会限制注入效果

### 10.7 对 pw-book 的借鉴总结

| 方面 | sync-your-cookie 方案 | pw-book 适配建议 |
|------|----------------------|-----------------|
| **编码** | protobuf + gzip + 可选 AES-GCM | JSON + gzip（初期），User Key 端到端加密。后续可评估 protobuf |
| **同步规则** | 按域名配置同步开关 | 直接借鉴，规则可同步到服务端（当前版本仅手动 Push/Pull） |
| **防抖** | 10 秒防抖 + 30 秒冷却 | 直接借鉴 |
| **存储粒度** | 单 KV key 存全量 | 按域名分记录，利用现有同步协议 |
| **localStorage** | Content Script 读写 | 直接借鉴，但标记为可选/实验性功能 |
| **加密** | 基于用户自设密码（PBKDF2 10万次） | 复用 pw-book 的 User Key（Argon2id/PBKDF2 60万次） |
| **后端** | 第三方 KV（Cloudflare/GitHub） | 自托管后端，数据完全自主 |

### 10.8 局限性与已知风险

1. **全量覆盖写**：sync-your-cookie 每次 push 都是完整覆盖，多设备并发 push 必然丢失数据。pw-book 的自托管后端可解决此问题（独立记录 + last-write-wins）。
2. **加密密码非 KDF 强派生**：sync-your-cookie 的加密密码是用户自设的任意字符串，强度依赖用户。pw-book 使用主密码派生的 User Key，安全性更高。
3. **无冲突解决机制**：没有版本向量或时间戳冲突解决。pw-book 的 `modifiedAt` + last-write-wins 机制更完善。
4. **localStorage 安全性**：同步 localStorage 可能包含敏感令牌（如 JWT），应明确告知用户风险，并提供「仅同步 Cookie」选项。
5. **Cookie 安全属性限制**：现代浏览器的 Cookie 安全策略（SameSite=None 需 Secure、Partitioned Cookie 等）可能导致跨设备注入后无法正常使用。应在文档中明确列出限制。

---

## 9. 风险与注意事项

1. **自动填充的可靠性**：Bitwarden 投入大量工程资源处理各种网站的非标准表单。初期版本应优先覆盖主流网站，接受对部分非标准页面的降级处理。
2. **MV3 限制**：Chrome Extension Manifest V3 对 Service Worker 生命周期有严格限制，后台任务（如定时同步）需要使用 `chrome.alarms` API。
3. **Android 自动填充服务**：需要实现 `AutofillService`，处理系统级的自动填充请求，与浏览器扩展的自动填充是两套独立实现。
4. **Passkey 复杂度**：WebAuthn/FIDO2 协议复杂，CTAP2 通信涉及多个抽象层。建议分阶段实现，先支持 TOTP，再支持 Passkey。
5. **端到端加密的正确性**：加密实现必须经过安全审计。建议使用经过验证的库（Web Crypto API / Tink / BouncyCastle），避免自行实现加密原语。
6. **Cookie 同步的边界**：Cookie 同步受浏览器安全策略限制（SameSite、HttpOnly、Partitioned、Secure），无法保证 100% 的跨设备可用性。应在功能说明中明确告知用户此限制，并提供「仅密码管理，不启用 Cookie 同步」的选项。

---

## 11. Android Credential Provider 与 Passkey 跨端互通调研

**调研日期**: 2026/05/03
**调研目标**: 基于 `C:\projects\passkey-demo` 验证过的实现，设计 Android 端 Passkey 方案，确保与 Edge 插件端互通

### 11.1 参考实现（passkey-demo）核心架构

passkey-demo 是一个经过 webauthn.io 实测验证的 Android Credential Provider 实现：

| 组件 | 职责 |
|------|------|
| `MyCredentialProviderService` | 扩展 `CredentialProviderService`，处理系统的 `onBeginCreateCredentialRequest` 和 `onBeginGetCredentialRequest` |
| `CreateCredentialActivity` | 处理 Passkey/密码创建，生物识别认证后生成 WebAuthn 响应 |
| `GetCredentialActivity` | 处理 Passkey/密码获取，生物识别认证后签名 WebAuthn 断言 |
| `UnlockActivity` | 保险库解锁的生物识别弹窗 |
| `CredentialsRepo` | 内存存储，密码用 AES-256-GCM（Android Keystore）加密 |

**两阶段流程**：
1. **Begin/Query 阶段**：System 绑定到 Service → Service 返回 `PendingIntent` 包装的 credential entries
2. **Selection 阶段**：用户选择 entry → `PendingIntent` 启动对应 Activity → Activity 执行操作并返回结果

### 11.2 关键互通决策

#### 11.2.1 私钥存储：统一使用加密保险库（而非 Android Keystore 硬件绑定）

**问题**：Android Keystore 生成的私钥通常不可导出，无法同步到 Edge 端。

**决策**：
- Passkey 私钥以 PKCS#8 格式存储在 CipherData 中（与 Edge 端一致），用 User Key 加密
- Android 端从加密保险库解密私钥后，在内存中加载为 `ECPrivateKey` 进行签名
- 不依赖 Android Keystore 的硬件绑定特性，以换取跨端互通能力

**理由**：
1. 私钥已用 User Key（512-bit，仅解锁后的内存中存在）加密，安全级别足够
2. 与 Edge 端实现完全一致，简化同步逻辑
3. passkey-demo 的 `setUserAuthenticationRequired(false)` 也表明 demo 级实现不强制硬件绑定

**Android 私钥导入**：
```kotlin
val keySpec = PKCS8EncodedKeySpec(pkcs8Bytes)
val keyFactory = KeyFactory.getInstance("EC")
val privateKey = keyFactory.generatePrivate(keySpec) as ECPrivateKey
```

#### 11.2.2 私钥格式：PKCS#8（Base64）

Edge 端 `passkey-storage.ts` 使用 `crypto.subtle.exportKey("pkcs8", ...)` 导出私钥为 PKCS#8。

Android 端使用 `PKCS8EncodedKeySpec` 即可导入，无需格式转换。

#### 11.2.3 公钥格式：SPKI（Base64）+ 运行时生成 COSE_Key

Edge 端存储：
- `publicKey`: SPKI/DER 格式（Base64）—— 用于签名验证和导入
- 运行时从公钥导出 raw 坐标 (x, y)，编码为 COSE_Key（CBOR）用于 WebAuthn 注册响应

Android 端：
- 从 CipherData 读取 SPKI 公钥，用 `X509EncodedKeySpec` 导入为 `ECPublicKey`
- 从 `ECPublicKey.w` 获取 (x, y) 坐标，编码为 COSE_Key
- 签名时使用 `Signature.getInstance("SHA256withECDSA")`

#### 11.2.4 Base64 编码约定

| 字段 | 编码方式 | 理由 |
|------|---------|------|
| `privateKey` | 标准 Base64（带 padding） | 与现有加密协议一致，Android `java.util.Base64` 默认 |
| `publicKey` | 标准 Base64（带 padding） | 同上 |
| `credentialId` | Base64Url（无 padding） | WebAuthn 标准要求 |
| `userHandle` | Base64Url（无 padding） | WebAuthn 标准要求 |

Android 端解码时需要区分：标准 Base64 用 `java.util.Base64.getDecoder()`，Base64Url 用 `android.util.Base64.URL_SAFE | NO_WRAP | NO_PADDING`。

#### 11.2.5 签名格式：DER 编码的 ECDSA

- Edge 端：Web Crypto API 输出 IEEE-P1363（r||s 各 32 字节），然后手动 `p1363ToDer()` 转换
- Android 端：`Signature.getInstance("SHA256withECDSA")` 直接输出 DER 格式
- **结论**：两端最终都输出 DER 格式，与 WebAuthn 规范兼容，无需额外转换

#### 11.2.6 签名计数器

- 初始值为 0
- 每次使用后递增（`counter++`）
- Edge 端和 Android 端都需要在签名后更新 counter 并重新加密保存凭据
- 多设备并发使用可能导致计数器回退（last-write-wins），但大多数 RP 不严格验证计数器递增
- **决策**：接受此限制，在当前版本不引入复杂的计数器同步机制

#### 11.2.7 WebAuthn 响应格式一致性

两端必须生成完全一致的响应结构：

**Create（注册）响应**：
```json
{
  "id": "<credentialId base64url>",
  "rawId": "<credentialId bytes base64url>",
  "type": "public-key",
  "authenticatorAttachment": "platform",
  "response": {
    "clientDataJSON": "<base64url>",
    "attestationObject": "<base64url>",
    "authenticatorData": "<base64url>",
    "publicKeyAlgorithm": -7,
    "publicKey": "<SPKI base64url>",
    "transports": ["internal"]
  },
  "clientExtensionResults": { "credProps": { "rk": false } }
}
```

**Get（认证）响应**：
```json
{
  "id": "<credentialId base64url>",
  "rawId": "<credentialId bytes base64url>",
  "type": "public-key",
  "response": {
    "clientDataJSON": "<base64url>",
    "authenticatorData": "<base64url>",
    "signature": "<DER signature base64url>",
    "userHandle": "<base64url>"
  },
  "clientExtensionResults": {}
}
```

**关键字段**：
- `clientDataJSON`：JSON 字符串 `{"type":"webauthn.create|get","challenge":"...","origin":"https://<rpId>","crossOrigin":false}`
- `authenticatorData`：`rpIdHash(32) || flags(1) || signCount(4) || [attestedCredentialData]`
  - flags: `0x41` (AT+UP) for create, `0x05` (UP+UV) for get
  - signCount: 4 字节大端序
- `attestationObject`：CBOR 编码 `{"fmt":"none","attStmt":{},"authData":<bytes>}`

### 11.3 Android Credential Provider API 约束

**API 级别**：
- `CredentialProviderService` 需要 **Android 14+ (API 34)**
- 当前 `minSdk = 28`，需要提升到 `minSdk = 34` 或做运行时检查（API < 34 不启用 Credential Provider）
- **决策**：将 `minSdk` 提升至 34。理由：Passkey 是 P3 优先级功能，且 Android 14 已广泛普及（2026 年），为简化实现不保留兼容性代码。

**依赖**：
```kotlin
implementation("androidx.credentials:credentials:1.6.0")
```

**Manifest 声明**：
```xml
<service
    android:name=".service.credential.PwBookCredentialProviderService"
    android:exported="true"
    android:permission="android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE">
    <intent-filter>
        <action android:name="androidx.credentials.provider.CredentialProviderService" />
    </intent-filter>
</service>
```

### 11.4 与现有 Android 代码的集成点

| 现有模块 | 复用方式 |
|---------|---------|
| `VaultEncryption` / `AesGcmEngine` | 解密 Cipher 数据获取 Passkey 信息 |
| `BiometricUnlockManager` | Credential Provider Activity 中的生物识别确认 |
| `CipherRepository` | 查询/更新包含 Passkey 的 LOGIN 凭据 |
| `SyncManager` / `PendingChangesQueue` | 创建/使用 Passkey 后 enqueue 同步变更 |
| `UriMatcher` | 凭据匹配逻辑（rpId ↔ 域名） |
| `VaultSession` | 检查保险库是否解锁，未解锁时返回 AuthenticationAction |

### 11.5 Edge 端无需修改的确认

经对比，Edge 端 `passkey-storage.ts` 的实现已与 Android 端需求对齐：
- 私钥格式：PKCS#8 ✓
- 公钥格式：SPKI ✓
- 加密算法：ECDSA P-256 ✓
- 响应格式：完整的 WebAuthn create/get 响应 ✓
- Counter 递增逻辑 ✓

**无需修改 Edge 端代码**。
