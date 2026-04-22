import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { authRoutes } from "../../src/auth/routes.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(authRoutes, { prefix: "/api/auth" });
  return app;
}

describe("Auth API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("should register a new user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: `test-${Date.now()}@example.com`,
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
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("refreshToken");
  });

  it("should reject duplicate email", async () => {
    const email = `dup-${Date.now()}@example.com`;
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

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email,
        masterPasswordHash: "hash456",
        protectedKey: "key456",
        publicKey: "pub456",
        encryptedPrivateKey: "priv456",
        kdfType: "PBKDF2_SHA256",
        kdfIterations: 600000,
        recoveryKeyHash: "rec456",
        encryptedRecoveryKey: "recEnc456",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
