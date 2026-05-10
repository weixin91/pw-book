# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 使用中文

编写文档、注释一律使用中文。

## 仓库总览

`pw-book` 是自托管端到端加密密码管理器，采用 pnpm + workspaces 单仓多应用结构：

- `apps/backend/` — Fastify + Prisma + SQLite 后端 API（TypeScript，ESM）
- `apps/edge-extension/` — Edge / Chromium 浏览器扩展（Manifest V3，Vite + React 18）
- `apps/android/` — Android 原生 App（Kotlin 2.1，Jetpack Compose，Hilt，Room/SQLCipher）
- `packages/shared-types/` — `@pwbook/shared-types`，Edge 与 Backend 共用的 TypeScript 类型与常量
- `specs/001-password-manager/` — 加密协议、同步协议、API 契约等规格文档（修改加密/同步前必读 `contracts/`）
- `specs/002-android-autofill-index/` — Android 自动填充索引功能的规格

## 常用命令

### 根目录（所有应用）

```bash
pnpm install            # 安装所有 workspace 依赖
pnpm build              # 递归构建所有 package
pnpm test               # 递归跑所有 vitest 套件
pnpm lint               # ESLint（仅 .ts/.tsx）
pnpm format             # Prettier 格式化
pnpm dev:backend        # 启动后端（tsx watch，端口 3000）
pnpm dev:edge           # 启动 Edge 扩展开发模式（Vite）
```

### 后端（apps/backend）

```bash
pnpm --filter backend dev              # tsx watch
pnpm --filter backend build            # tsc
pnpm --filter backend test             # vitest run
pnpm --filter backend test -- <name>   # 跑单个测试（vitest 文件名/模式过滤）
pnpm --filter backend migrate:dev      # 开发期生成并应用 Prisma 迁移
pnpm --filter backend migrate:deploy   # 生产部署迁移
pnpm --filter backend generate         # 生成 Prisma Client
```

测试通过 `vitest.config.ts` 注入 `JWT_SECRET` 与 `DATABASE_URL=file:./test.db`；首次跑集成测试前需先执行迁移生成 `test.db`。

### Edge 扩展（apps/edge-extension）

```bash
pnpm --filter edge-extension dev        # Vite dev server
pnpm --filter edge-extension build      # tsc + vite build + esbuild bundling content/webauthn-page
pnpm --filter edge-extension test       # 单元 vitest
pnpm --filter edge-extension test:e2e   # tests/e2e（chrome API mock 见 tests/mocks/chrome-mock.ts）
```

`build` 脚本除 Vite 外还用 `esbuild` 单独打包两个特殊脚本：

- `src/content/content-script.ts` → `dist/content.js`（IIFE，注入到所有页面）
- `src/content/webauthn-page.ts` → `dist/webauthn-page.js`（IIFE，注入到页面 MAIN world，劫持 `navigator.credentials`）

修改这两个文件时不能依赖 ESM 模块，必须保持可被 IIFE 打包。

### Android（apps/android）

```bash
cd apps/android
./gradlew assembleDebug         # 构建 Debug APK
./gradlew assembleRelease       # Release（需要 local.properties 中的签名配置）
./gradlew test                  # JVM 单元测试
./gradlew connectedAndroidTest  # Instrumentation 测试
```

`settings.gradle.kts` 配置了阿里云镜像源（`maven.aliyun.com`），优先级高于 Google / MavenCentral。
Release 构建签名密钥从 `apps/android/local.properties` 读取（`RELEASE_STORE_PASSWORD` / `RELEASE_KEY_ALIAS` / `RELEASE_KEY_PASSWORD`），keystore 文件位于 `apps/android/pwbook-release.keystore`。
`compileSdk = 35`、`minSdk = 34`，需 JDK 17。

### Docker / 部署

```bash
docker compose up -d                                                # 用根目录 docker-compose.yml 一键启动
docker build -f apps/backend/Dockerfile -t pwbook-backend:latest .  # 后端镜像（构建上下文是仓库根，需访问 packages/shared-types）
```

## 高层架构

### 三端数据流

后端是唯一权威服务，存储**密文 blob**（零知识：服务端无法解密）；Edge 扩展与 Android App 是对等客户端，通过 REST + WebSocket 与后端同步：

```
┌──────────────┐                ┌──────────────┐
│ Edge 扩展    │ ◄── WebSocket ─┤              │
│ (browser)    │ ─── REST ────► │   Backend    │
└──────────────┘                │  (Fastify)   │
                                │  + SQLite    │
┌──────────────┐                │              │
│ Android App  │ ◄── WebSocket ─┤              │
│ (Kotlin)     │ ─── REST ────► │              │
└──────────────┘                └──────────────┘
```

加密/解密**只在客户端**进行。两端使用相同的密钥层次（详见 `specs/001-password-manager/contracts/crypto.md`）：
主密码 → KDF（Argon2id 优先，PBKDF2 兼容）→ Master Key → HKDF Stretched Key → 解密 Protected User Key（AES + HMAC 各 256 bit）→ 解密保险库数据；同时持有 RSA-2048 密钥对用于共享。

修改任意端的加密逻辑前必须确认与 `crypto.md` / `sync-protocol.md` / `api.md` 三份契约一致，否则会破坏跨端互通。

### 后端结构（`apps/backend/src/`）

`index.ts` 注册 Helmet、CORS（白名单见 `CORS_ALLOWED_ORIGINS`，默认放行 `chrome-extension://*` 与 `localhost:*`）后挂载路由：

- `auth/` — `POST /api/auth/{register,login,refresh}`，恢复码 `auth/recover.ts`，注册白名单 `auth/whitelist.ts`，时间常量比较 `auth/timing-safe.ts`
- `ciphers/` — 凭据 CRUD `/api/ciphers/*`
- `sync/` — `/api/sync` 拉取与 `/api/sync/push` 推送，含 checksum 校验
- `domain-assoc/` — 域名↔包名关联 `/api/domain-associations/*`
- `cookies/` — `/api/cookies/*` 与 `/api/cookie-sync-config/*`（仅 Edge 端使用）
- `devices/` — 设备列表
- `websocket/server.ts` — `@fastify/websocket`，向用户其他设备广播变更通知，触发增量同步
- `backup/scheduler.ts` — 启动时根据 `BACKUP_*` 环境变量启动 SQLite 在线热备份调度器
- `db/` — Prisma Client 单例
- `errors/handler.ts` — 全局错误转 JSON
- `rate-limiter.ts` — 简易限流

数据库 schema 位于 `apps/backend/prisma/schema.prisma`。核心表：`User`、`Cipher`（含 `deletedAt` 软删除）、`SyncRecord` / `Device`、`CookieData` / `CookieSyncConfig`、`DomainAssociation`、`RejectedSite`。`Cipher.data` 是已加密的 Base64 JSON。

### Edge 扩展结构（`apps/edge-extension/src/`）

- `background/background.ts` — Service Worker 入口；`webauthn-handler.ts` 处理 Passkey；`lock-timer.ts` 自动锁定；`cookie-auto-{push,pull}.ts` Cookie 自动同步
- `content/` — content script 与 page-world 脚本；`webauthn-handler.ts` ↔ `webauthn-page.ts` 通过 `window.postMessage` 桥接 MV3 隔离世界
- `popup/` — 弹窗 React 应用（`UnlockScreen` / `VaultList` / `CipherForm` / `PasswordGenerator` / `TotpDisplay` / `CookieSyncPanel`）
- `options/` — 设置页 React 应用
- `crypto/` — `crypto-service.ts`（WebCrypto AES-GCM/HKDF/PBKDF2）、`cipher-index.ts`（解密索引缓存）、`passkey-storage.ts`、`totp.ts`
- `sync/` — `sync-client.ts` REST 同步、`websocket-client.ts` WS 通知、`sync-scheduler.ts` 调度、`pending-changes.ts` 离线队列、`domain-assoc-sync.ts`、`cookie-sync-client.ts`
- `autofill/` — 表单识别（`collect-autofill-content.ts` / `login-detection.ts` / `domain-matcher.ts`）、注入（`insert-autofill-content.ts`）、内联菜单（`inline-menu.ts`）、保存提示与忽略列表
- `cookie/` — Cookie 提取/编解码/注入
- `platform/` — 浏览器抽象（`browser-api.ts` / `storage.ts` / `clipboard.ts` / `base64.ts`）
- `import/bitwarden-importer.ts` — Bitwarden 导入

### Android 结构（`apps/android/app/src/main/java/com/pwbook/`）

MVVM + Repository + Hilt DI，分层参考 Bitwarden Android：

- `crypto/` — 与 Edge 端协议兼容的加密实现（Argon2id 走 BouncyCastle，AES-GCM 走 JCE）
- `data/local/` — Room + SQLCipher 本地库，DAO 与 Entity（`Cipher` / `DomainAssoc` / `SyncQueue` / `Setting` / `RejectedSite`）
- `data/remote/` — Ktor Client REST API + WebSocket（`SyncWebSocketClient`）
- `data/repository/` — Repository 层
- `data/datasource/` — `EncryptedSharedPreferences`（用户配置）+ `SecureKeyDataSource`（Android Keystore 包装的会话密钥，配合生物识别解锁）
- `domain/` — UseCase（`UnlockVaultUseCase` 等）+ 业务模型 + `UriMatcher`
- `service/autofill/` — `AutofillService` 系统服务（`StructureParser` 解析 `AssistStructure`、`FillResponseBuilder`、`SaveRequestHandler`）
- `service/credential/` — `CredentialProviderService` Passkey 实现（`PasskeyCreateHandler` / `PasskeyGetHandler` / `WebAuthnResponseBuilder`），独立 Activity 处理 UI 解锁
- `sync/` — `SyncManager` + `SyncWorker`（WorkManager）+ `PendingChangesQueue` + `ConflictResolver`（last-write-wins）
- `ui/` — Compose UI（`screens/` / `login/` / `unlock/` / `settings/` / `generator/` / `navigation/PwBookNavHost.kt`）

`AndroidManifest.xml` 已声明 `AutofillService`、`CredentialProviderService` 及关联 Activity。

### 跨端类型（`packages/shared-types/src/`）

- `cipher.ts` — `CipherType` / `UriMatchType` 等枚举与凭据数据模型
- `api.ts` — REST 请求/响应类型
- `sync.ts` — 同步协议 DTO
- `kdf-constants.ts` — KDF 默认参数与允许范围（必须与 Android `crypto/` 中常量保持一致）
- `multi-segment-tlds.ts` — 多段 TLD 列表（用于域名匹配）

后端与 Edge 都依赖 `@pwbook/shared-types` 的编译产物（`dist/`），改动后需 `pnpm --filter @pwbook/shared-types build`（或在根目录跑 `pnpm build`）。Android 端**不通过 npm 链接**，相同语义需手动同步到 Kotlin 端。

## 环境变量（后端）

`JWT_SECRET`（必填，≥32 字符）、`DATABASE_URL`（默认 `file:./data/pwbook.db`）、`ALLOWED_EMAILS`（注册白名单，逗号分隔；不设置则允许所有人注册——服务启动时会打日志警告）、`CORS_ALLOWED_ORIGINS`、`BACKUP_ENABLED` / `BACKUP_DIR` / `BACKUP_HOUR` / `BACKUP_RETENTION_DAYS`（备份调度）。

## 项目特定约定

- **Edge 与 Android 必须保持数据互通**：Passkey、密码、域名关联等都通过同一份后端契约双向同步，任何一端的协议改动都会影响另一端，改动前先读 `specs/001-password-manager/contracts/`。
- **加密数据永远不出客户端解密态上后端**：backend 代码中绝不应出现明文密码或解密逻辑；服务端只做密文 CRUD、JWT 校验、KDF 参数透传、设备/同步元数据管理。
- **软删除**：`Cipher.deletedAt` 用作 tombstone，同步时下发删除标记；查询活跃凭据要带 `deletedAt: null` 过滤（已建覆盖索引）。
- **冲突解决**：后端以 `modifiedAt` 做 last-write-wins；客户端 pending 队列按客户端时间戳重放。
- **commit 信息**：参考最近提交风格，使用前缀 `feat(android):` / `fix:` 等，正文中文。
