# Research Notes: Android 自动填充凭据索引优化

**Feature**: Android 自动填充凭据索引优化  
**Date**: 2026-05-05  
**Purpose**: 解答规划阶段的技术未知项，记录决策依据。

---

## 决策 1：索引存储方案 — 独立 Room 表 vs. CipherEntity 扩展列

**Decision**: 采用独立的 `CipherIndexEntity` Room 表，不扩展 `CipherEntity`。

**Rationale**:
- 索引数据是**派生数据**（derived data），可由加密 JSON 解密后重新生成；与凭据源数据（source of truth）生命周期不同。
- 需要支持**独立清空/重建**（登出、同步全量重写、升级首次运行），若混在 cipher 表中，重建操作会触及 cipher 行，增加耦合和风险。
- Edge 扩展中索引与加密数据也是分离存储（`chrome.storage.local` 独立 key），Android 端保持架构对齐。
- Room 表支持 `@Transaction` 原子操作（如 `deleteAllByUser` + `insertAll`），便于重建流程。

**Alternatives considered**:
- **在 `CipherEntity` 上加列**（如 `indexDomains`、`indexRpIds`）： rejected。重建时需 UPDATE cipher 行，可能触发不必要的 Observer 通知；且 cipher 表 schema 变更成本更高。
- **SQLite FTS 虚拟表**：rejected。FTS 对 300 条记录的收益极低，增加 schema 复杂度；当前需求只是精确/子域名匹配，非全文搜索。

---

## 决策 2：变长列表存储 — JSON 字符串列 vs. 关联表

**Decision**: 使用 `List<String>` 经 JSON 序列化后存入单列，复用项目已有的 `Converters` 类。

**Rationale**:
- 项目已有的 `Converters.kt` 已使用 kotlinx.serialization 实现 `List<String>` ↔ JSON string 的转换，可直接复用。
- 索引规模极小（300 条 × 平均 3 个域名 ≈ 900 个字符串），全量加载到内存做 Kotlin 筛选完全可行，无需数据库级索引。
- 关联表（如 `CipherIndexDomainEntity`）需要维护外键和级联删除，增加 DAO 复杂度；对当前规模过度设计。

**Alternatives considered**:
- **一对一关联表**：rejected。无性能收益，增加 JOIN 查询和级联维护成本。
- **逗号分隔字符串**：rejected。JSON 更健壮，已有转换器支持，能自然处理含特殊字符的域名。

---

## 决策 3：并发控制 — Mutex + @Transaction vs. 单 Worker 协程

**Decision**: 在 `CipherIndexStore` 中使用 `kotlinx.coroutines.sync.Mutex` 协调重建/批量更新，DAO 方法使用 `@Transaction` 保证单操作原子性。

**Rationale**:
- 自动填充 Service、UI 编辑、SyncWorker 可能在**不同线程/进程**并发访问索引。Mutex 确保同一进程中不会同时执行重建（rebuild）和并发写操作。
- Room 的 `@Transaction` 保证单个 DAO 方法内多条 SQL 的原子性，但不能跨方法协调（如 rebuild = clear + insertAll）。
- 自动填充的**读操作（filter）**无需加锁：Room 的 Snapshot Isolation 保证读不会读到中间状态；即使读到旧数据，二次校验也会过滤掉已变更的条目。
- 比"单 Worker 协程"方案更简单：无需引入 Actor/Channel 队列，直接用 Mutex 保护写临界区。

**Alternatives considered**:
- **单 Worker 协程（Actor 模式）**：rejected。所有索引操作串行化到一个协程，需要额外队列管理；对于低频次写操作（非高频并发场景），Mutex 足够且代码更少。
- **读写锁（ReadWriteMutex）**：rejected。读操作本身在 Room 层面已安全；额外引入第三方库或手写读写锁不值得。

---

## 决策 4：待重建集合持久化 — Room 表 vs. EncryptedSharedPreferences

**Decision**: 使用独立的 `PendingRebuildEntity` Room 表存储待重建 cipherId 集合。

**Rationale**:
- 锁定时收到同步推送需记录 cipherId，且必须**存活于进程重启**。Room 表天然满足持久化需求。
- 与现有架构一致：所有结构化数据均存 Room；不引入新的存储介质。
- 表结构极简（仅 `cipherId` + `userId`），维护成本极低。

**Alternatives considered**:
- **EncryptedSharedPreferences / SettingEntity**：rejected。存 JSON 字符串在 Setting 表中不够结构化；Setting 表语义上是应用配置，不适合存储临时任务队列。
- **内存集合 + 文件备份**：rejected。需要自行处理序列化和文件 IO，增加出错面。

---

## 决策 5：数据库迁移策略

**Decision**: AppDatabase 从 version 2 升级到 version 3，新增 `cipher_index` 和 `pending_rebuild` 表；开发阶段可用 `fallbackToDestructiveMigration()`，但需提交一个标准 Room Migration 供生产使用。

**Rationale**:
- 现有 `AppDatabase` 已使用 `fallbackToDestructiveMigration()`，但生产环境不应丢失用户数据。
- Room Migration API 支持 `addMigrations(Migration(2, 3) { ... CREATE TABLE ... })`，标准做法。
- 升级后首次解锁触发索引重建，无需用户手动操作。

---

## 决策 6：索引筛选后的二次校验机制

**Decision**: 索引筛选返回候选 cipherId 集合后，必须解密对应凭据并用现有 Matcher 做二次校验（UriMatcher / PasskeyMatcher）。

**Rationale**:
- 索引提取规则可能与精确匹配逻辑存在细微差异（如 DomainAssociation 的子域规则、自定义 scheme 处理）。
- 二次校验是**安全闸门**：确保启用索引后的行为与未启用时**逐位等价**（bit-for-bit equivalent）。
- 校验仅对少量候选（通常 ≤5 条）执行，不破坏性能收益。

**性能影响**: 可忽略。以 300 条凭据为例，索引筛选后通常只剩 0–5 条候选；解密 + Matcher 校验耗时远低于解密全部 300 条。

---

## 参考实现

- **Edge 扩展**: `apps/edge-extension/src/crypto/cipher-index.ts` — 定义了 `CipherIndexEntry` 结构、`buildCipherIndexEntry`、`filterByDomain`、`filterByRpId` 等核心逻辑。Android 端逻辑与之对齐，但改用 Kotlin + Room 实现持久化。
- **现有 Matcher**: `com.pwbook.domain.matcher.UriMatcher` 和 `com.pwbook.service.credential.PasskeyMatcher` — 二次校验直接复用，无需修改。
