# Tasks: Android 自动填充凭据索引优化

**Input**: Design documents from `/specs/002-android-autofill-index/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/cipher-index-store.md, quickstart.md

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for the new index module

- [x] T001 [P] Create package directory `domain/index/` and add `.gitkeep`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Create `data/local/entity/CipherIndexEntity.kt` per data-model.md
- [x] T003 [P] Create `data/local/entity/PendingRebuildEntity.kt` per data-model.md
- [x] T004 [P] Create `data/local/dao/CipherIndexDao.kt` per data-model.md
- [x] T005 [P] Create `data/local/dao/PendingRebuildDao.kt` per data-model.md
- [x] T006 [P] Create `domain/index/CipherIndexBuilder.kt` (decrypt → build index entry, handles failures gracefully)
- [x] T007 Update `data/local/AppDatabase.kt` (register CipherIndexEntity + PendingRebuildEntity, version 3, Migration 2→3)
- [x] T008 [P] Create `data/repository/CipherIndexRepository.kt` (wrap DAO operations, per-user scoping)
- [x] T009 Create `domain/index/CipherIndexStore.kt` (filterByDomain, filterByRpId, rebuild, rebuildOne, removeOne, clear, checkConsistency, markPendingRebuild, removeAndClearPending, processPendingRebuild)
- [x] T010 [P] Update `di/DatabaseModule.kt` (provide CipherIndexDao + PendingRebuildDao)
- [x] T011 [P] Create `di/IndexModule.kt` (provide CipherIndexStore + CipherIndexStore with Hilt)

**Checkpoint**: Foundation ready — `CipherIndexStore` can be injected and all DAO operations compile and run

---

## Phase 3: User Story 1 — 网页/应用自动填充快速响应 (Priority: P1) 🎯 MVP

**Goal**: 自动填充 Fill 路径和 Save 路径通过索引预筛选候选凭据，避免全量解密；编辑/删除凭据后索引即时更新，保证 US1 可用性

**Independent Test**: 创建 300 条凭据，打开网页触发自动填充，观察建议出现时间；对比关闭索引前后的解密次数和响应时间

### Implementation for User Story 1

- [x] T012 [P] [US1] Update `service/autofill/PwBookAutofillService.kt` — `onFillRequest` 先调用 `cipherIndexStore.filterByDomain` 获取候选 cipherId，再仅对候选凭据解密，并用 `UriMatcher` 二次校验；索引异常时降级为全量解密
- [x] T013 [P] [US1] Update `service/autofill/SaveRequestHandler.kt` — `handle` 中先调用 `cipherIndexStore.filterByDomain` 按目标 URL 预筛选，再仅对候选凭据解密查重
- [x] T014 [US1] Update `data/repository/CipherRepository.kt` — 保存/更新凭据后调用 `cipherIndexStore.rebuildOne` 即时更新索引；删除凭据后调用 `cipherIndexStore.removeOne` 即时移除索引条目

**Checkpoint**: US1 应可独立运行 — 自动填充建议响应快，保存查重不遍历全部凭据，编辑/删除后索引即时同步

---

## Phase 4: User Story 2 — Passkey 凭据快速定位 (Priority: P2)

**Goal**: Passkey GetCredential 请求通过 `hasPasskey=true` + `rpId` 索引预筛选，跳过非 Passkey 凭据的解密

**Independent Test**: 200 条普通凭据 + 5 条 Passkey 凭据，发起 Passkey GetCredential 请求，验证仅解密含匹配 rpId 的凭据，结果与未启用索引时一致

### Implementation for User Story 2

- [x] T015 [US2] Update `service/credential/PwBookCredentialProviderService.kt` — `populatePasskeyEntries` 先调用 `cipherIndexStore.filterByRpId` 预筛选，再仅对候选凭据解密，并用 `PasskeyMatcher.isRpIdMatch` + `isCredentialAllowed` 二次校验；索引异常时降级为全量解密

**Checkpoint**: US2 应可独立运行 — Passkey 登录弹窗仅展示匹配的 Passkey 凭据，不遍历全部 LOGIN 类型凭据

---

## Phase 5: User Story 3 — 索引随凭据变更保持一致 (Priority: P1)

**Goal**: 同步、解锁、登出等生命周期事件中索引始终保持与本地凭据集合完全一致；锁定状态下同步事件不绕过锁定，解锁后增量重建

**Independent Test**: 在每种变更入口（编辑、删除、全量同步、增量同步、登出、重新登录、锁定同步后解锁）操作前后对比索引 cipherId 集合与凭据 cipherId 集合，确保 100% 相等；模拟进程重启验证索引可恢复

### Implementation for User Story 3

- [x] T016 [P] [US3] Update `sync/SyncManager.kt` — 全量同步完成后调用 `cipherIndexStore.rebuild` 重建整个索引；增量同步的下发新增/更新事件调用 `cipherIndexStore.rebuildOne`，删除事件调用 `cipherIndexStore.removeOne`
- [x] T017 [US3] Update `sync/SyncManager.kt` — 锁定状态下收到同步事件时，新增/更新事件调用 `cipherIndexStore.markPendingRebuild`，删除事件调用 `cipherIndexStore.removeAndClearPending`（不解密、不读取 userKey）
- [x] T018 [P] [US3] Update `domain/usecase/UnlockVaultUseCase.kt` — 解锁完成后调用 `cipherIndexStore.checkConsistency` 检查索引 cipherId 集合与本地凭据集合是否一致；不一致则后台修复差异部分；随后调用 `cipherIndexStore.processPendingRebuild` 处理锁定期间积累的待重建集合
- [x] T019 [US3] Update `data/repository/CipherIndexRepository.kt` / existing logout flow — 登出时调用 `cipherIndexStore.clear(userId)` 清空索引和 pending_rebuild

**Checkpoint**: US3 应可独立验证 — 所有变更入口操作后索引与凭据集合一致；锁定同步不解密；解锁后自动修复差异；登出无残留数据

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 性能观测、边界处理、回归验证

- [x] T020 [P] Add Timber performance timing logs in `domain/index/CipherIndexStore.kt` (filter/rebuild/consistency check durations)
- [x] T021 [P] Add single-cipher failure handling in `domain/index/CipherIndexBuilder.kt` and `domain/index/CipherIndexStore.kt` (skip + log, never throw to caller)
- [ ] T022 [P] Run manual validation per `quickstart.md` (300 cipher fill performance, consistency after sync, process recovery, locked-state sync)
- [ ] T023 [P] Run existing instrumented test suite (`./gradlew :app:connectedDebugAndroidTest`) to confirm autofill / passkey / vault CRUD / sync 无回归失败

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **User Stories (Phase 3–5)**: All depend on Foundational phase completion
  - US1 (Phase 3) 和 US2 (Phase 4) 可在 Foundational 完成后并行开发
  - US3 (Phase 5) 也可与 US1/US2 并行（修改不同文件）
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — No dependencies on other stories
- **US2 (P2)**: Can start after Foundational — No dependencies on US1 (filterByRpId 是 Store 的独立方法)
- **US3 (P1)**: Can start after Foundational — 依赖 Store 已完整实现；可与 US1/US2 并行

### Within Each User Story

- T012 / T013 / T014 (US1) 可并行：修改三个不同文件
- T015 (US2) 单独一个任务
- T016 / T018 (US3) 可并行：SyncManager 与 UnlockVaultUseCase 是不同文件
- T017 与 T016 串行：都修改 SyncManager.kt
- T019 可并行：登出清理逻辑与 T016/T17/T18 文件不冲突

### Parallel Opportunities

- Phase 2 中 T002–T006、T008、T010–T011 可并行（不同文件，无运行期依赖）
- Phase 3 中 T012–T014 可并行
- Phase 5 中 T016 + T018 + T019 可并行
- Phase 6 中 T020–T023 可并行

---

## Parallel Example: Phase 2 Foundational

```bash
# 实体 + Builder 可并行：
Task: "Create data/local/entity/CipherIndexEntity.kt"
Task: "Create data/local/entity/PendingRebuildEntity.kt"
Task: "Create domain/index/CipherIndexBuilder.kt"

# DAO + Repository + Module 可并行：
Task: "Create data/local/dao/CipherIndexDao.kt"
Task: "Create data/local/dao/PendingRebuildDao.kt"
Task: "Create data/repository/CipherIndexRepository.kt"
Task: "Update di/DatabaseModule.kt"
Task: "Create di/IndexModule.kt"
```

---

## Implementation Strategy

### MVP First (US1 + Foundational)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational（最关键，阻塞所有故事）
3. Complete Phase 3: US1（自动填充 Fill + Save + 编辑删除即时更新索引）
4. **STOP and VALIDATE**: 测试 300 条凭据下的自动填充性能和一致性
5. 此时 US1 已可独立交付价值

### Incremental Delivery

1. Setup + Foundational → 基础就绪
2. US1 → 自动填充索引生效 → 验证 → Demo（MVP）
3. US2 → Passkey 索引生效 → 验证 → Demo
4. US3 → 全生命周期一致性保障 → 验证 → Demo
5. Polish → 性能观测、回归测试、边界处理
6. 每个阶段不破坏之前阶段的功能

### Parallel Team Strategy

多开发者并行时：

1. 共同完成 Phase 2 Foundational
2. 完成后分头并行：
   - 开发者 A: Phase 3 US1（AutofillService + SaveRequestHandler + CipherRepository 联动）
   - 开发者 B: Phase 4 US2（CredentialProviderService Passkey 预筛选）
   - 开发者 C: Phase 5 US3（SyncManager 同步联动 + UnlockVaultUseCase 解锁修复）
3. 最后共同完成 Phase 6 Polish

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- 每个用户故事应可独立实现和测试
- 单条凭据索引建立失败时必须跳过并记录日志，不得中断整体流程（FR-018）
- 索引相关操作必须在非 UI 线程执行（FR-019）；所有 `CipherIndexStore` 方法均为 `suspend`
- 登出清理索引的具体调用位置需根据现有 logout 实现确定；若不存在集中 logout use case，则在 `CipherIndexRepository` 中暴露 `clearOnLogout` 方法供调用方使用
- Commit after each phase or logical group
- Stop at any checkpoint to validate story independently
