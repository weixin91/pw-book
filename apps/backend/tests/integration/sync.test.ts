import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { syncRoutes } from "../../src/sync/routes.js";
import { authRoutes } from "../../src/auth/routes.js";
import { cipherRoutes } from "../../src/ciphers/routes.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(cipherRoutes, { prefix: "/api/ciphers" });
  await app.register(syncRoutes, { prefix: "/api/sync" });
  return app;
}

async function registerAndLogin(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `sync-test-${Date.now()}@example.com`;
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
      deviceId: "device-1",
      deviceType: "BROWSER",
      deviceName: "Edge",
    },
  });

  const body = JSON.parse(loginRes.payload);
  return body.token as string;
}

describe("Sync API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    token = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("should return empty sync data initially", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sync",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ciphers).toEqual([]);
    expect(body.domainAssociations).toEqual([]);
    expect(body).toHaveProperty("syncToken");
    expect(body).toHaveProperty("checksum");
  });

  it("should sync a created cipher via push", async () => {
    const cipherId = crypto.randomUUID();

    // 先创建凭据
    await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id: cipherId,
        type: 1,
        data: "encrypted-sync-data",
      },
    });

    // 全量同步应包含该凭据
    const syncRes = await app.inject({
      method: "GET",
      url: "/api/sync",
      headers: { authorization: `Bearer ${token}` },
    });
    const syncBody = JSON.parse(syncRes.payload);
    expect(syncBody.ciphers.length).toBeGreaterThanOrEqual(1);
    expect(syncBody.ciphers.some((c: { id: string }) => c.id === cipherId)).toBe(true);
  });

  it("should push changes and accept them", async () => {
    const changeId = `change-${Date.now()}`;
    const cipherId = crypto.randomUUID();

    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        changes: [
          {
            id: changeId,
            type: "CREATE",
            cipher: {
              id: cipherId,
              type: 1,
              data: "pushed-data",
              favorite: false,
              reprompt: 0,
              modifiedAt: new Date().toISOString(),
            },
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.accepted).toContain(changeId);
    expect(body.rejected).toEqual([]);
    expect(body.conflicts).toEqual([]);
  });

  it("should resolve conflict with last-write-wins", async () => {
    const cipherId = crypto.randomUUID();
    const now = new Date();

    // 服务端先创建一条记录
    await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id: cipherId,
        type: 1,
        data: "server-data",
        modifiedAt: now.toISOString(),
      },
    });

    // 推送一个更早时间戳的变更（应被冲突）
    const earlier = new Date(now.getTime() - 60_000).toISOString();
    const changeId = `change-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        changes: [
          {
            id: changeId,
            type: "UPDATE",
            cipher: {
              id: cipherId,
              type: 1,
              data: "older-client-data",
              favorite: false,
              reprompt: 0,
              modifiedAt: earlier,
            },
            clientTimestamp: earlier,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // 服务端 modifiedAt 更新，客户端更早，必须落入 conflicts 而非 accepted
    expect(body.conflicts).toContain(changeId);
    expect(body.accepted).not.toContain(changeId);
  });
});
