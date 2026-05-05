# Data Model: Android 自动填充凭据索引优化

**Feature**: Android 自动填充凭据索引优化  
**Date**: 2026-05-05

---

## 实体概览

```text
┌─────────────────────┐       ┌─────────────────────────┐
│   CipherEntity      │       │   CipherIndexEntity     │
├─────────────────────┤       ├─────────────────────────┤
│ id (PK)             │◄──────│ cipherId (PK)           │
│ userId              │       │ userId                  │
│ type                │       │ domainsJson             │
│ data (encrypted)    │       │ rpIdsJson               │
│ favorite            │       │ hasLogin                │
│ reprompt            │       │ hasPasskey              │
│ createdAt           │       └─────────────────────────┘
│ modifiedAt          │
└─────────────────────┘

┌─────────────────────────┐
│  PendingRebuildEntity   │
├─────────────────────────┤
│ cipherId (PK)           │
│ userId                  │
└─────────────────────────┘
```

---

## 1. CipherIndexEntity

索引条目，存储单条 LOGIN 类型凭据的非敏感匹配信息。

### Kotlin Definition

```kotlin
@Entity(
    tableName = "cipher_index",
    indices = [
        Index(value = ["userId"])
    ]
)
data class CipherIndexEntity(
    @PrimaryKey
    val cipherId: String,

    val userId: String,

    /** login.uris 经 UriMatcher 提取后的 baseDomain 列表，JSON 数组字符串 */
    val domainsJson: String,

    /** passkey.rpId 列表（已小写），JSON 数组字符串 */
    val rpIdsJson: String,

    /** 是否包含 login 数据 */
    val hasLogin: Boolean,

    /** 是否包含 passkey 数据 */
    val hasPasskey: Boolean
)
```

### 字段说明

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `cipherId` | String | `CipherEntity.id` | 外键关联；主键 |
| `userId` | String | `CipherEntity.userId` | 用户隔离；查询条件 |
| `domainsJson` | String | `login.uris` → `UriMatcher.getBaseDomain()` | JSON 序列化的 `List<String>`；可能为空数组 `"[]"` |
| `rpIdsJson` | String | `passkey.rpId` | JSON 序列化的 `List<String>`；单 rpId 也存为数组；小写化 |
| `hasLogin` | Boolean | `data.login != null` | 标记凭据是否含登录信息 |
| `hasPasskey` | Boolean | `data.passkey != null` | 标记凭据是否含 Passkey |

### 约束

- **FR-002 合规**: 不包含 `username`、`password`、`totp`、`notes`、`privateKey` 等敏感字段。
- `domainsJson` 与 `rpIdsJson` 使用项目已有 `Converters` 做 `List<String>` ↔ JSON 转换。
- 单条凭据可能同时 `hasLogin=true && hasPasskey=true`（如同时保存了密码和 Passkey 的条目）。

---

## 2. PendingRebuildEntity

锁定状态下收到同步事件时，记录待重建的 cipherId。解锁后仅对这些 cipherId 做增量重建。

### Kotlin Definition

```kotlin
@Entity(
    tableName = "pending_rebuild",
    indices = [
        Index(value = ["userId"])
    ]
)
data class PendingRebuildEntity(
    @PrimaryKey
    val cipherId: String,

    val userId: String
)
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `cipherId` | String | 主键；自动去重（同一 cipherId 多次入表仅保留一条） |
| `userId` | String | 用户隔离；登出时按 userId 清空 |

### 生命周期

1. **锁定 + 同步新增/更新** → `INSERT OR IGNORE` cipherId 到本表。
2. **锁定 + 同步删除** → 从索引表 `DELETE` 对应条目；同时从本表 `DELETE` 对应 cipherId（避免解锁后重建已删除的凭据）。
3. **解锁后** → 读取本表全部 cipherId，逐条解密并重建索引；完成后 `DELETE FROM pending_rebuild WHERE userId = ?`。
4. **登出** → `DELETE FROM pending_rebuild WHERE userId = ?`。

---

## 3. CipherIndexDao

Room DAO，提供索引表的 CRUD 和批量操作。

### Kotlin Definition

```kotlin
@Dao
interface CipherIndexDao {

    @Query("SELECT * FROM cipher_index WHERE userId = :userId")
    suspend fun getAll(userId: String): List<CipherIndexEntity>

    @Query("SELECT cipherId FROM cipher_index WHERE userId = :userId")
    suspend fun getAllCipherIds(userId: String): List<String>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: CipherIndexEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(entities: List<CipherIndexEntity>)

    @Query("DELETE FROM cipher_index WHERE cipherId = :cipherId")
    suspend fun deleteById(cipherId: String)

    @Query("DELETE FROM cipher_index WHERE userId = :userId")
    suspend fun deleteAllByUser(userId: String)
}
```

### 批量操作原子性

- `insertAll` 配合 `@Transaction`（Room 自动为 `@Insert` 多参数方法加事务）保证批量写入原子性。
- 重建流程在 `CipherIndexStore` 层用 `Mutex` 保护，防止重建与并发 `insert`/`delete` 冲突。

---

## 4. PendingRebuildDao

Room DAO，提供待重建集合的增删查。

### Kotlin Definition

```kotlin
@Dao
interface PendingRebuildDao {

    @Query("SELECT cipherId FROM pending_rebuild WHERE userId = :userId")
    suspend fun getAll(userId: String): List<String>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: PendingRebuildEntity)

    @Query("DELETE FROM pending_rebuild WHERE cipherId = :cipherId")
    suspend fun deleteById(cipherId: String)

    @Query("DELETE FROM pending_rebuild WHERE userId = :userId")
    suspend fun deleteAllByUser(userId: String)
}
```

---

## 5. AppDatabase 变更

```kotlin
@Database(
    entities = [
        CipherEntity::class,
        DomainAssocEntity::class,
        SyncQueueEntity::class,
        SettingEntity::class,
        RejectedSiteEntity::class,
        CipherIndexEntity::class,      // 新增
        PendingRebuildEntity::class     // 新增
    ],
    version = 3,                         // 从 2 升级
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    // ... 已有 DAO ...
    abstract fun cipherIndexDao(): CipherIndexDao      // 新增
    abstract fun pendingRebuildDao(): PendingRebuildDao // 新增
}
```

### Migration

```kotlin
val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS cipher_index (
                cipherId TEXT PRIMARY KEY NOT NULL,
                userId TEXT NOT NULL,
                domainsJson TEXT NOT NULL,
                rpIdsJson TEXT NOT NULL,
                hasLogin INTEGER NOT NULL,
                hasPasskey INTEGER NOT NULL
            )
        """)
        db.execSQL("CREATE INDEX IF NOT EXISTS index_cipher_index_userId ON cipher_index(userId)")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS pending_rebuild (
                cipherId TEXT PRIMARY KEY NOT NULL,
                userId TEXT NOT NULL
            )
        """)
        db.execSQL("CREATE INDEX IF NOT EXISTS index_pending_rebuild_userId ON pending_rebuild(userId)")
    }
}
```

---

## 6. 索引重建触发条件

| 场景 | 触发动作 | 范围 |
|------|---------|------|
| 解锁后 cipherId 集合不一致 | 后台修复（差异部分） | 差异 cipherId |
| 解锁后 pending_rebuild 非空 | 增量重建 pending 集合 | pending_rebuild 中的 cipherId |
| 用户编辑/保存凭据 | 立即 upsert 单条索引 | 该 cipherId |
| 用户删除凭据 | 立即 remove 单条索引 | 该 cipherId |
| 远程全量同步完成 | 重建整个索引 | 全部 cipher |
| 远程增量同步（新增/更新） | upsert 对应索引 | 变更 cipherId |
| 远程增量同步（删除） | remove 对应索引 | 该 cipherId |
| 用户登出 | 清空索引 + 清空 pending_rebuild | 该 userId 全部 |
| 升级首次运行（旧版无索引） | 下次解锁时按需重建 | 全部 cipher |

---

## 7. 筛选流程数据流

### 自动填充 Fill 路径

```
AutofillService.onFillRequest()
  └─► CipherIndexStore.filterByDomain(userId, sourceUri, domainAssocRules)
        └─► CipherIndexDao.getAll(userId)  →  List<CipherIndexEntity>
        └─► Kotlin 内存筛选：遍历 domains，用 UriMatcher.isMatch() 判断
        └─► 返回 candidateCipherIds: List<String>
  └─► VaultSession.decryptCipher(cipherId) 仅对 candidateCipherIds
  └─► UriMatcher.isMatch() 二次校验
  └─► 构建 FillResponse
```

### Passkey Get 路径

```
CredentialProviderService.populatePasskeyEntries()
  └─► CipherIndexStore.filterByRpId(userId, rpId)
        └─► CipherIndexDao.getAll(userId)  →  筛选 hasPasskey && rpIds.contains(rpId)
        └─► 返回 candidateCipherIds: List<String>
  └─► VaultSession.decryptCipher(cipherId) 仅对 candidateCipherIds
  └─► PasskeyMatcher.isRpIdMatch() + isCredentialAllowed() 二次校验
  └─► 构建 PublicKeyCredentialEntry
```

### Save 路径（查重）

```
SaveRequestHandler.handle()
  └─► CipherIndexStore.filterByDomain(userId, targetUri, domainAssocRules)
        └─► 返回 candidateCipherIds: List<String>
  └─► VaultSession.decryptCipher(cipherId) 仅对 candidateCipherIds
  └─► 比对 username/password 是否等价
```
