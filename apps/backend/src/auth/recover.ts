import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createToken, createRefreshToken } from "./jwt.js";
import { ApiError } from "../errors/handler.js";
import { prisma } from "../db/prisma.js";
import { kickUser } from "../websocket/server.js";
import {
  recoverRateLimitHook,
  recordRecoverAttempt,
  clearRecoverAttempts,
} from "../rate-limiter.js";
import { timingSafeStringEqual } from "./timing-safe.js";
import { RECOVERY_KEY_PBKDF2_ITERATIONS } from "@pwbook/shared-types";

const recoverSchema = z.object({
  email: z.string().email(),
  recoveryKey: z.string().min(1),
  newMasterPasswordHash: z.string().min(1),
  newProtectedKey: z.string().min(1),
});

async function deriveRecoveryKeyHash(recoveryKey: string, email: string): Promise<string> {
  const encoder = new TextEncoder();
  const saltData = encoder.encode(email.toLowerCase().trim());
  const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", saltData));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(recoveryKey.toUpperCase()), "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: RECOVERY_KEY_PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const bytes = new Uint8Array(derivedBits);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function recoverRoutes(app: FastifyInstance): Promise<void> {
  app.post("/recover", { preHandler: [recoverRateLimitHook] }, async (request, reply) => {
    const body = recoverSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      recordRecoverAttempt(body.email);
      throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或恢复密钥无效");
    }

    const recoveryKeyHash = await deriveRecoveryKeyHash(body.recoveryKey, body.email);
    if (!user.recoveryKeyHash || !timingSafeStringEqual(user.recoveryKeyHash, recoveryKeyHash)) {
      recordRecoverAttempt(body.email);
      throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或恢复密钥无效");
    }

    // 恢复成功，清除速率限制记录
    clearRecoverAttempts(body.email);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        masterPasswordHash: body.newMasterPasswordHash,
        protectedKey: body.newProtectedKey,
        securityStamp: crypto.randomUUID(),
      },
    });

    // securityStamp 已变更，立即踢下线所有现存 WebSocket 连接
    kickUser(updated.id, "Account recovered");

    const token = await createToken({
      sub: updated.id,
      email: updated.email,
      securityStamp: updated.securityStamp,
    });
    const refreshToken = await createRefreshToken({
      sub: updated.id,
      email: updated.email,
      securityStamp: updated.securityStamp,
    });

    return reply.send({ id: updated.id, token, refreshToken, securityStamp: updated.securityStamp });
  });
}
