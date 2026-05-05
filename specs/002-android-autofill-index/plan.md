# Implementation Plan: Android 自动填充凭据索引优化

**Branch**: `001-password-manager` | **Date**: 2026-05-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specks/002-android-autofill-index/spec.md`

## Summary

为 Android 端自动填充与 Passkey 场景引入凭据索引机制，避免每次匹配时全量解密所有凭据。通过独立的 Room 索引表存储非敏感匹配字段（域名、rpId、类型标记），在自动填充查询阶段先用索引筛选出候选 cipherId 集合，再仅对少量命中凭据执行解密。索引在凭据增删改、同步、解锁等生命周期事件中增量维护，确保与本地凭据集合完全一致。当索引缺失或异常时，自动降级为现有全量解密逻辑。

## Technical Context

**Language/Version**: Kotlin 2.1 (Android), JVM target 17
**Primary Dependencies**: Room 2.6.1, Hilt 2.55, Ktor 3.1.0, WorkManager 2.10.0, AndroidX Credentials 1.6.0, kotlinx.serialization 1.8.0
**Storage**: Room SQLite (AppDatabase v2 → v3)
**Testing**: JUnit 4, kotlinx-coroutines-test 1.10.1, Espresso 3.6.1, Compose UI test-junit4
**Target Platform**: Android 14+ (minSdk 34, compileSdk 35)
**Project Type**: mobile-app
**Performance Goals**: <500ms p95 for autofill suggestions; ≥60% latency reduction vs full decrypt at 300 ciphers
**Constraints**: Autofill callback must not block (non-UI thread); index must work when vault locked; service process can be killed by OS at any time; index storage same access control as cipher metadata (Android sandbox)
**Scale/Scope**: ~300 ciphers typical; autofill service ephemeral process lifecycle

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| 一、中文优先 | ✅ | 所有产出物（文档、注释、提交信息）使用中文 |
| 二、安全至上 | ✅ | 索引仅存储非敏感派生数据（域名、rpId、布尔标记）；不存储密码、私钥、TOTP、用户名明文；访问控制与现有 Room 数据库一致（Android 沙箱） |
| 三、测试先行 | ✅ | 每个用户故事的验收场景可独立测试；DAO 层需 instrumented test；过滤逻辑需单元测试 |
| 四、隐私保护 | ✅ | 无新增数据收集；索引由现有加密凭据派生；登出时清空索引；锁定时不解密 |
| 五、简洁设计 | ✅ | 单独表而非扩展 CipherEntity（SRP，可独立重建）；复用现有 `Converters` 处理列表序列化；无过度抽象 |

**Re-check after Phase 1**: All principles still pass. Complexity of separate table + Mutex is justified by performance requirements and concurrency safety.

## Project Structure

### Documentation (this feature)

```text
specs/002-android-autofill-index/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
apps/android/app/src/main/java/com/pwbook/
├── data/
│   ├── local/
│   │   ├── AppDatabase.kt              # + CipherIndexEntity, PendingRebuildEntity
│   │   ├── Converters.kt               # 已支持 List<String>，复用
│   │   ├── dao/
│   │   │   ├── CipherDao.kt            # 已有
│   │   │   └── CipherIndexDao.kt       # 新增
│   │   └── entity/
│   │       ├── CipherEntity.kt         # 已有
│   │       ├── CipherIndexEntity.kt    # 新增
│   │       └── PendingRebuildEntity.kt # 新增
│   └── repository/
│       ├── CipherRepository.kt         # 已有，扩展索引联动
│       └── CipherIndexRepository.kt    # 新增（索引读写抽象）
├── domain/
│   ├── index/
│   │   ├── CipherIndexStore.kt         # 索引业务逻辑（筛选、重建、一致性检查）
│   │   └── CipherIndexBuilder.kt       # 从解密后的 CipherData 构建索引条目
│   ├── matcher/
│   │   └── UriMatcher.kt               # 已有，域名提取规则
│   └── VaultSession.kt                 # 已有，解密能力
├── service/
│   ├── autofill/
│   │   ├── PwBookAutofillService.kt    # 已有，接入索引预筛选
│   │   └── SaveRequestHandler.kt       # 已有，接入索引预筛选
│   └── credential/
│       ├── PwBookCredentialProviderService.kt  # 已有，接入索引预筛选
│       └── PasskeyMatcher.kt           # 已有，二次校验
└── sync/
    ├── SyncManager.kt                  # 已有，同步后触发索引更新
    └── SyncWorker.kt                   # 已有，后台同步入口
```

**Structure Decision**: 采用与现有代码一致的包结构。新增 `domain.index` 包存放索引核心业务逻辑，与 `data.local` 中的 DAO/Entity 分离；`data.repository` 中新增 `CipherIndexRepository` 作为索引数据访问抽象，避免 service 层直接操作 DAO。

## Complexity Tracking

> 本功能引入了新的 Room 实体和并发协调机制，复杂度增加是必要的，理由如下：

| 设计决策 | 必要性 | 更简单的替代方案及拒绝原因 |
|-----------|--------|---------------------------|
| 独立的 `CipherIndexEntity` 表 | 索引数据是派生数据，非凭据本身；需要能独立清空/重建而不影响 cipher 表；遵循 SRP | 在 `CipherEntity` 上加列：会混淆源数据与派生索引，重建时需修改 cipher 行，增加耦合 |
| `Mutex` 协程锁协调并发重建 | Autofill Service、UI、SyncWorker 可能在不同线程同时触发索引更新；需要防止竞态导致数据不一致 | 纯 `@Transaction`：Room 事务只能保证单条 SQL 原子性，无法协调跨多个 DAO 操作（如 rebuild = deleteAll + insertAll）与并发 filter 查询 |
| 持久化 `PendingRebuildEntity` 表 | 锁定时收到同步事件必须记住待处理 cipherId，且需存活于进程重启 | 内存集合：进程被系统回收后丢失，导致索引不一致 |
| 索引筛选后二次校验 | 索引规则（如 DomainAssociation）可能比精确匹配宽松，需确保行为与未启用索引时完全一致 | 信任索引结果：可能引入假阳性，导致自动填充展示不匹配的凭据，破坏用户体验 |
