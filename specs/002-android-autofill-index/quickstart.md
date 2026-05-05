# Quickstart: Android 自动填充凭据索引优化

**Feature**: Android 自动填充凭据索引优化  
**Date**: 2026-05-05

---

## 开发环境

- **Android Studio**: Ladybug Feature Drop (2024.2.2) 或更新版本
- **JDK**: 17
- **Kotlin**: 2.1
- **minSdk**: 34, **compileSdk**: 35

---

## 新增文件清单

按依赖顺序实现：

| # | 文件路径 | 说明 |
|---|---------|------|
| 1 | `data/local/entity/CipherIndexEntity.kt` | Room 实体：索引条目 |
| 2 | `data/local/entity/PendingRebuildEntity.kt` | Room 实体：待重建集合 |
| 3 | `data/local/dao/CipherIndexDao.kt` | DAO：索引表操作 |
| 4 | `data/local/dao/PendingRebuildDao.kt` | DAO：待重建集合操作 |
| 5 | `data/local/AppDatabase.kt` | 注册新实体、版本升级到 3 |
| 6 | `data/repository/CipherIndexRepository.kt` | Repository：封装 DAO，供 Store 使用 |
| 7 | `domain/index/CipherIndexBuilder.kt` | 从解密后的 JSON 构建 `CipherIndexEntity` |
| 8 | `domain/index/CipherIndexStore.kt` | 核心业务逻辑：筛选、重建、一致性检查 |
| 9 | `di/DatabaseModule.kt` | 提供新的 DAO 和 Repository 的 Hilt 绑定 |
| 10 | `di/IndexModule.kt` | 提供 `CipherIndexStore` 的 Hilt 绑定 |

---

## 修改现有文件清单

| # | 文件路径 | 修改内容 |
|---|---------|---------|
| 1 | `service/autofill/PwBookAutofillService.kt` | `onFillRequest` 中先调 `cipherIndexStore.filterByDomain`，再仅对候选 cipherId 解密 |
| 2 | `service/autofill/SaveRequestHandler.kt` | `handle` 中先调 `cipherIndexStore.filterByDomain` 做查重预筛选 |
| 3 | `service/credential/PwBookCredentialProviderService.kt` | `populatePasskeyEntries` 中先调 `cipherIndexStore.filterByRpId` |
| 4 | `sync/SyncManager.kt` | 全量/增量同步完成后触发索引重建/更新 |
| 5 | `data/repository/CipherRepository.kt` | 编辑保存、删除凭据后联动更新索引 |
| 6 | `domain/usecase/UnlockVaultUseCase.kt` | 解锁完成后触发 `cipherIndexStore.checkConsistency` + `processPendingRebuild` |

---

## 运行与测试

### 单元测试

```bash
# 运行 domain 层单元测试（筛选逻辑、Builder 逻辑）
./gradlew :app:testDebugUnitTest
```

### Instrumented 测试

```bash
# 运行 Room DAO 测试
./gradlew :app:connectedDebugAndroidTest
```

### 手动验证场景

1. **填充性能**: 创建 300 条凭据，打开网页触发自动填充，观察建议卡片出现时间。
2. **一致性**: 编辑、删除、同步后，对比索引表与凭据表 cipherId 集合。
3. **锁定同步**: 锁定后触发远程同步（可 mock），解锁后验证 pending_rebuild 被正确处理。
4. **进程回收**: 杀掉应用进程后重新触发自动填充，验证索引仍可从 Room 恢复。
5. **降级**: 清空 `cipher_index` 表后触发自动填充，验证功能仍正常（走全量解密）。

---

## 调试技巧

- **查看索引表**: Android Studio Database Inspector → `pwbook.db` → `cipher_index` 表。
- **查看 pending_rebuild**: Database Inspector → `pending_rebuild` 表。
- **日志标记**: 搜索 `CipherIndex` 相关 Timber 日志，关注 `rebuild`、`filterByDomain`、`filterByRpId`、`checkConsistency` 调用耗时。
- **性能计时**: 在 `PwBookAutofillService.onFillRequest` 中记录 `filterByDomain` + `decrypt` 总耗时，与未启用索引时对比。
