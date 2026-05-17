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
