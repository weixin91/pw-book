import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { cipherRoutes } from "../../src/ciphers/routes.js";
import { authRoutes } from "../../src/auth/routes.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(cipherRoutes, { prefix: "/api/ciphers" });
  return app;
}

async function registerAndLogin(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `cipher-test-${Date.now()}@example.com`;
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

describe("Cipher API", () => {
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

  it("should create a cipher", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id: `cipher-${Date.now()}`,
        type: 1,
        data: "encrypted-data-1",
        favorite: false,
        reprompt: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.data).toBe("encrypted-data-1");
  });

  it("should reject duplicate cipher id", async () => {
    const id = `dup-cipher-${Date.now()}`;
    await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id,
        type: 1,
        data: "encrypted-data",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id,
        type: 1,
        data: "encrypted-data-2",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("should update a cipher", async () => {
    const id = `update-cipher-${Date.now()}`;
    await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: { id, type: 1, data: "old-data" },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/ciphers/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { type: 1, data: "new-data", favorite: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toBe("new-data");
    expect(body.favorite).toBe(true);
  });

  it("should delete a cipher", async () => {
    const id = `delete-cipher-${Date.now()}`;
    await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: { id, type: 1, data: "to-delete" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/ciphers/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it("should get a cipher by id", async () => {
    const id = `get-cipher-${Date.now()}`;
    await app.inject({
      method: "POST",
      url: "/api/ciphers",
      headers: { authorization: `Bearer ${token}` },
      payload: { id, type: 1, data: "get-me" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/ciphers/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toBe("get-me");
  });

  it("should return 404 for non-existent cipher", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ciphers/non-existent-id",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
