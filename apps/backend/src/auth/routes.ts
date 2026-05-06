import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createToken, createRefreshToken, verifyToken } from "./jwt.js";
import { ApiError } from "../errors/handler.js";
import { isEmailAllowed } from "./whitelist.js";
import {
  loginRateLimitHook,
  recordLoginAttempt,
  clearLoginAttempts,
} from "../rate-limiter.js";
import { prisma } from "../db/prisma.js";
import { timingSafeStringEqual } from "./timing-safe.js";

const registerSchema = z.object({
  email: z.string().email(),
  masterPasswordHash: z.string().min(1),
  protectedKey: z.string().min(1),
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  kdfType: z.enum(["PBKDF2_SHA256", "ARGON2ID"]),
  kdfIterations: z.number().int().min(1),
  kdfMemory: z.number().int().optional(),
  kdfParallelism: z.number().int().optional(),
  recoveryKeyHash: z.string().min(1),
  encryptedRecoveryKey: z.string().min(1),
  // 注册时同步建立设备会话，避免后续 /sync 请求因 token 缺少 deviceId 而 400
  deviceId: z.string().min(1).optional(),
  deviceType: z.enum(["BROWSER", "ANDROID"]).optional(),
  deviceName: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  masterPasswordHash: z.string().min(1),
  deviceId: z.string().min(1),
  deviceType: z.enum(["BROWSER", "ANDROID"]),
  deviceName: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const preloginSchema = z.object({
  email: z.string().email(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/prelogin", async (request, reply) => {
    const body = preloginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或主密码错误");
    }
    return {
      kdfType: user.kdfType,
      kdfIterations: user.kdfIterations,
      kdfMemory: user.kdfMemory,
      kdfParallelism: user.kdfParallelism,
      encryptedRecoveryKey: user.encryptedRecoveryKey,
    };
  });

  app.post("/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);

    if (!isEmailAllowed(body.email)) {
      throw new ApiError("FORBIDDEN", 403, "该邮箱不在注册白名单中");
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new ApiError("VALIDATION_ERROR", 400, "邮箱已被注册");
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        masterPasswordHash: body.masterPasswordHash,
        protectedKey: body.protectedKey,
        publicKey: body.publicKey,
        encryptedPrivateKey: body.encryptedPrivateKey,
        kdfType: body.kdfType,
        kdfIterations: body.kdfIterations,
        kdfMemory: body.kdfMemory,
        kdfParallelism: body.kdfParallelism,
        recoveryKeyHash: body.recoveryKeyHash,
        encryptedRecoveryKey: body.encryptedRecoveryKey,
      },
    });

    // 客户端可在注册时一并建立设备会话；缺省时该 token 不带 deviceId，需先调用 /login 才能 /sync
    if (body.deviceId && body.deviceType && body.deviceName) {
      await prisma.device.upsert({
        where: { userId_deviceId: { userId: user.id, deviceId: body.deviceId } },
        update: { deviceName: body.deviceName, lastSyncAt: new Date() },
        create: {
          userId: user.id,
          deviceId: body.deviceId,
          deviceType: body.deviceType,
          deviceName: body.deviceName,
        },
      });
    }

    const token = await createToken({
      sub: user.id,
      email: user.email,
      securityStamp: user.securityStamp,
      deviceId: body.deviceId,
    });
    const refreshToken = await createRefreshToken({
      sub: user.id,
      email: user.email,
      securityStamp: user.securityStamp,
      deviceId: body.deviceId,
    });

    return reply.status(201).send({
      id: user.id,
      email: user.email,
      token,
      refreshToken,
      protectedKey: user.protectedKey,
    });
  });

  app.post("/login", { preHandler: [loginRateLimitHook] }, async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      recordLoginAttempt(body.email);
      throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或主密码错误");
    }

    if (!timingSafeStringEqual(user.masterPasswordHash, body.masterPasswordHash)) {
      recordLoginAttempt(body.email);
      throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或主密码错误");
    }

    // 登录成功，清除速率限制记录
    clearLoginAttempts(body.email);

    await prisma.device.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: body.deviceId } },
      update: { deviceName: body.deviceName, lastSyncAt: new Date() },
      create: {
        userId: user.id,
        deviceId: body.deviceId,
        deviceType: body.deviceType,
        deviceName: body.deviceName,
      },
    });

    const token = await createToken({
      sub: user.id,
      email: user.email,
      securityStamp: user.securityStamp,
      deviceId: body.deviceId,
    });
    const refreshToken = await createRefreshToken({
      sub: user.id,
      email: user.email,
      securityStamp: user.securityStamp,
      deviceId: body.deviceId,
    });

    return reply.send({
      id: user.id,
      token,
      refreshToken,
      protectedKey: user.protectedKey,
      securityStamp: user.securityStamp,
    });
  });

  app.post("/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);

    const payload = await verifyToken(body.refreshToken);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new ApiError("INVALID_TOKEN", 401, "用户不存在");
    }

    if (user.securityStamp !== payload.securityStamp) {
      throw new ApiError("TOKEN_EXPIRED", 401, "安全令牌已变更，请重新登录");
    }

    const token = await createToken({
      sub: user.id,
      email: user.email,
      securityStamp: user.securityStamp,
      deviceId: payload.deviceId,
    });
    const refreshToken = await createRefreshToken({
      sub: user.id,
      email: user.email,
      securityStamp: user.securityStamp,
      deviceId: payload.deviceId,
    });

    return reply.send({ token, refreshToken });
  });
}
