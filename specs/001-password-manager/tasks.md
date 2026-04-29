---
description: "密码管理应用功能实现的任务列表"
---

# 任务清单：密码管理应用

**输入来源**: `/specs/001-password-manager/` 下的设计文档
**前置条件**: plan.md, spec.md, research.md, data-model.md, contracts/
**上下文**: 优先开发插件和后端，Android 端可在后端和 Edge 插件核心功能完成后推进

**组织方式**: 任务按用户故事分组，以便每个故事可独立实现和测试。

## 格式说明: `[ID] [P?] [Story] 描述`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 该任务所属的用户故事（例如 US1, US2, US3）
- 描述中包含确切的文件路径

---

## 阶段 1：搭建（共享基础设施）

**目的**：项目初始化和基本结构

- [X] T001 创建 monorepo 根结构，包含 `pnpm-workspace.yaml` 和根目录 `package.json`
- [X] T002 初始化后端项目于 `apps/backend/`（package.json, tsconfig.json，按 plan.md 的目录结构）
- [X] T003 初始化 Edge 插件项目于 `apps/edge-extension/`（package.json, tsconfig.json, vite.config.ts，按 plan.md 的目录结构）
- [X] T005 [P] 创建共享类型包于 `packages/shared-types/`（package.json, tsconfig.json，导出入口）
- [X] T006 [P] 配置代码质量工具（ESLint, Prettier, .editorconfig）于仓库根目录

---

## 阶段 2：基础（阻塞性前置条件）

**目的**：在任何用户故事实现之前必须完成的核心基础设施。按照优先级，优先完成后端和 Edge 插件。

**⚠️ 关键**：在完成此阶段之前，不能开始任何用户故事的工作

- [X] T007 定义 Prisma 数据模型于 `apps/backend/prisma/schema.prisma`（User, Cipher, DomainAssociation, SyncRecord, Device, CookieData, RejectedSite）
- [X] T008 [P] 实现 Fastify 应用入口和插件系统于 `apps/backend/src/index.ts`
- [X] T009 [P] 使用 `jose` 实现 JWT 认证中间件于 `apps/backend/src/auth/jwt.ts`
- [X] T010 [P] 实现统一错误处理和响应格式于 `apps/backend/src/errors/handler.ts`
- [X] T011 [P] 实现注册/登录/刷新 Token API 于 `apps/backend/src/auth/routes.ts`
- [X] T012 [P] 实现恢复密钥重置 API 于 `apps/backend/src/auth/recover.ts`
- [X] T013 运行 Prisma 迁移并生成客户端（`prisma/migrations/` 和 `@prisma/client`）
- [X] T014 [P] 配置 Edge Manifest V3 于 `apps/edge-extension/src/manifest.json`
- [X] T015 [P] 配置 Vite 多入口构建于 `apps/edge-extension/vite.config.ts`（background, content, popup, options）
- [X] T016 [P] 实现浏览器 API 抽象层于 `apps/edge-extension/src/platform/browser-api.ts`
- [X] T017 [P] 实现 Web Crypto 加密核心于 `apps/edge-extension/src/crypto/crypto-service.ts`（KDF, AES-256-GCM, RSA，遵循 `contracts/crypto.md`）
- [X] T018 [P] 实现保险库本地存储于 `apps/edge-extension/src/platform/storage.ts`（`chrome.storage.local`, IndexedDB）
- [X] T019 [P] 定义共享 TypeScript 类型于 `packages/shared-types/src/`（cipher.ts, sync.ts, api.ts）

**检查点**：基础就绪 — 用户故事实现现在可以并行开始

---

## 阶段 3：用户故事 1 — 保存和自动填充密码 (优先级: P1) 🎯 MVP

**目标**：Edge 插件检测登录成功，提示保存凭据，并在再次访问时自动填充已保存的凭据。

**独立测试**：仅安装 Edge 插件，访问测试网站并手动登录，验证 5 秒内是否弹出保存提示。确认保存后退出登录，再次访问该网站，验证自动填充是否正常。

### 用户故事 1 的实现

- [X] T020 [P] [US1] 实现内容脚本入口和消息桥接于 `apps/edge-extension/src/content/content-script.ts`
- [X] T021 [P] [US1] 实现表单检测服务 `apps/edge-extension/src/autofill/collect-autofill-content.ts`（DOM 遍历、语义分析、MutationObserver）
- [X] T022 [US1] 实现登录成功检测引擎于 `apps/edge-extension/src/autofill/login-detection.ts`（表单提交拦截、AJAX/fetch 拦截、webNavigation 监听、后台暂存）
- [X] T023 [US1] 实现保存密码提示 UI 于 `apps/edge-extension/src/autofill/save-prompt.ts`（行内浮层，5 秒触发）
- [X] T024 [P] [US1] 实现自动填充引擎于 `apps/edge-extension/src/autofill/insert-autofill-content.ts`（字段匹配、数据注入）
- [X] T025 [US1] 实现行内菜单 / 账号选择器于 `apps/edge-extension/src/autofill/inline-menu.ts`（多账号下拉菜单，默认填充最近使用的，遵循 FR-019）
- [X] T026 [P] [US1] 实现域名匹配算法于 `apps/edge-extension/src/autofill/domain-matcher.ts`（基础域名提取、URI 匹配，遵循 `contracts/sync-protocol.md`）
- [X] T027 [P] [US1] 实现拒绝保存站点存储于 `apps/edge-extension/src/autofill/rejected-sites.ts`（30 天内不再提示，遵循 FR-020）
- [X] T028 [US1] 实现 Popup 基础框架于 `apps/edge-extension/src/popup/`（解锁界面、保险库外壳、导航）
- [X] T029 [P] [US1] 实现剪贴板安全管理器于 `apps/edge-extension/src/platform/clipboard.ts`（10 秒自动清空、计时器重置，遵循 FR-017/FR-023）

**检查点**：此时，用户故事 1 应在 Edge 中完全可用并可独立测试

---

## 阶段 4：用户故事 2 — 多端数据同步 (优先级: P1)

**目标**：后端和 Edge 插件实现实时同步能力，为后续 Android 接入提供稳定的同步协议和 API。

**独立测试**：启动后端，在 Edge 插件中添加一条密码，验证数据能通过同步 API 正确存储和读取。断开 Edge 网络，编辑密码，恢复网络后验证自动同步。Android 端测试在阶段 10 完成。

### 后端任务

- [X] T030 [P] [US2] 实现全量/增量同步 API（`GET /api/sync`）于 `apps/backend/src/sync/routes.ts`
- [X] T031 [P] [US2] 实现推送变更 API（`POST /api/sync/push`）于 `apps/backend/src/sync/routes.ts`
- [X] T032 [P] [US2] 实现凭据 CRUD API 于 `apps/backend/src/ciphers/routes.ts`（POST/PUT/DELETE/GET，遵循 `contracts/api.md`）
- [X] T033 [P] [US2] 实现 WebSocket 实时同步服务端于 `apps/backend/src/websocket/server.ts`（推送 SYNC_REQUIRED）
- [X] T034 [P] [US2] 实现设备管理 API 于 `apps/backend/src/devices/routes.ts`（GET/DELETE，遵循 `contracts/api.md`）
- [X] T035 [P] [US2] 实现同步载荷校验和验证于 `apps/backend/src/sync/checksum.ts`

### Edge 插件任务

- [X] T036 [US2] 实现同步客户端于 `apps/edge-extension/src/sync/sync-client.ts`（全量同步、基于时间戳的增量同步）
- [X] T037 [US2] 实现离线待处理变更队列于 `apps/edge-extension/src/sync/pending-changes.ts`（`chrome.storage.local`、FIFO 处理，遵循 `contracts/sync-protocol.md`）
- [X] T038 [US2] 实现重连后自动同步于 `apps/edge-extension/src/sync/sync-scheduler.ts`（网络恢复检测、队列刷新）
- [X] T039 [P] [US2] 实现 WebSocket 客户端及轮询降级于 `apps/edge-extension/src/sync/websocket-client.ts`（指数退避、30 秒轮询）

**检查点**：用户故事 1 和 2 应均可独立运行；Edge 和后端同步协议稳定，为 Android 接入做好准备

---

## 阶段 5：用户故事 3 — 密码管理和生成 (优先级: P2)

**目标**：用户可以查看、手动添加、编辑和删除密码条目，并生成高强度随机密码。

**独立测试**：在 Edge 弹窗中，验证手动增删改查操作和密码生成器输出是否符合配置规则。

### Edge 插件任务

- [X] T046 [P] [US3] 实现 Popup 保险库列表 UI 于 `apps/edge-extension/src/popup/components/VaultList.tsx`（解密后的凭据列表、搜索、收藏）
- [X] T047 [P] [US3] 实现添加/编辑凭据表单于 `apps/edge-extension/src/popup/components/CipherForm.tsx`（用户名、密码、URI、备注）
- [X] T048 [P] [US3] 实现密码生成器于 `apps/edge-extension/src/popup/components/PasswordGenerator.tsx`（长度、字符类型、排除易混淆字符，遵循 FR-021）
- [X] T049 [US3] 实现密码生成器设置持久化于 `apps/edge-extension/src/popup/settings.ts`
- [X] T050 [US3] 实现保险库自动锁定逻辑于 `apps/edge-extension/src/background/lock-timer.ts`（可配置超时、后台锁定，遵循 FR-014）

**检查点**：Edge 端密码管理功能可用

---

## 阶段 6：用户故事 4 — 跨域名和应用共享凭据 (优先级: P2)

**目标**：子域名自动共享凭据；用户可以手动关联域名和应用包名。

**独立测试**：保存 `www.baidu.com` 的凭据，访问 `tieba.baidu.com`，验证自动共享是否生效。域名关联规则可在 Edge 端配置和验证。

### 后端任务

- [X] T056 [P] [US4] 实现域名关联 CRUD API 于 `apps/backend/src/domain-assoc/routes.ts`（遵循 `contracts/api.md`）

### Edge 插件任务

- [X] T057 [US4] 实现域名关联规则同步于 `apps/edge-extension/src/sync/domain-assoc-sync.ts`
- [X] T058 [P] [US4] 实现基础域名提取工具于 `apps/edge-extension/src/autofill/domain-utils.ts`

**检查点**：跨域名凭据共享在 Edge 端可用，后端 API 为 Android 接入做好准备

---

## 阶段 7：用户故事 5 — Passkey 和 TOTP 支持 (优先级: P3)

**目标**：Passkey 登录和 TOTP 验证码生成。

**独立测试**：独立测试 Passkey 存储/读取和 TOTP 验证码生成，与已知密钥对比。

### Edge 插件任务

- [X] T061 [P] [US5] 实现 TOTP 验证码生成器于 `apps/edge-extension/src/crypto/totp.ts`（RFC 6238, SHA-1/256/512）
- [X] T062 [US5] 实现 TOTP 倒计时 UI 于 `apps/edge-extension/src/popup/components/TotpDisplay.tsx`
- [X] T063 [P] [US5] 实现 Passkey 存储结构于 `apps/edge-extension/src/crypto/passkey-storage.ts`。Passkey 数据作为 `type=1` (LOGIN) 凭据的附加字段（`data.passkey`）存储，与同一站点的用户名/密码共存，避免独立 `type=5` 条目带来的管理碎片化
- [X] T064 [US5] 实现 WebAuthn 桥接与选择弹窗于 `apps/edge-extension/src/content/webauthn-handler.ts` 和 `apps/edge-extension/src/content/passkey-prompt.ts`。create 时先查询同域名 LOGIN 候选凭据并弹窗让用户选择「保存到现有」或「新建」；get 时若多匹配则弹窗让用户选择具体凭证，单匹配直接自动选用
- [X] T075 [US5] 实现凭据编辑页 Passkey 展示与删除于 `apps/edge-extension/src/popup/components/CipherForm.tsx`。加载时读取 `data.passkey`，展示 `rpId`/`rpName` 与添加时间，提供「删除通行密钥」按钮（仅移除 passkey 字段，保留 login 等其他数据）。保存凭据时保留原有 passkey 字段防止意外丢失
- [X] T076 [US5] 实现凭据列表 Passkey 图标指示于 `apps/edge-extension/src/popup/components/VaultList.tsx`。列表项若包含 `data.passkey`，在名称旁显示 🔐 图标以快速识别

**检查点**：Passkey 和 TOTP 在 Edge 端可用，为 Android 实现提供参考

---

## 阶段 8：用户故事 6 — Cookie 同步 (优先级: P3)

**目标**：Edge 插件提取并同步 Cookie；按规范 Android 不实现 Cookie 同步。

**独立测试**：仅在 Edge 插件中，验证特定站点的 Cookie 是否被提取并安全同步。使用手动 Push/Pull，验证同步行为是否符合预期。

### 后端任务

- [X] T067 [P] [US6] 实现 Cookie 数据模型与 Prisma Schema 于 `apps/backend/prisma/schema.prisma`（CookieData、CookieSyncConfig 表）
- [X] T068 [P] [US6] 实现 Cookie 同步 API 于 `apps/backend/src/cookies/routes.ts`（POST /api/cookies、POST /api/cookies/batch、GET /api/cookies/:domain、GET /api/cookies、DELETE /api/cookies/:domain，遵循 `contracts/api.md` §5.1–5.5）
- [X] T069 [P] [US6] 实现 Cookie 同步规则配置 API 于 `apps/backend/src/cookies/config-routes.ts`（PUT/GET/DELETE /api/cookie-sync-config，遵循 `contracts/api.md` §5.6）

### Edge 插件任务

- [X] T070 [US6] 实现 Cookie 提取与编码模块于 `apps/edge-extension/src/cookie/cookie-extractor.ts`（`chrome.cookies.getAll()` 封装、CookieItem 格式化、排除敏感字段）
- [X] T071 [P] [US6] 实现 Cookie 数据编解码与压缩于 `apps/edge-extension/src/cookie/cookie-codec.ts`（JSON → gzip → AES-256-GCM 加密 → Base64；反向解码。复用 User Key，参考 `contracts/crypto.md`）
- [X] T072 [US6] 实现 Cookie 同步客户端于 `apps/edge-extension/src/sync/cookie-sync-client.ts`（上传/拉取/删除、批量上传、错误处理与重试）
- [X] T073 [US6] 实现 Cookie 注入引擎于 `apps/edge-extension/src/cookie/cookie-injector.ts`（`chrome.cookies.set()` 封装、按 domain/path/secure 等属性精确还原、localStorage 通过 content script 注入）
- [X] T074 [US6] 实现同步规则配置存储于 `apps/edge-extension/src/cookie/sync-config-storage.ts`（按域名存储 includeLocalStorage，与服务端规则双向同步）
- [X] T075 [US6] 实现手动推送逻辑于 `apps/edge-extension/src/background/cookie-auto-push.ts`（提取当前域名 Cookie、编码加密、推送至服务端）
- [X] T076 [US6] 实现手动拉取逻辑于 `apps/edge-extension/src/background/cookie-auto-pull.ts`（从服务端拉取、解密解码、注入 Cookie 与 localStorage、可选刷新页面）
- [X] T077 [P] [US6] 实现 Popup Cookie 同步控制面板于 `apps/edge-extension/src/popup/components/CookieSyncPanel.tsx`（当前域名手动 Push/Pull、includeLocalStorage 开关）
- [X] T078 [P] [US6] 实现 Content Script localStorage 桥接于 `apps/edge-extension/src/content/localstorage-bridge.ts`（消息接口：GET_LOCAL_STORAGE / SET_LOCAL_STORAGE，同源策略下的安全读写）

**检查点**：Cookie 同步仅在 Edge 端可用；手动 Push/Pull 均通过独立测试

---

## 阶段 9：打磨与跨领域关注

**目的**：影响多个用户故事的改进项

- [X] T079 [P] 添加 Docker 和 Docker Compose 自托管配置（`Dockerfile`、`docker-compose.yml` 于仓库根目录）
- [X] T080 [P] 添加后端集成测试于 `apps/backend/tests/integration/`（认证、同步、凭据、冲突解决）
- [X] T081 [P] 添加 Edge 端到端测试场景于 `apps/edge-extension/tests/e2e/`（自动填充流程、同步流程，遵循 `quickstart.md`）
- [X] T082 对照 `contracts/crypto.md` 第 11 节验证安全审计清单（AES-256-GCM、IV 唯一性、CSPRNG、无明文密码等）
- [X] T083 在 Edge 自动填充中实现性能保护措施（MutationObserver 防抖 100ms、500 个输入元素上限、非关键扫描使用 `requestIdleCallback`，遵循 `research.md`）

---

## 阶段 10：Android 应用开发（最后完成）

**目的**：在所有后端 API、Edge 插件和核心功能稳定后，再集中完成 Android 端实现。

**前提条件**：后端（阶段 2 + US2 API）、同步协议（US2）、加密协议（contracts/crypto.md）均已稳定。Edge 端实现为 Android 提供参考实现。

**详细技术方案**: 参见 `android-architecture.md`

### Phase 1: 基础保险库（MVP）

- [ ] T004 [P] 初始化 Android 项目于 `apps/android/`（build.gradle.kts, settings.gradle.kts，minSdk=28, compileSdk=35，模块结构按 plan.md）
- [ ] T040 [P] 搭建 Android 项目架构于 `apps/android/app/build.gradle.kts`（Hilt KSP、Room、Navigation Compose、Ktor、Security、Biometric、Credentials、WorkManager 依赖）
- [ ] T090 [P] 配置 Hilt Application 和基础 DI 模块于 `apps/android/app/di/`（AppModule、DatabaseModule、NetworkModule、CryptoModule、ServiceModule）
- [ ] T041 [P] 实现 Kotlin 加密核心于 `apps/android/app/crypto/`（AES-256-GCM、Argon2id via BouncyCastle、PBKDF2、HKDF，与 Edge 协议兼容，遵循 `contracts/crypto.md`）
- [ ] T091 [P] 实现 Room 数据库和实体于 `apps/android/app/data/local/`（CipherEntity、DomainAssocEntity、SyncQueueEntity、SettingEntity、RejectedSiteEntity 及对应 DAO）
- [ ] T092 [P] 实现 Repository 层于 `apps/android/app/data/repository/`（CipherRepository、DomainAssocRepository、SettingsRepository）
- [ ] T093 [P] 实现安全数据源于 `apps/android/app/data/datasource/`（EncryptedSharedPreferences 封装、Android Keystore 密钥管理）
- [ ] T094 [P] 实现 Compose 主题、导航和基础页面框架于 `apps/android/app/ui/`（Theme、NavHost、UnlockScreen、VaultListScreen）
- [ ] T095 [P] 实现主密码解锁流程于 `apps/android/app/ui/unlock/UnlockScreen.kt` 和 `apps/android/app/domain/usecase/UnlockVaultUseCase.kt`
- [ ] T096 [P] 实现密码生成器于 `apps/android/app/domain/usecase/GeneratePasswordUseCase.kt` 和 `apps/android/app/ui/generator/PasswordGeneratorScreen.kt`
- [ ] T097 实现凭据添加/编辑/删除页面于 `apps/android/app/ui/screens/edit/CipherEditScreen.kt`

### Phase 2: 同步与自动填充

- [ ] T042 [P] 实现 Ktor Client 和 API 服务层于 `apps/android/app/data/remote/api/`（AuthApi、SyncApi、CipherApi、DomainAssocApi，含 DTO 和 kotlinx.serialization）
- [ ] T098 [P] 实现 WebSocket 同步客户端于 `apps/android/app/data/remote/websocket/SyncWebSocketClient.kt`
- [ ] T043 实现 Android 同步管理器于 `apps/android/app/sync/SyncManager.kt`（全量/增量同步、last-write-wins 冲突解决）
- [ ] T044 实现离线待处理变更队列于 `apps/android/app/sync/PendingChangesQueue.kt` 和 SyncQueueDao
- [ ] T099 实现 WorkManager 定时同步任务于 `apps/android/app/sync/SyncWorker.kt`（15 分钟周期、网络恢复触发、前台触发）
- [ ] T100 实现 `AutofillService` 于 `apps/android/app/service/autofill/PwBookAutofillService.kt`
- [ ] T101 [P] 实现 AssistStructure 解析器于 `apps/android/app/service/autofill/StructureParser.kt`（用户名/密码字段识别、webDomain/packageName 提取）
- [ ] T102 [P] 实现 FillResponse 构建和账号选择数据集于 `apps/android/app/service/autofill/FillResponseBuilder.kt`
- [ ] T103 实现 `onSaveRequest` 保存密码逻辑于 `apps/android/app/service/autofill/SaveRequestHandler.kt`（结合拒绝列表 FR-020）
- [ ] T060 实现 AutofillService 域名匹配于 `apps/android/app/domain/matcher/UriMatcher.kt`（与 Edge 端对齐的基础域名提取、包名匹配、DomainAssociation 规则应用）

### Phase 3: 增强安全与 Passkey

- [ ] T055 实现自动锁定和生物识别解锁于 `apps/android/app/service/biometric/`（BiometricUnlockManager、KeystoreHelper、BiometricPrompt + CryptoObject，遵循 FR-016）
- [ ] T104 [P] 实现剪贴板安全管理于 `apps/android/app/domain/usecase/CopyPasswordUseCase.kt`（10 秒自动清空、计时器重置，遵循 FR-017/FR-023）
- [ ] T065 [P] 实现 TOTP 生成和显示于 `apps/android/app/crypto/TotpGenerator.kt` 和 `apps/android/app/ui/components/TotpDisplay.kt`（RFC 6238、环形倒计时进度条）
- [ ] T105 [P] 实现 ZXing 二维码扫描于 `apps/android/app/ui/screens/scan/TotpScanScreen.kt`（解析 otpauth:// URI）
- [ ] T066 实现 `CredentialProviderService` 于 `apps/android/app/service/credential/PwBookCredentialProviderService.kt`（Passkey，遵循 FR-008）
- [ ] T106 [P] 实现 Passkey 创建处理于 `apps/android/app/service/credential/PasskeyCreateHandler.kt`（两阶段流程、保存到现有凭据/新建、EC P-256 密钥对生成）
- [ ] T107 [P] 实现 Passkey 认证处理于 `apps/android/app/service/credential/PasskeyGetHandler.kt`（查询阶段返回候选、选择阶段签名 WebAuthn 断言）
- [ ] T108 实现 Passkey 创建/认证 Activity 于 `apps/android/app/service/credential/PasskeyCreateActivity.kt` 和 `PasskeyGetActivity.kt`（PendingIntent 处理、生物识别认证、返回 WebAuthn 响应）
- [ ] T059 实现域名关联管理 UI 于 `apps/android/app/ui/screens/settings/DomainAssocScreen.kt`

### Phase 4: 打磨

- [ ] T109 [P] 实现加密兼容性测试（共享测试向量，验证 Android 加密结果与 Edge 端可互解密）
- [ ] T110 [P] 添加单元测试覆盖（Crypto、URI Matcher、Password Generator、TOTP、Sync Conflict Resolver，目标 >80%）
- [ ] T111 性能优化（Room 索引、LazyColumn 缓存、加密缓存、数据库查询优化）

**检查点**：Android 应用所有功能可用，可与 Edge 和后端完成端到端测试

---

## 依赖关系与执行顺序

### 阶段依赖

- **搭建（阶段 1）**：无依赖 — 可立即开始
- **基础（阶段 2）**：依赖搭建完成 — 阻塞所有用户故事。重点：后端认证 + Edge 加密/存储优先。
- **用户故事（阶段 3–9）**：均依赖基础阶段完成
  - 之后后端和 Edge 任务可并行推进（如有足够人手）
  - 或按优先级顺序依次推进（P1 → P2 → P3）
- **Android（阶段 10）**：依赖阶段 1–9 全部完成 — 所有后端 API、Edge 功能、同步协议稳定后再开始
- **打磨（阶段 9）**：依赖阶段 3–8 的目标用户故事完成

### 用户故事依赖

- **用户故事 1 (P1)**：基础（阶段 2）完成后即可开始 — 不依赖其他故事
- **用户故事 2 (P1)**：基础（阶段 2）完成后即可开始 — 依赖 US1 的自动填充捕获数据，但可通过手动创建凭据独立测试
- **用户故事 3 (P2)**：基础（阶段 2）完成后即可开始 — 基于 US1/US2 的存储和同步基础设施
- **用户故事 4 (P2)**：US1 和 US2 完成后开始 — 需要域名匹配和同步基础设施
- **用户故事 5 (P3)**：US2/US3 完成后开始 — 需要凭据存储和同步
- **用户故事 6 (P3)**：US2 完成后开始 — 需要同步基础设施

### 每个用户故事内部

- 先模型 / 契约，后服务
- 先服务，后端点 / UI
- 先核心实现，后集成
- 完成当前故事后再进入下一优先级

### 并行机会

- 所有标记 [P] 的搭建任务可并行
- 所有标记 [P] 的基础任务可并行（阶段 2 内）
- 基础阶段完成后，后端和 Edge 任务可并行推进（如团队容量允许）
- 同一故事内的后端 API 任务和 Edge UI 任务可并行
- 同一故事内所有标记 [P] 的任务无相互依赖，可并行
- Android（阶段 10）内部任务可并行

---

## 并行示例：用户故事 1

```bash
# 后端认证已在基础阶段完成
# 同时启动 US1 的所有并行 Edge 任务：
Task: "实现内容脚本入口 apps/edge-extension/src/content/content-script.ts"
Task: "实现表单检测服务 apps/edge-extension/src/autofill/collect-autofill-content.ts"
Task: "实现自动填充引擎 apps/edge-extension/src/autofill/insert-autofill-content.ts"
Task: "实现域名匹配算法 apps/edge-extension/src/autofill/domain-matcher.ts"
Task: "实现拒绝保存站点存储 apps/edge-extension/src/autofill/rejected-sites.ts"
Task: "实现剪贴板安全管理器 apps/edge-extension/src/platform/clipboard.ts"

# 并行任务完成后，实现有依赖的任务：
Task: "实现登录成功检测引擎"
Task: "实现保存密码提示 UI"
Task: "实现行内菜单 / 账号选择器"
Task: "实现 Popup 基础框架"
```

---

## 实施策略

### MVP 优先（仅后端 + Edge 插件）

1. 完成阶段 1：搭建
2. 完成阶段 2：基础（后端认证 + Edge 加密/存储）
3. 完成阶段 3：用户故事 1（Edge 自动填充核心）
4. 完成阶段 4：用户故事 2（同步后端 + Edge 同步客户端）
5. **暂停并验证**：独立测试 Edge 插件（后端运行中）
6. 如就绪则部署/演示

### 增量交付

1. 完成搭建 + 基础 → 基础就绪
2. 添加用户故事 1 → 独立测试 → Edge 自动填充 MVP
3. 添加用户故事 2 → 独立测试 → 后端 + 同步 MVP
4. 添加用户故事 3 → Edge 弹窗管理
5. 添加用户故事 4 → 跨域名共享
6. 添加用户故事 5 → Passkey + TOTP
7. 添加用户故事 6 → Cookie 同步（仅 Edge）
8. 完成阶段 9 打磨 → 后端和 Edge 功能稳定
9. 最后添加阶段 10 → Android 应用完整实现
10. 每个故事增加价值，不破坏之前功能

### 优先级对齐的团队策略

根据用户上下文（优先开发插件和后端，Android 最后完成）：

1. 团队以后端 + Edge 为重点完成搭建 + 基础
2. 基础完成后：
   - 开发 A：用户故事 1（Edge 自动填充）
   - 开发 B：用户故事 2–6 后端 API + Edge 功能
3. 后端和 Edge 全部稳定后，再集中资源完成阶段 10（Android）
4. 各故事独立完成并集成

---

## 备注

- [P] 任务 = 不同文件，无依赖
- [Story] 标签将任务映射到特定用户故事，以便追溯
- 每个用户故事应可独立完成和测试
- 每个任务或逻辑组完成后提交代码
- 可在任何检查点暂停以独立验证故事
- 避免：模糊任务、同一文件冲突、破坏独立性的跨故事依赖
- Android 实现遵循相同的用户故事阶段，但按项目优先级有意安排在后端和 Edge 之后
