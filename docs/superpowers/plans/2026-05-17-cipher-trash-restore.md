# 凭据回收站与恢复功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Edge 扩展端新增"回收站"视图,让用户可以查看、恢复、永久删除软删除的凭据。

**Architecture:** 后端基于已有的 `Cipher.deletedAt` 字段新增 3 个 REST 接口(列表 / 恢复 / 永久删除),复用现有同步广播链路;Edge 端新增 `trash-client.ts` + `TrashView.tsx`,通过 `PopupApp` 的 view 路由切入,在 `VaultList` 工具栏增加入口按钮。Android 端无改动。

**Tech Stack:** Backend Fastify + Prisma + vitest;Edge React 18 + Vite + vitest + @testing-library/react;参考 spec `docs/superpowers/specs/2026-05-17-cipher-trash-restore-design.md`。

**已存在前置条件**(无需新增):
- `Cipher.deletedAt: DateTime?` 与 `@@index([userId, deletedAt])` 已在 `apps/backend/prisma/schema.prisma`
- `broadcastSyncRequired(userId, excludeDeviceId?)` 在 `apps/backend/src/websocket/server.ts:195`
- `ApiError("RESOURCE_NOT_FOUND", 404, ...)` 在 `apps/backend/src/errors/handler.ts`
- `authenticate` preHandler 在 `apps/backend/src/auth/jwt.ts:48`,`request.user!.sub` 给 userId,`request.user!.deviceId` 给 deviceId
- 前端 `StorageService.getServerUrl()` / `getProfile()`(取 token)在 `apps/edge-extension/src/platform/storage.ts`
- 前端 `decryptCipherData(data, userKey)` 在 `apps/edge-extension/src/crypto/crypto-service.ts`

---

## 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| Modify | `apps/backend/src/ciphers/routes.ts` | 新增 3 个 endpoint |
| Create | `apps/backend/tests/integration/trash.test.ts` | 后端接口集成测试 |
| Create | `apps/edge-extension/src/sync/trash-client.ts` | 封装 trash REST 调用 |
| Create | `apps/edge-extension/src/sync/trash-client.test.ts` | client 单元测试 |
| Create | `apps/edge-extension/src/popup/components/TrashView.tsx` | 回收站视图组件 |
| Create | `apps/edge-extension/src/popup/components/TrashView.test.tsx` | 组件测试 |
| Modify | `apps/edge-extension/src/popup/PopupApp.tsx` | 新增 `"trash"` view 路由 |
| Modify | `apps/edge-extension/src/popup/components/VaultList.tsx` | 工具栏添加回收站按钮 |

---

## Task 1: 后端 GET /api/ciphers/trash

**Files:**
- Modify: `apps/backend/src/ciphers/routes.ts`
- Test: `apps/backend/tests/integration/trash.test.ts`

- [ ] **Step 1: 写失败的测试(新建测试文件)**

新建文件 `apps/backend/tests/integration/trash.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { authRoutes } from "../../src/auth/routes.js";
import { cipherRoutes } from "../../src/ciphers/routes.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(cipherRoutes, { prefix: "/api/ciphers" });
  return app;
}

async function registerAndLogin(app: Awaited<ReturnType<typeof buildApp>>, suffix: string) {
  const email = `trash-test-${Date.now()}-${suffix}@example.com`;
  await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      masterPasswordHash: "hash123",
      protectedKey: "key123",
      publicKey: "pub123",
      encryptedPrivateKey: "priv123",
      kdfType: "PBKDF2_SHA256",
      kdfIterations: 600000,
      recoveryKeyHash: "rec123",
      encryptedRecoveryKey: "recEnc123",
    },
  });
  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email,
      masterPasswordHash: "hash123",
      deviceId: `device-${suffix}`,
      deviceType: "BROWSER",
      deviceName: "Edge",
    },
  });
  const body = JSON.parse(loginRes.payload);
  return { token: body.token as string, userId: body.id as string };
}

async function createCipher(token: string, app: Awaited<ReturnType<typeof buildApp>>, data: string) {
  const id = crypto.randomUUID();
  await app.inject({
    method: "POST",
    url: "/api/ciphers",
    headers: { authorization: `Bearer ${token}` },
    payload: { id, type: 1, data },
  });
  return id;
}

describe("Trash API - GET /trash", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    ({ token, userId } = await registerAndLogin(app, "list"));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("仅返回当前用户软删除的凭据,按 deletedAt 倒序", async () => {
    const activeId = await createCipher(token, app, "active-data");
    const trashedOldId = await createCipher(token, app, "trashed-old");
    const trashedNewId = await createCipher(token, app, "trashed-new");

    await prisma.cipher.update({
      where: { id: trashedOldId },
      data: { deletedAt: new Date("2026-01-01T00:00:00Z") },
    });
    await prisma.cipher.update({
      where: { id: trashedNewId },
      data: { deletedAt: new Date("2026-05-01T00:00:00Z") },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/ciphers/trash",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload) as Array<{ id: string; deletedAt: string }>;
    const ids = body.map((c) => c.id);
    expect(ids).not.toContain(activeId);
    expect(ids).toContain(trashedOldId);
    expect(ids).toContain(trashedNewId);
    // 倒序:newer 在前
    expect(ids.indexOf(trashedNewId)).toBeLessThan(ids.indexOf(trashedOldId));
  });

  it("不带 token 返回 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ciphers/trash",
    });
    expect(res.statusCode).toBe(401);
  });

  it("跨用户隔离:其他用户的软删凭据不会返回", async () => {
    const other = await registerAndLogin(app, "list-other");
    const otherTrashedId = await createCipher(other.token, app, "other-trashed");
    await prisma.cipher.update({
      where: { id: otherTrashedId },
      data: { deletedAt: new Date() },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/ciphers/trash",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(res.payload) as Array<{ id: string }>;
    const ids = body.map((c) => c.id);
    expect(ids).not.toContain(otherTrashedId);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter backend test -- trash`
Expected: 测试用例报 `Expected 200, got 404`(因为路由未实现)。

- [ ] **Step 3: 实现路由**

修改 `apps/backend/src/ciphers/routes.ts`,在 `export async function cipherRoutes` 函数体的**最前面**(在已有 `app.post("/")` 之前)插入新的路由,以避免 Fastify 把 `GET /:id` 误匹配到 `/trash`:

```ts
  // 列出当前用户软删除的凭据(回收站)
  app.get("/trash", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;
    const ciphers = await prisma.cipher.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
    });
    return reply.send(ciphers);
  });
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter backend test -- trash`
Expected: 3 个测试用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ciphers/routes.ts apps/backend/tests/integration/trash.test.ts
git commit -m "feat(backend): 新增 GET /api/ciphers/trash 列出软删除凭据"
```

---

## Task 2: 后端 POST /api/ciphers/:id/restore

**Files:**
- Modify: `apps/backend/src/ciphers/routes.ts`
- Modify: `apps/backend/tests/integration/trash.test.ts`(追加 describe 块)

- [ ] **Step 1: 写失败的测试**

在 `apps/backend/tests/integration/trash.test.ts` 末尾追加新的 describe:

```ts
describe("Trash API - POST /:id/restore", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    ({ token, userId } = await registerAndLogin(app, "restore"));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("把 deletedAt 置 null 并更新 modifiedAt,返回 200", async () => {
    const id = await createCipher(token, app, "to-restore");
    await prisma.cipher.update({
      where: { id },
      data: { deletedAt: new Date("2026-01-01T00:00:00Z"), modifiedAt: new Date("2026-01-01T00:00:00Z") },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/ciphers/${id}/restore`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload) as { id: string; deletedAt: string | null; modifiedAt: string };
    expect(body.id).toBe(id);
    expect(body.deletedAt).toBeNull();
    expect(new Date(body.modifiedAt).getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
  });

  it("恢复活跃凭据(未软删)返回 404", async () => {
    const id = await createCipher(token, app, "active-not-trashed");
    const res = await app.inject({
      method: "POST",
      url: `/api/ciphers/${id}/restore`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("恢复不存在的 id 返回 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/ciphers/${crypto.randomUUID()}/restore`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("跨租户:用户 A 不能恢复用户 B 的凭据", async () => {
    const other = await registerAndLogin(app, "restore-other");
    const otherId = await createCipher(other.token, app, "other-cipher");
    await prisma.cipher.update({
      where: { id: otherId },
      data: { deletedAt: new Date() },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/ciphers/${otherId}/restore`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);

    const stillTrashed = await prisma.cipher.findUnique({ where: { id: otherId } });
    expect(stillTrashed?.deletedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter backend test -- trash`
Expected: restore 相关测试用例报 404(因为路由未实现);Task 1 的测试仍通过。

- [ ] **Step 3: 实现路由**

修改 `apps/backend/src/ciphers/routes.ts`,在 GET `/trash` 之后追加:

```ts
  // 恢复软删除凭据
  app.post<{ Params: { id: string } }>(
    "/:id/restore",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const deviceId = request.user!.deviceId;
      const { id } = request.params;

      const result = await prisma.cipher.updateMany({
        where: { id, userId, deletedAt: { not: null } },
        data: { deletedAt: null, modifiedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在或未在回收站中");
      }

      if (deviceId) {
        broadcastSyncRequired(userId, deviceId);
      }

      const cipher = await prisma.cipher.findUnique({ where: { id } });
      return reply.send(cipher);
    }
  );
```

并在文件顶部 import 区追加:

```ts
import { broadcastSyncRequired } from "../websocket/server.js";
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter backend test -- trash`
Expected: 7 个测试用例(Task 1 的 3 个 + Task 2 的 4 个)全部通过。

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ciphers/routes.ts apps/backend/tests/integration/trash.test.ts
git commit -m "feat(backend): 新增 POST /api/ciphers/:id/restore 恢复软删凭据"
```

---

## Task 3: 后端 DELETE /api/ciphers/:id/permanent

**Files:**
- Modify: `apps/backend/src/ciphers/routes.ts`
- Modify: `apps/backend/tests/integration/trash.test.ts`(追加 describe 块)

- [ ] **Step 1: 写失败的测试**

在 `apps/backend/tests/integration/trash.test.ts` 末尾追加:

```ts
describe("Trash API - DELETE /:id/permanent", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    ({ token } = await registerAndLogin(app, "permanent"));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("成功硬删软删凭据,返回 204,后续 DB 中不存在该记录", async () => {
    const id = await createCipher(token, app, "to-perm-delete");
    await prisma.cipher.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/ciphers/${id}/permanent`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const stillExists = await prisma.cipher.findUnique({ where: { id } });
    expect(stillExists).toBeNull();
  });

  it("拒绝硬删活跃凭据,返回 404,记录仍存在", async () => {
    const id = await createCipher(token, app, "active-cannot-perm-delete");

    const res = await app.inject({
      method: "DELETE",
      url: `/api/ciphers/${id}/permanent`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);

    const stillExists = await prisma.cipher.findUnique({ where: { id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists?.deletedAt).toBeNull();
  });

  it("永久删除不存在的 id 返回 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/ciphers/${crypto.randomUUID()}/permanent`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("跨租户:用户 A 不能永久删除用户 B 的凭据", async () => {
    const other = await registerAndLogin(app, "permanent-other");
    const otherId = await createCipher(other.token, app, "other-cipher-perm");
    await prisma.cipher.update({
      where: { id: otherId },
      data: { deletedAt: new Date() },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/ciphers/${otherId}/permanent`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);

    const stillExists = await prisma.cipher.findUnique({ where: { id: otherId } });
    expect(stillExists).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter backend test -- trash`
Expected: permanent 相关测试用例报 404(因为路由未实现);前两个 Task 的测试仍通过。

- [ ] **Step 3: 实现路由**

修改 `apps/backend/src/ciphers/routes.ts`,在 POST `/:id/restore` 之后追加:

```ts
  // 永久删除(仅限回收站中的凭据)
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

      if (deviceId) {
        broadcastSyncRequired(userId, deviceId);
      }

      return reply.status(204).send();
    }
  );
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter backend test -- trash`
Expected: 11 个测试用例(Task 1+2+3)全部通过。

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ciphers/routes.ts apps/backend/tests/integration/trash.test.ts
git commit -m "feat(backend): 新增 DELETE /api/ciphers/:id/permanent 永久删除回收站凭据"
```

---

## Task 4: Edge `trash-client.ts`

**Files:**
- Create: `apps/edge-extension/src/sync/trash-client.ts`
- Create: `apps/edge-extension/src/sync/trash-client.test.ts`

- [ ] **Step 1: 写失败的测试**

新建 `apps/edge-extension/src/sync/trash-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../platform/storage", () => ({
  StorageService: {
    getServerUrl: vi.fn().mockResolvedValue("https://api.example.com"),
    getProfile: vi.fn().mockResolvedValue({ token: "test-token", id: "user-1" }),
  },
}));

import { TrashClient } from "./trash-client";

describe("TrashClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("list() 调用 GET /api/ciphers/trash 并返回结果", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "c1", deletedAt: "2026-05-01T00:00:00Z" }],
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrashClient();
    const result = await client.list();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/ciphers/trash",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("list() 非 2xx 抛出错误", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    }) as unknown as typeof fetch;

    const client = new TrashClient();
    await expect(client.list()).rejects.toThrow(/500/);
  });

  it("restore(id) 调用 POST /api/ciphers/:id/restore", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "c1", deletedAt: null }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrashClient();
    const result = await client.restore("c1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/ciphers/c1/restore",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.deletedAt).toBeNull();
  });

  it("restore(id) 非 2xx 抛错", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
    }) as unknown as typeof fetch;

    const client = new TrashClient();
    await expect(client.restore("missing")).rejects.toThrow(/404/);
  });

  it("permanentDelete(id) 调用 DELETE /api/ciphers/:id/permanent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrashClient();
    await client.permanentDelete("c1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/ciphers/c1/permanent",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("permanentDelete(id) 非 2xx 抛错", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
    }) as unknown as typeof fetch;

    const client = new TrashClient();
    await expect(client.permanentDelete("missing")).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter edge-extension test -- trash-client`
Expected: 报 `Cannot find module './trash-client'`(因为 trash-client.ts 还没创建)。

- [ ] **Step 3: 实现 trash-client**

新建 `apps/edge-extension/src/sync/trash-client.ts`:

```ts
// 回收站 REST 客户端
// 封装 /api/ciphers/trash、/:id/restore、/:id/permanent 三个接口

import { StorageService } from "../platform/storage.js";
import type { Cipher } from "@pwbook/shared-types";

export class TrashClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || "";
  }

  private async getBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      this.baseUrl = await StorageService.getServerUrl();
    }
    return this.baseUrl;
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const profile = await StorageService.getProfile();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile?.token || ""}`,
    };
  }

  /** 列出回收站中的所有凭据(按 deletedAt 倒序) */
  async list(): Promise<Cipher[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/ciphers/trash`, {
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`拉取回收站失败: ${response.status}`);
    }
    return (await response.json()) as Cipher[];
  }

  /** 恢复指定凭据,返回恢复后的 Cipher(deletedAt = null) */
  async restore(id: string): Promise<Cipher> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/ciphers/${id}/restore`, {
      method: "POST",
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`恢复凭据失败: ${response.status}`);
    }
    return (await response.json()) as Cipher;
  }

  /** 永久删除指定凭据(必须当前为软删除状态) */
  async permanentDelete(id: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/ciphers/${id}/permanent`, {
      method: "DELETE",
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`永久删除凭据失败: ${response.status}`);
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter edge-extension test -- trash-client`
Expected: 6 个测试用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add apps/edge-extension/src/sync/trash-client.ts apps/edge-extension/src/sync/trash-client.test.ts
git commit -m "feat(edge): 新增 TrashClient 封装回收站 REST 接口"
```

---

## Task 5: Edge `TrashView.tsx` 列表渲染与解密

**Files:**
- Create: `apps/edge-extension/src/popup/components/TrashView.tsx`
- Create: `apps/edge-extension/src/popup/components/TrashView.test.tsx`

- [ ] **Step 1: 写失败的测试**

新建 `apps/edge-extension/src/popup/components/TrashView.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("../../platform/storage", () => ({
  StorageService: {
    getUserKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
    getProfile: vi.fn().mockResolvedValue({ token: "tok", id: "user-1" }),
    getServerUrl: vi.fn().mockResolvedValue("https://api.example.com"),
  },
}));

vi.mock("../../crypto/crypto-service", () => ({
  decryptCipherData: vi.fn(),
}));

const listMock = vi.fn();
const restoreMock = vi.fn();
const permanentDeleteMock = vi.fn();

vi.mock("../../sync/trash-client", () => ({
  TrashClient: vi.fn().mockImplementation(() => ({
    list: listMock,
    restore: restoreMock,
    permanentDelete: permanentDeleteMock,
  })),
}));

import { TrashView } from "./TrashView";
import { decryptCipherData } from "../../crypto/crypto-service";

describe("TrashView - 列表渲染", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("加载中显示占位", async () => {
    listMock.mockImplementation(() => new Promise(() => {})); // 永不 resolve
    render(<TrashView onBack={vi.fn()} />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it("空列表显示'回收站为空'", async () => {
    listMock.mockResolvedValue([]);
    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("回收站为空")).toBeInTheDocument();
    });
  });

  it("渲染解密成功的条目:名称 + username", async () => {
    listMock.mockResolvedValue([
      {
        id: "c1",
        type: 1,
        data: "encrypted-1",
        favorite: false,
        reprompt: 0,
        createdAt: "2026-01-01T00:00:00Z",
        modifiedAt: "2026-04-01T00:00:00Z",
        deletedAt: "2026-05-01T00:00:00Z",
      },
    ]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.getByText("alice")).toBeInTheDocument();
    });
  });

  it("解密失败的条目显示 '解密失败' 占位,且仍渲染操作按钮", async () => {
    listMock.mockResolvedValue([
      {
        id: "c-broken",
        type: 1,
        data: "broken",
        favorite: false,
        reprompt: 0,
        createdAt: "2026-01-01T00:00:00Z",
        modifiedAt: "2026-04-01T00:00:00Z",
        deletedAt: "2026-05-01T00:00:00Z",
      },
    ]);
    vi.mocked(decryptCipherData).mockRejectedValue(new Error("decrypt failed"));

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/解密失败/)).toBeInTheDocument();
      expect(screen.getByText("恢复")).toBeInTheDocument();
      expect(screen.getByText("永久删除")).toBeInTheDocument();
    });
  });

  it("拉取失败显示错误信息和重试按钮", async () => {
    listMock.mockRejectedValueOnce(new Error("network down"));
    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
      expect(screen.getByText("重试")).toBeInTheDocument();
    });

    // 点击重试触发再次请求
    listMock.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });

  it("点击返回触发 onBack", async () => {
    listMock.mockResolvedValue([]);
    const onBack = vi.fn();
    render(<TrashView onBack={onBack} />);
    await waitFor(() => screen.getByText("回收站为空"));
    fireEvent.click(screen.getByText(/返回/));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter edge-extension test -- TrashView`
Expected: 报 `Cannot find module './TrashView'`。

- [ ] **Step 3: 实现 TrashView 列表渲染骨架**

新建 `apps/edge-extension/src/popup/components/TrashView.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { StorageService } from "../../platform/storage";
import { TrashClient } from "../../sync/trash-client";
import type { Cipher } from "@pwbook/shared-types";

interface TrashItem {
  cipher: Cipher;
  name: string;
  username: string;
  decryptFailed: boolean;
  deletedAt: string;
}

interface Props {
  onBack: () => void;
}

export function TrashView({ onBack }: Props): React.ReactElement {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadTrash();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadTrash() {
    setLoading(true);
    setError(null);
    try {
      const client = new TrashClient();
      const list = await client.list();
      const userKey = await StorageService.getUserKey();
      if (!userKey) {
        setError("会话已过期,请重新登录");
        setItems([]);
        return;
      }

      const { decryptCipherData } = await import("../../crypto/crypto-service");
      const decrypted = await Promise.all(
        list.map(async (cipher) => {
          try {
            const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
            return {
              cipher,
              name: data.name || "未命名",
              username: data.login?.username || "",
              decryptFailed: false,
              deletedAt: cipher.deletedAt ?? "",
            } as TrashItem;
          } catch {
            return {
              cipher,
              name: `解密失败 (${cipher.id.slice(0, 8)})`,
              username: "",
              decryptFailed: true,
              deletedAt: cipher.deletedAt ?? "",
            } as TrashItem;
          }
        })
      );
      setItems(decrypted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }

  function formatDeletedAt(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <button
          onClick={onBack}
          style={{
            padding: "4px 8px",
            fontSize: 13,
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          ← 返回
        </button>
        <div style={{ marginLeft: 8, fontWeight: 500, fontSize: 14 }}>
          回收站{items.length > 0 ? `(${items.length})` : ""}
        </div>
      </div>

      {loading && <div style={{ color: "#888", fontSize: 13 }}>加载中...</div>}

      {!loading && error && (
        <div>
          <div style={{ color: "#c62828", fontSize: 13, marginBottom: 8 }}>
            加载失败: {error}
          </div>
          <button onClick={loadTrash} style={{ padding: "4px 12px", fontSize: 13, cursor: "pointer" }}>
            重试
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ color: "#888", fontSize: 13, marginTop: 24, textAlign: "center" }}>
          回收站为空
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div>
          {items.map((item) => (
            <div
              key={item.cipher.id}
              style={{
                padding: "10px 8px",
                borderBottom: "1px solid #f0f0f0",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 14,
                    color: item.decryptFailed ? "#c62828" : "#333",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.name}
                </div>
                <div style={{ color: "#888", fontSize: 12 }}>{item.username}</div>
                <div style={{ color: "#aaa", fontSize: 11 }}>
                  删除于 {formatDeletedAt(item.deletedAt)}
                </div>
              </div>
              <button
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  border: "1px solid #1a73e8",
                  background: "#fff",
                  color: "#1a73e8",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                恢复
              </button>
              <button
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  border: "1px solid #c62828",
                  background: "#fff",
                  color: "#c62828",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                永久删除
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter edge-extension test -- TrashView`
Expected: 6 个测试用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add apps/edge-extension/src/popup/components/TrashView.tsx apps/edge-extension/src/popup/components/TrashView.test.tsx
git commit -m "feat(edge): 新增 TrashView 列表渲染与解密兜底"
```

---

## Task 6: Edge `TrashView` 恢复按钮

**Files:**
- Modify: `apps/edge-extension/src/popup/components/TrashView.tsx`
- Modify: `apps/edge-extension/src/popup/components/TrashView.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 `TrashView.test.tsx` 末尾追加新的 describe 块。同时确保文件顶部有 `chrome` 全局 mock(用 `vi.stubGlobal`):

```tsx
describe("TrashView - 恢复操作", () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage: sendMessageMock } });
  });

  it("点击恢复调用 restore,从列表移除该项,触发 sync 消息,显示 toast", async () => {
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    restoreMock.mockResolvedValue({ ...sample, deletedAt: null });

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("恢复"));

    await waitFor(() => {
      expect(restoreMock).toHaveBeenCalledWith("c1");
    });

    // 触发同步消息
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({ type: "TRIGGER_SYNC_NOW" });
    });

    // 列表中该项被移除
    await waitFor(() => {
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    });

    // toast 提示
    expect(screen.getByText("已恢复")).toBeInTheDocument();
  });

  it("恢复失败保留列表项并提示错误", async () => {
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    restoreMock.mockRejectedValue(new Error("network"));

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("恢复"));

    await waitFor(() => {
      expect(screen.getByText("恢复失败")).toBeInTheDocument();
    });
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter edge-extension test -- TrashView`
Expected: 新增 2 个测试失败(因为恢复按钮目前没绑定 onClick)。

- [ ] **Step 3: 实现恢复逻辑**

修改 `apps/edge-extension/src/popup/components/TrashView.tsx`,在 `TrashView` 组件函数体内添加恢复处理函数(放在 `loadTrash` 之后):

```tsx
  async function handleRestore(id: string) {
    try {
      const client = new TrashClient();
      await client.restore(id);
      setItems((prev) => prev.filter((it) => it.cipher.id !== id));
      setToast("已恢复");
      try {
        await chrome.runtime.sendMessage({ type: "TRIGGER_SYNC_NOW" });
      } catch {
        // 即使发不出 sync 通知也不阻塞,本设备无该 cipher 等下次 sync 拉回
      }
    } catch {
      setToast("恢复失败");
    }
  }
```

并修改"恢复"按钮加上 onClick:

```tsx
              <button
                onClick={() => handleRestore(item.cipher.id)}
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  border: "1px solid #1a73e8",
                  background: "#fff",
                  color: "#1a73e8",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                恢复
              </button>
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter edge-extension test -- TrashView`
Expected: 全部 8 个测试用例(Task 5 的 6 个 + Task 6 的 2 个)通过。

- [ ] **Step 5: Commit**

```bash
git add apps/edge-extension/src/popup/components/TrashView.tsx apps/edge-extension/src/popup/components/TrashView.test.tsx
git commit -m "feat(edge): TrashView 支持恢复操作并触发同步"
```

---

## Task 7: Edge `TrashView` 永久删除按钮

**Files:**
- Modify: `apps/edge-extension/src/popup/components/TrashView.tsx`
- Modify: `apps/edge-extension/src/popup/components/TrashView.test.tsx`

- [ ] **Step 1: 写失败的测试**

在 `TrashView.test.tsx` 末尾继续追加:

```tsx
describe("TrashView - 永久删除操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("点击永久删除弹出 confirm,用户确认则调用 permanentDelete 并移除列表项", async () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    permanentDeleteMock.mockResolvedValue(undefined);

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("永久删除"));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(permanentDeleteMock).toHaveBeenCalledWith("c1");
    });
    await waitFor(() => {
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    });
    expect(screen.getByText("已永久删除")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("用户取消 confirm 不调用 permanentDelete,列表不变", async () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("永久删除"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(permanentDeleteMock).not.toHaveBeenCalled();
    expect(screen.getByText("GitHub")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("永久删除失败保留列表项并提示错误", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    permanentDeleteMock.mockRejectedValue(new Error("network"));

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("永久删除"));

    await waitFor(() => {
      expect(screen.getByText("永久删除失败")).toBeInTheDocument();
    });
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter edge-extension test -- TrashView`
Expected: 3 个新测试失败(因为永久删除按钮还没绑定 onClick)。

- [ ] **Step 3: 实现永久删除逻辑**

修改 `apps/edge-extension/src/popup/components/TrashView.tsx`,在 `handleRestore` 之后追加:

```tsx
  async function handlePermanentDelete(id: string, name: string) {
    const ok = window.confirm(`确定永久删除 "${name}" 吗?此操作不可恢复。`);
    if (!ok) return;
    try {
      const client = new TrashClient();
      await client.permanentDelete(id);
      setItems((prev) => prev.filter((it) => it.cipher.id !== id));
      setToast("已永久删除");
    } catch {
      setToast("永久删除失败");
    }
  }
```

并修改"永久删除"按钮加上 onClick:

```tsx
              <button
                onClick={() => handlePermanentDelete(item.cipher.id, item.name)}
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  border: "1px solid #c62828",
                  background: "#fff",
                  color: "#c62828",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                永久删除
              </button>
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter edge-extension test -- TrashView`
Expected: 全部 11 个测试用例(Task 5+6+7)通过。

- [ ] **Step 5: Commit**

```bash
git add apps/edge-extension/src/popup/components/TrashView.tsx apps/edge-extension/src/popup/components/TrashView.test.tsx
git commit -m "feat(edge): TrashView 支持永久删除并二次确认"
```

---

## Task 8: Edge 集成 — PopupApp 路由 + VaultList 入口按钮

**Files:**
- Modify: `apps/edge-extension/src/popup/PopupApp.tsx`
- Modify: `apps/edge-extension/src/popup/components/VaultList.tsx`

此 task 不引入新测试逻辑(纯 wiring,且 PopupApp/VaultList 的 props 类型变化会被 tsc 捕获)。在 step 末尾跑 `pnpm --filter edge-extension build` 当作回归。

- [ ] **Step 1: 修改 `PopupApp.tsx`**

打开 `apps/edge-extension/src/popup/PopupApp.tsx`,修改如下:

(a) 顶部 import 区追加:

```ts
import { TrashView } from "./components/TrashView";
```

(b) 把 `View` 类型加 `"trash"`:

```diff
-type View = "unlock" | "vault" | "add" | "edit" | "noteAdd" | "noteEdit" | "generator" | "cookieSync";
+type View = "unlock" | "vault" | "add" | "edit" | "noteAdd" | "noteEdit" | "generator" | "cookieSync" | "trash";
```

(c) 在 `handleOpenCookieSync` 之后追加处理函数:

```ts
  function handleOpenTrash() {
    setView("trash");
  }
```

(d) 把 `VaultList` 的 props 加上 `onOpenTrash`:

```diff
       {view === "vault" && (
         <VaultList
           onAdd={handleAdd}
           onEdit={handleEdit}
           onAddNote={handleAddNote}
           onEditNote={handleEditNote}
           onOpenGenerator={handleOpenGenerator}
           onOpenCookieSync={handleOpenCookieSync}
+          onOpenTrash={handleOpenTrash}
         />
       )}
```

(e) 在 `view === "cookieSync"` 分支之后追加 trash 分支:

```tsx
      {view === "trash" && <TrashView onBack={handleBackToVault} />}
```

- [ ] **Step 2: 修改 `VaultList.tsx`**

打开 `apps/edge-extension/src/popup/components/VaultList.tsx`:

(a) `Props` 接口追加 `onOpenTrash`:

```diff
 interface Props {
   onAdd: () => void;
   onEdit: (id: string) => void;
   onAddNote: () => void;
   onEditNote: (id: string) => void;
   onOpenGenerator: () => void;
   onOpenCookieSync: () => void;
+  onOpenTrash: () => void;
 }
```

(b) 函数签名解构追加 `onOpenTrash`:

```diff
-export function VaultList({ onAdd, onEdit, onAddNote, onEditNote, onOpenGenerator, onOpenCookieSync }: Props): React.ReactElement {
+export function VaultList({ onAdd, onEdit, onAddNote, onEditNote, onOpenGenerator, onOpenCookieSync, onOpenTrash }: Props): React.ReactElement {
```

(c) 在当前包含"密码生成器""Cookie 同步"两个按钮的那一行 div(`<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>`,约文件 line 359 附近)**追加第三个按钮**,作为"回收站"入口:

```tsx
        <button
          onClick={onOpenTrash}
          style={{
            flex: 1,
            padding: "8px",
            borderRadius: 6,
            border: "1px solid #1a73e8",
            background: "#fff",
            color: "#1a73e8",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          回收站
        </button>
```

放在"Cookie 同步"按钮之后,保持三列等宽布局。

- [ ] **Step 3: 跑构建作为回归**

Run: `pnpm --filter edge-extension build`
Expected: build 成功,无 TypeScript 报错。

- [ ] **Step 4: 跑完整 edge 测试套件**

Run: `pnpm --filter edge-extension test`
Expected: 既有测试 + 新增 TrashView/trash-client 测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add apps/edge-extension/src/popup/PopupApp.tsx apps/edge-extension/src/popup/components/VaultList.tsx
git commit -m "feat(edge): VaultList 工具栏新增回收站入口,PopupApp 路由到 TrashView"
```

---

## 完成后回归检查清单

实施完所有 task 之后,在合并前运行:

- [ ] `pnpm --filter backend test` 全部通过
- [ ] `pnpm --filter edge-extension test` 全部通过
- [ ] `pnpm --filter edge-extension build` 成功
- [ ] 在 Edge 浏览器中加载 dist:
  - 创建 1 条凭据 → 编辑 → 删除 → 进入回收站 → 看到该条目
  - 点恢复 → 回 VaultList 看到凭据
  - 重新删除 → 进回收站 → 点永久删除 → confirm 确认 → 列表移除
  - 重新打开回收站 → 该条目不再出现
- [ ] 后端 SQLite 查询 `SELECT id, deletedAt FROM ciphers WHERE id = '...'` 确认永久删除后记录消失
- [ ] Android 端登录同一账户,触发同步,验证恢复的凭据出现在凭据列表中(可手动 pull-to-refresh)

---

## 不在范围内(明确不做)

- 自动清理调度任务
- 批量永久删除 / 清空回收站
- 回收站搜索 / 筛选
- Android 端 UI
- 修改既有 `DELETE /api/ciphers/:id`(硬删)的语义
