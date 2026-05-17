# 凭据回收站与恢复功能设计文档

**日期**: 2026-05-17
**状态**: 待审阅
**相关需求**: 当前凭据删除为软删除,增加用户可见的回收站视图与恢复 / 永久删除能力。功能仅在 Edge 扩展端实现,Android App 不动。

---

## 1. 设计决策摘要

- **目标端**: 仅 Edge 扩展;Android 不增加 UI
- **保留期限**: 不自动清理(无定时任务),用户手动永久删除才真正硬删
- **永久删除粒度**: 仅逐条永久删除,无"清空回收站"批量操作
- **入口形态**: `VaultList` 工具栏新增垃圾桶按钮 → 独立的 `TrashView` 视图
- **数据加载**: 按需拉取(`GET /api/ciphers/trash`),不进入本地 storage 缓存
- **同步链路**: 完全复用现有 `/api/sync` 增量同步 + WebSocket `SYNC_REQUIRED` 广播,不修改同步协议

**前置事实**: `Cipher.deletedAt` 字段早已存在,`POST /api/sync/push` 中 `type: "DELETE"` 一直执行软删,因此历史所有"已删除"凭据实际仍在数据库中,只是从未对客户端开放查询。本次主要工作是把这些数据通过新 REST 接口暴露,加上 Edge 端的回收站视图。

---

## 2. 数据模型 / Schema

**不动**。`Cipher.deletedAt: DateTime?` 与 `@@index([userId, deletedAt])` 已具备所有需要的能力。

```prisma
// apps/backend/prisma/schema.prisma 现状,本次设计不修改
model Cipher {
  id         String    @id @default(uuid())
  userId     String
  type       Int
  data       String
  favorite   Boolean   @default(false)
  reprompt   Int       @default(0)
  createdAt  DateTime  @default(now())
  modifiedAt DateTime  @updatedAt
  deletedAt  DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, modifiedAt])
  @@index([userId, deletedAt])
  @@map("ciphers")
}
```

---

## 3. 后端 API 设计

新增 3 个 REST endpoint,挂在 `apps/backend/src/ciphers/routes.ts`,统一加 `authenticate` preHandler。

### 3.1 `GET /api/ciphers/trash`

列出当前用户所有软删除凭据,按 `deletedAt` 倒序。

```ts
app.get("/trash", { preHandler: [authenticate] }, async (request, reply) => {
  const userId = request.user!.sub;
  const ciphers = await prisma.cipher.findMany({
    where: { userId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
  return reply.send(ciphers);
});
```

返回字段结构与现有 `GET /api/ciphers/:id` 一致:`id, type, data, favorite, reprompt, createdAt, modifiedAt, deletedAt`。前端使用现有 master key 解密 `data` 字段,仅在内存中展示。

### 3.2 `POST /api/ciphers/:id/restore`

把指定凭据从回收站恢复为活跃状态。

```ts
app.post<{ Params: { id: string } }>(
  "/:id/restore",
  { preHandler: [authenticate] },
  async (request, reply) => {
    const userId = request.user!.sub;
    const deviceId = request.user!.deviceId; // 可选,用于广播去重
    const { id } = request.params;

    const result = await prisma.cipher.updateMany({
      where: { id, userId, deletedAt: { not: null } },
      data: { deletedAt: null, modifiedAt: new Date() },
    });
    if (result.count === 0) {
      throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在或未在回收站中");
    }

    if (deviceId) broadcastSyncRequired(userId, deviceId);
    const cipher = await prisma.cipher.findUnique({ where: { id } });
    return reply.send(cipher);
  }
);
```

- `where` 子句锁住 `deletedAt: { not: null }`,意外重复恢复 / 跨租户 / 活跃凭据全部返回 404
- `modifiedAt = now` 让其他设备下次增量 sync 时拿到这条记录(`deletedAt = null`)
- 广播 `SYNC_REQUIRED` 通知本用户其他设备

### 3.3 `DELETE /api/ciphers/:id/permanent`

把指定凭据从回收站永久删除(真正的硬删)。

```ts
app.delete<{ Params: { id: string } }>(
  "/:id/permanent",
  { preHandler: [authenticate] },
  async (request, reply) => {
    const userId = request.user!.sub;
    const deviceId = request.user!.deviceId;
    const { id } = request.params;

    const result = await prisma.cipher.deleteMany({
      where: { id, userId, deletedAt: { not: null } },
    });
    if (result.count === 0) {
      throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在或未在回收站中");
    }

    if (deviceId) broadcastSyncRequired(userId, deviceId);
    return reply.status(204).send();
  }
);
```

- **强制 `deletedAt != null`**,防止误硬删活跃凭据(关键安全约束)
- 永久删除后该 id 不会再出现在任何 sync 响应中,客户端本来就已经把它从活跃缓存中清掉了,无需特殊处理

### 3.4 既有路由不动

- `DELETE /api/ciphers/:id` 维持现状(硬删)。当前 Edge 客户端不调用此接口,Android 端通过 sync push 通道删除,因此该路由的硬删行为不会被两个客户端触发到。是否调整其语义为软删,留待后续单独评估,不在本次范围内。
- `POST /api/sync/push` 中 `type: "DELETE"` 的软删行为不变。
- `GET /api/sync` 仍只下发 `deletedCipherIds: string[]`,不夹带已删除凭据的加密 blob。

---

## 4. 同步与跨设备行为

### 4.1 恢复操作的传播路径

| 步骤 | 行为 |
|------|------|
| Edge 调 `POST /api/ciphers/:id/restore` | 服务端 `deletedAt: null, modifiedAt: now` |
| 服务端广播 `SYNC_REQUIRED` | 排除 originatingDeviceId |
| 其他设备收到 WS 通知 | 触发 `GET /api/sync?since=...` |
| 增量同步 | 该 cipher 因 `modifiedAt > since` 出现在 `ciphers[]`(`deletedAt = null`) |
| 客户端缓存更新 | 自动加回本地活跃凭据列表;Android `SyncManager` 既有逻辑无需改动 |

### 4.2 永久删除操作的传播路径

| 步骤 | 行为 |
|------|------|
| Edge 调 `DELETE /api/ciphers/:id/permanent` | 服务端 `prisma.cipher.delete()` |
| 服务端广播 `SYNC_REQUIRED` | 排除 originatingDeviceId |
| 其他设备拉取增量 sync | 该 id 既不在 `ciphers[]` 也不在 `deletedCipherIds`(记录已物理删除) |
| 客户端缓存 | 本就早已没有此 id,**静默幂等** |

### 4.3 并发与竞态

- 同设备双击恢复:第一次成功,第二次后端返回 404,UI 刷新即可
- A 设备永久删除 vs B 设备恢复:谁先到服务端谁赢,败者拿到 404,最终一致
- 所有新接口使用 `updateMany / deleteMany` 单语句原子写,无 TOCTOU

### 4.4 checksum

- `calculateSyncChecksum` 只对 `deletedAt = null` 的活跃凭据计算
- 恢复:活跃集变化 → checksum 变化 → 客户端正常触发增量拉取
- 永久删除:不影响活跃集 → checksum 不变,无副作用

### 4.5 deviceId 处理

- 三个新接口对 `deviceId` **不强制**
- 有 `deviceId` 时作为 `originatingDeviceId` 传入广播,避免操作设备自我通知
- 旧的无 deviceId token 仍可调用,只是会多收一次 WS 通知,无功能影响

---

## 5. Edge 扩展 UI 设计

### 5.1 文件清单

| 操作 | 路径 |
|------|------|
| 新增 | `apps/edge-extension/src/sync/trash-client.ts` |
| 新增 | `apps/edge-extension/src/popup/components/TrashView.tsx` |
| 修改 | `apps/edge-extension/src/popup/PopupApp.tsx` |
| 修改 | `apps/edge-extension/src/popup/components/VaultList.tsx` |

### 5.2 `trash-client.ts`(新)

与 `cookie-sync-client.ts` 同级风格,小而专。从 `StorageService` 取 `serverUrl + accessToken`,封装三个调用:

```ts
import type { Cipher } from "@pwbook/shared-types";

export class TrashClient {
  async list(): Promise<Cipher[]>;                  // GET /api/ciphers/trash
  async restore(id: string): Promise<Cipher>;       // POST /api/ciphers/:id/restore
  async permanentDelete(id: string): Promise<void>; // DELETE /api/ciphers/:id/permanent
}
```

- 非 2xx 抛 `Error`,沿用后端 message
- 401 沿用 sync-client 既有"令牌过期 → 跳锁屏"处理路径

### 5.3 `TrashView.tsx`(新)

模仿 `VaultList` 的解密模式(动态导入 `decryptCipherData`,失败兜底"解密失败"):

```ts
type TrashItem = {
  cipher: Cipher;       // 含 deletedAt
  name: string;         // 解出来的名称,解密失败时显示"解密失败"
  username: string;     // login.username;笔记类型为空字符串
  deletedAt: string;
};
```

界面要素:
- 顶部: 返回箭头 + 标题"回收站(N)"
- 列表项: 图标 + 名称 / username + "删除于 yyyy-MM-dd HH:mm" + 两个按钮 [恢复] [永久删除]
- 空态: "回收站为空"占位
- 列表整体加载失败: 错误提示 + 重试按钮
- 每条记录独立 loading / error 状态,单条失败不影响其他

交互:
- 点 **恢复** → `trashClient.restore(id)` → 从本地列表移除该项 → 触发 `chrome.runtime.sendMessage({ type: "TRIGGER_SYNC_NOW" })` 让 VaultList 立即可见 → Toast "已恢复"
- 点 **永久删除** → `window.confirm("确定永久删除此凭据吗?此操作不可恢复。")` → `trashClient.permanentDelete(id)` → 从本地列表移除 → Toast "已永久删除"
- 解密失败的条目: 仍渲染恢复 / 永久删除两个按钮,让用户能管理损坏数据

安全:
- 解密结果仅在组件内存中,卸载即丢弃,不写 `chrome.storage`
- 不显示密码 / TOTP secret 等敏感字段,只显示名称 + username + 删除时间
- 自动锁定计时器(background `lock-timer.ts`)照常生效

### 5.4 `PopupApp.tsx` 修改

```diff
-type View = "unlock" | "vault" | "add" | "edit" | "noteAdd" | "noteEdit" | "generator" | "cookieSync";
+type View = "unlock" | "vault" | "add" | "edit" | "noteAdd" | "noteEdit" | "generator" | "cookieSync" | "trash";

+function handleOpenTrash() { setView("trash"); }
```

- `VaultList` 多传一个 `onOpenTrash` prop
- 新增 `view === "trash"` 分支,渲染 `<TrashView onBack={handleBackToVault} />`

### 5.5 `VaultList.tsx` 修改

工具栏(同步按钮 / 添加按钮所在区域)追加一个垃圾桶图标按钮:
- `title="回收站"`
- 点击 → `props.onOpenTrash()`
- 布局靠右对齐,不打扰现有元素

---

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 列表加载失败 (网络/500) | 显示错误占位 + 重试按钮 |
| 单条恢复 / 永久删除失败 | 仅该条标记错误,允许重试,其他不受影响 |
| 后端返回 404 (已并发处理) | 提示"凭据已不存在" + 刷新列表 |
| 401 token 过期 | 跳转锁屏,沿用 sync-client 现有处理 |
| 解密失败 | 列表项显示"解密失败 (id 前 8 位)",恢复 / 永久删除按钮仍可用 |
| 离线状态 | TrashView 仅在线;`list()` 失败显示重试按钮,不进入 PendingChangesQueue |
| 跨租户访问 | 后端返回 404,不暴露存在性 |

---

## 7. 测试策略

### 7.1 后端 vitest

新增 `apps/backend/test/trash.test.ts` 或合并到 `ciphers.test.ts`:

1. `GET /api/ciphers/trash` 仅返回当前用户、`deletedAt != null` 的凭据,按 deletedAt 倒序
2. `POST /api/ciphers/:id/restore` 把 `deletedAt` 置 null、`modifiedAt` 更新,该 cipher 在 `GET /api/sync` 中出现于 `ciphers[]`
3. restore 一个活跃凭据(`deletedAt = null`)→ 404
4. `DELETE /api/ciphers/:id/permanent` 真正硬删,后续 `GET /trash` 不再出现
5. permanent delete 一个活跃凭据 → 404 (**关键安全断言**)
6. 跨租户操作三接口 → 全部 404
7. 三接口不带 token → 401

### 7.2 Edge vitest

- `trash-client.test.ts`: mock fetch 校验 method/path/headers;非 2xx 抛错
- `TrashView.test.tsx`(参考已有 `NoteForm.test.tsx` 风格):
  - 列表渲染: 成功 / 空态 / 加载失败重试
  - 解密失败兜底显示"解密失败",按钮仍可点
  - 点恢复 → 调用 `restore` → 触发 sync 消息
  - 点永久删除 → 弹出 confirm → 用户确认调用 `permanentDelete`,取消则不调用

### 7.3 手测脚本

- 在 Edge 端创建一条凭据 → 删除 → 进入回收站确认可见
- 点恢复 → 回到 VaultList 可见该凭据 → 在 Android 端等待 WS 通知或手动同步,确认凭据恢复
- 在 Edge 端进入回收站 → 永久删除 → 后端 DB 中查询确认记录不存在 → 其他设备不出现异常

---

## 8. 改动范围汇总

| 模块 | 改动 |
|------|------|
| `packages/shared-types` | **无需改动**(`SyncResponse.deletedCipherIds` 已存在) |
| `apps/backend/prisma` | **无需改动**(`Cipher.deletedAt` 与索引已具备) |
| `apps/backend/src/ciphers/routes.ts` | 新增 3 个 endpoint: GET `/trash`、POST `/:id/restore`、DELETE `/:id/permanent` |
| `apps/backend/test/` | 新增回收站接口测试 |
| `apps/edge-extension/src/sync/` | 新增 `trash-client.ts` |
| `apps/edge-extension/src/popup/components/` | 新增 `TrashView.tsx` |
| `apps/edge-extension/src/popup/PopupApp.tsx` | 增加 `"trash"` view 路由 |
| `apps/edge-extension/src/popup/components/VaultList.tsx` | 工具栏增加回收站按钮 |
| `apps/android` | **无需改动**(`SyncManager` 既有 `deletedCipherIds` 处理已覆盖恢复/永久删除场景) |

---

## 9. 未来扩展(明确不做在本次范围)

以下功能本次不实现:

- 自动清理(N 天后硬删):用户已明确拒绝,如未来需要,可加 `BACKUP_*` 风格的 `TRASH_AUTO_CLEAN_DAYS` 配置 + 调度器
- "清空回收站"批量永久删除:用户选了仅逐条;如未来需要,加一个 `DELETE /api/ciphers/trash` 接口即可
- 回收站搜索 / 筛选:第一版列表足够,后续按用户反馈再加
- Android 端回收站 UI:复用现有后端接口即可低成本补齐,本次不做
- 把 `DELETE /api/ciphers/:id` 改为软删:目前两端都不调它,暂保留硬删现状,待后续评估
