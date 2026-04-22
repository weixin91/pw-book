import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createToken, createRefreshToken } from "./jwt.js";
import { ApiError } from "../errors/handler.js";

const prisma = new PrismaClient();

const recoverSchema = z.object({
  email: z.string().email(),
  recoveryKey: z.string().min(1),
  newMasterPasswordHash: z.string().min(1),
  newProtectedKey: z.string().min(1),
});

export async function recoverRoutes(app: FastifyInstance): Promise<void> {
  app.post("/recover", async (request, reply) => {
    const body = recoverSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或恢复密钥无效");
    }

    if (!user.recoveryKeyHash || user.recoveryKeyHash !== body.recoveryKey) {
      throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或恢复密钥无效");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        masterPasswordHash: body.newMasterPasswordHash,
        protectedKey: body.newProtectedKey,
        securityStamp: crypto.randomUUID(),
      },
    });

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

    return reply.send({ token, refreshToken });
  });
}
