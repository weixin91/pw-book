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
