# Contract: CipherIndexStore

**Purpose**: 定义索引核心业务逻辑的公开接口，供 Autofill Service、Credential Provider、SyncManager、UI 层调用。

---

## Interface

```kotlin
interface CipherIndexStore {

    /**
     * 根据 URI 筛选匹配的凭据 ID 列表。
     *
     * @param userId 当前用户 ID
     * @param sourceUri 当前页面的 URI（网页或 Android App）
     * @param domainAssocRules DomainAssociation 规则列表
     * @return 候选 cipherId 列表（可能包含假阳性，调用方需二次校验）
     */
    suspend fun filterByDomain(
        userId: String,
        sourceUri: UriIdentifier,
        domainAssocRules: List<DomainAssocLite>
    ): List<String>

    /**
     * 根据 rpId 筛选 Passkey 凭据 ID 列表。
     *
     * @param userId 当前用户 ID
     * @param rpId 请求的 rpId（已小写化）
     * @return 候选 cipherId 列表（调用方需用 PasskeyMatcher 二次校验）
     */
    suspend fun filterByRpId(
        userId: String,
        rpId: String
    ): List<String>

    /**
     * 重建指定用户的全部索引。
     * 用于：全量同步后、首次解锁、索引缺失时。
     *
     * @param userId 当前用户 ID
     * @param ciphers 本地全部 LOGIN 类型凭据实体列表
     * @param decryptFn 解密函数（由 VaultSession 提供）
     */
    suspend fun rebuild(
        userId: String,
        ciphers: List<CipherEntity>,
        decryptFn: suspend (encryptedData: String) -> String?
    )

    /**
     * 增量重建指定 cipherId 的索引条目。
     * 用于：编辑保存后、增量同步后、解锁后处理 pending_rebuild。
     *
     * @param cipherId 凭据 ID
     * @param encryptedData 加密后的凭据 JSON 字符串
     * @param decryptFn 解密函数
     */
    suspend fun rebuildOne(
        cipherId: String,
        userId: String,
        encryptedData: String,
        decryptFn: suspend (encryptedData: String) -> String?
    )

    /**
     * 删除单条索引。
     * 用于：用户删除凭据、同步删除事件。
     */
    suspend fun removeOne(cipherId: String)

    /**
     * 清空指定用户的全部索引和 pending_rebuild。
     * 用于：用户登出、切换账号。
     */
    suspend fun clear(userId: String)

    /**
     * 检查索引 cipherId 集合与本地凭据 cipherId 集合是否一致。
     * 用于：解锁后的后台一致性修复。
     *
     * @return 不一致时返回需要修复的 cipherId 列表（需新增/重建的），null 表示一致
     */
    suspend fun checkConsistency(userId: String, localCipherIds: Set<String>): Set<String>?

    /**
     * 锁定状态下收到同步新增/更新事件时，将 cipherId 加入待重建集合。
     */
    suspend fun markPendingRebuild(cipherId: String, userId: String)

    /**
     * 锁定状态下收到同步删除事件时，从索引和待重建集合中同时移除。
     */
    suspend fun removeAndClearPending(cipherId: String, userId: String)

    /**
     * 解锁后处理 pending_rebuild 集合。
     * 读取集合、逐条重建、最后清空。
     *
     * @param decryptFn 解密函数
     * @param getCipherFn 根据 cipherId 获取 CipherEntity 的函数
     */
    suspend fun processPendingRebuild(
        userId: String,
        decryptFn: suspend (encryptedData: String) -> String?,
        getCipherFn: suspend (cipherId: String) -> CipherEntity?
    )
}
```

---

## 降级策略

当以下任一条件满足时，`CipherIndexStore` 的调用方应**绕过索引**，直接走现有全量解密逻辑：

1. `filterByDomain` / `filterByRpId` 抛出异常或返回空列表时，调用方可选择是否降级（视业务场景而定）。
2. 索引表为空（首次运行或数据被清理）→ 触发重建后当前请求可降级。
3. 索引 `cipherId` 集合与本地凭据 `cipherId` 集合不一致 → `checkConsistency` 返回非 null，触发后台修复后当前请求可降级。

降级行为由调用层（AutofillService / CredentialProviderService / SaveRequestHandler）决定，不在 `CipherIndexStore` 内部处理，以保持 Store 的职责单一。

---

## 线程安全保证

- `CipherIndexStore` 内部使用 `Mutex` 保护所有**写操作**（`rebuild`、`rebuildOne`、`removeOne`、`clear`、`markPendingRebuild`、`removeAndClearPending`、`processPendingRebuild`）。
- **读操作**（`filterByDomain`、`filterByRpId`、`checkConsistency`）**不加锁**，依赖 Room 的 Snapshot Isolation 保证读取安全。
- 所有公开方法均为 `suspend` 函数，在非 UI 线程（协程）中执行。
