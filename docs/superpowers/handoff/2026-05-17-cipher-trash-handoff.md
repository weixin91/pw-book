# 凭据回收站功能交接文档

> 用途:把当前会话的上下文移交到另一台电脑继续。
>
> 状态时间:2026-05-17
> 分支:`001-password-manager`
> 当前 HEAD:`64cc214`(本地领先 origin 11 个 commit)

---

## 1. 已完成内容

凭据回收站与恢复功能。设计与实施文档:
- 设计:`docs/superpowers/specs/2026-05-17-cipher-trash-restore-design.md`
- 计划:`docs/superpowers/plans/2026-05-17-cipher-trash-restore.md`(8 个 task)

### 1.1 后端新增 3 个 REST 接口

| 方法 | 路径 | 文件 | 行 |
|------|------|------|----|
| GET | `/api/ciphers/trash` | `apps/backend/src/ciphers/routes.ts` | 18-26 |
| POST | `/api/ciphers/:id/restore` | `apps/backend/src/ciphers/routes.ts` | 29-53 |
| DELETE | `/api/ciphers/:id/permanent` | `apps/backend/src/ciphers/routes.ts` | 55-77 |

关键安全约束:`/permanent` 接口的 `deleteMany` WHERE 含 `deletedAt: { not: null }`,**活跃凭据不可能被误硬删**。

测试:`apps/backend/tests/integration/trash.test.ts`,11 个 test case 覆盖跨租户隔离、401、404、deletedAt 过滤、modifiedAt 更新、倒序排序、活跃凭据拒绝硬删等。

### 1.2 Edge 扩展新增

| 文件 | 用途 |
|------|------|
| `apps/edge-extension/src/sync/trash-client.ts` | REST 客户端封装(list / restore / permanentDelete) |
| `apps/edge-extension/src/sync/trash-client.test.ts` | 6 个测试 |
| `apps/edge-extension/src/popup/components/TrashView.tsx` | 回收站视图组件 |
| `apps/edge-extension/src/popup/components/TrashView.test.tsx` | 11 个测试(列表 6 + 恢复 2 + 永久删除 3) |

修改:
- `apps/edge-extension/src/popup/PopupApp.tsx` — View 类型加 `"trash"`、`handleOpenTrash` 函数、`view === "trash"` 路由
- `apps/edge-extension/src/popup/components/VaultList.tsx` — Props 加 `onOpenTrash`,工具栏 flex 行追加"回收站"按钮

### 1.3 共享类型修复

- `packages/shared-types/src/cipher.ts` — `Cipher` interface 末尾加 `deletedAt?: string | null;`
  - 这是 Task 5 引入 TrashView 时缺漏的字段声明,在 Task 8 build 时暴露,作为额外的 fix commit 补齐

### 1.4 Android 端

**零改动**。`SyncManager` 既有的 `deletedCipherIds` 处理已覆盖恢复 / 永久删除场景,跨端同步通过现有 REST + WebSocket 链路自动生效。

---

## 2. Commit 清单(从主分支起算)

```
64cc214 fix(shared-types): Cipher 接口补充 deletedAt 字段以支持回收站
bad3981 feat(edge): VaultList 工具栏新增回收站入口,PopupApp 路由到 TrashView
287b713 feat(edge): TrashView 支持永久删除并二次确认
50cf6ee feat(edge): TrashView 支持恢复操作并触发同步
ec5ad53 feat(edge): 新增 TrashView 列表渲染与解密兜底
a414e10 feat(edge): 新增 TrashClient 封装回收站 REST 接口
b437503 feat(backend): 新增 DELETE /api/ciphers/:id/permanent 永久删除回收站凭据
c660012 feat(backend): 新增 POST /api/ciphers/:id/restore 恢复软删凭据
c9158b9 feat(backend): 新增 GET /api/ciphers/trash 列出软删除凭据
cde062a docs: 凭据回收站与恢复功能实施计划
9e5c2a1 docs: 凭据回收站与恢复功能设计文档
```

所有 commit 都经过 `subagent-driven-development` 两阶段评审(spec 合规 + 代码质量),并通过整体最终审查 ✅。

---

## 3. 回归测试状态

| 项目 | 结果 |
|------|------|
| `pnpm --filter backend test` | 23 / 23 通过(含 trash.test.ts 11 个) |
| `pnpm --filter @pwbook/shared-types build` | 通过 |
| `pnpm --filter edge-extension build` | 通过(vite + esbuild) |
| `pnpm --filter edge-extension test` | 48 通过 / 4 失败 |

⚠️ **edge 4 个失败属于 pre-existing**:`src/background/webauthn-handler.test.ts` 报 `ReferenceError: chrome is not defined`。**与本次回收站功能无关**,在 `64cc214` 之前的 HEAD 上同样存在,可追溯到更早的 commit。建议另起 task 修复。

---

## 4. 设计契约关键点

### 4.1 删除语义层次

- `POST /api/sync/push` 中 `type: "DELETE"` → 软删(`deletedAt = now`),**未改**
- `DELETE /api/ciphers/:id` → 旧硬删路由,**未改**(两端都不调,留待后续评估)
- `POST /api/ciphers/:id/restore` → 软删恢复(`deletedAt = null`)
- `DELETE /api/ciphers/:id/permanent` → 真正硬删,**仅限回收站中的记录**

### 4.2 同步链路

恢复 / 永久删除后,后端用 `broadcastSyncRequired(userId, deviceId)` 广播 SYNC_REQUIRED(排除发起设备),其他设备走既有 `/api/sync?since=...` 增量拉取:
- 恢复:`modifiedAt` 更新 → 该 cipher 重新出现在 `ciphers[]`
- 永久删除:既不在 `ciphers[]` 也不在 `deletedCipherIds`,客户端早就没缓存,**幂等**

### 4.3 Edge UI 行为

- 入口:`VaultList` 工具栏第三个等宽按钮"回收站"
- 列表:按 `deletedAt` 倒序展示,每行显示名称 / username / "删除于 yyyy-MM-dd HH:mm",末尾两个按钮 `[恢复]` `[永久删除]`
- 恢复 → API → 列表移除 → `chrome.runtime.sendMessage({ type: "TRIGGER_SYNC_NOW" })` → toast "已恢复"
- 永久删除 → `window.confirm` 含被删凭据 name 的二次确认 → API → 列表移除 → toast "已永久删除"
- 解密失败:行渲染 `解密失败 (前 8 位 id)`,两个按钮仍可用
- 拉取失败:整体错误占位 + 重试按钮
- 安全:解密结果仅在内存中,卸载丢弃,不写 storage;只显示名称 + username + 删除时间,**不显密码 / TOTP**

---

## 5. 在另一台电脑上继续

### 5.1 拿到代码

**方式 A — 远端拉取(推荐):**

当前本地领先 origin/001-password-manager 11 个 commit。在本机先 push:

```bash
git push origin 001-password-manager
```

在另一台电脑:

```bash
cd <pw-book 仓库>
git fetch origin
git checkout 001-password-manager
git pull
```

**方式 B — 文件同步(rsync / 云盘):**

把整个 `pw-book/` 目录直接复制到另一台机,跳过:
- `.git/` 中 `objects/pack` 太大?其实直接全 .git 同步最稳
- `node_modules/`、`dist/`、`apps/backend/data/`、`apps/backend/prisma/dev.db`、`apps/android/.gradle/`、`apps/android/build/`、`local.properties` 等大件/敏感件可不同步
- 同步后在新机跑 `pnpm install` + `pnpm --filter @pwbook/shared-types build`

### 5.2 环境验证

新机首次启动:

```bash
# 依赖
pnpm install

# 共享类型先构建(其他包依赖它的 dist)
pnpm --filter @pwbook/shared-types build

# 后端测试(首次跑需要先 migrate)
pnpm --filter backend test  # 期望 23 passed

# Edge build + test
pnpm --filter edge-extension build  # 期望 0 错误
pnpm --filter edge-extension test   # 期望 48 passed / 4 failed (pre-existing)
```

### 5.3 Claude Code session 接续

把本文件路径告诉新机的 Claude Code:

> 我在另一台电脑刚完成凭据回收站功能,详见 `docs/superpowers/handoff/2026-05-17-cipher-trash-handoff.md`。先读一下,确认仓库状态后继续。

记忆 `/home/weixin/.claude/projects/-home-weixin-code-pw-book/memory/` 不会自动跨机迁移,如果需要复用以下记忆,也手动复制过去:
- `feedback_continuous-execution.md` — 执行实施计划时默认连续推进
- `MEMORY.md` — 索引

---

## 6. 待办事项

### 6.1 必做

- [ ] **手测**(设计 §7.3):
  1. Edge 端创建 1 条凭据 → 删除 → 进回收站确认可见
  2. 点恢复 → 回 VaultList 看到该凭据 → Android 端等 WS 通知或手动同步,确认恢复
  3. 重新删除 → 进回收站 → 点永久删除 → confirm 确认 → 列表移除
  4. 重新打开回收站 → 该条目不再出现
  5. 后端 SQLite 查询 `SELECT id, deletedAt FROM ciphers WHERE id = '...'` 确认永久删除后记录消失
- [ ] **决定推送策略**:本地领先 origin 11 个 commit,什么时候 push?是否要走 PR review?

### 6.2 可做(本次不在范围)

- [ ] 修 `src/background/webauthn-handler.test.ts` 的 4 个 pre-existing 失败(`chrome is not defined`)
- [ ] 自动清理(N 天后硬删):用户已明确拒绝,如未来需要,可加 `BACKUP_*` 风格的 `TRASH_AUTO_CLEAN_DAYS` 配置 + 调度器
- [ ] "清空回收站"批量永久删除
- [ ] 回收站搜索 / 筛选
- [ ] Android 端回收站 UI(复用现有后端接口即可低成本补齐)
- [ ] 把 `DELETE /api/ciphers/:id` 改为软删(目前两端都不调它)

---

## 7. 关键文件速查

### 7.1 业务代码

- `apps/backend/src/ciphers/routes.ts:18-77` — 三个新接口
- `apps/backend/tests/integration/trash.test.ts` — 11 个集成测试
- `apps/edge-extension/src/sync/trash-client.ts` — REST 封装
- `apps/edge-extension/src/sync/trash-client.test.ts`
- `apps/edge-extension/src/popup/components/TrashView.tsx` — 回收站组件
- `apps/edge-extension/src/popup/components/TrashView.test.tsx`
- `apps/edge-extension/src/popup/PopupApp.tsx` — 路由
- `apps/edge-extension/src/popup/components/VaultList.tsx:359-389` — 工具栏按钮行
- `packages/shared-types/src/cipher.ts:83-93` — Cipher interface 含 deletedAt

### 7.2 上下文复用

- `apps/backend/src/websocket/server.ts:195` — `broadcastSyncRequired(userId, excludeDeviceId?)`
- `apps/backend/src/errors/handler.ts` — `ApiError("RESOURCE_NOT_FOUND", 404, msg)`
- `apps/backend/src/auth/jwt.ts` — `authenticate` preHandler;`request.user!.sub` = userId,`request.user!.deviceId` 可选
- `apps/edge-extension/src/crypto/crypto-service.ts` — `decryptCipherData(data, userKey)`,返回 JSON string
- `apps/edge-extension/src/platform/storage.ts` — `StorageService.{ getUserKey, getProfile, getServerUrl, getCiphers, setCiphers }`

---

## 8. 项目约定提醒

来自 `CLAUDE.md`:
- 文档 / 注释 / commit message 用中文
- commit 前缀:`feat(backend):` / `feat(edge):` / `feat(android):` / `fix:` / `docs:` ...
- **加密数据永远不出客户端解密态上后端**
- `Cipher.deletedAt` 作 tombstone,同步时下发删除标记
- 冲突:后端以 `modifiedAt` 做 last-write-wins
- **`git commit`:除非用户主动要求,不自动 commit**(但实施计划中明确的 commit 步骤是已授权动作)
- 不 push、不 `--amend`、不 `--no-verify`、不 `git add -A`
