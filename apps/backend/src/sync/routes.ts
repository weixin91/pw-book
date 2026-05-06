import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { calculateSyncChecksum } from "./checksum.js";
import { broadcastSyncRequired } from "../websocket/server.js";
import { prisma } from "../db/prisma.js";

const pushSchema = z.object({
  changes: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(["CREATE", "UPDATE", "DELETE"]),
        cipher: z.object({
          id: z.string().uuid(),
          type: z.number().int(),
          data: z.string(),
          favorite: z.boolean().optional().default(false),
          reprompt: z.number().int().optional().default(0),
          modifiedAt: z.string().datetime(),
        }),
        clientTimestamp: z.string().datetime(),
      })
    )
    // 限制单批写入数量，避免 Prisma 交互事务超时（默认 5s，下方设置为 30s）
    .max(500),
  lastSyncToken: z.string().optional(),
});

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;
    const deviceId = request.user!.deviceId;
    if (!deviceId) {
      // 旧版 JWT（注册即拿到的 token）不带 deviceId，要求重新登录以建立设备会话
      throw new ApiError("INVALID_TOKEN", 400, "缺少设备会话，请重新登录");
    }
    const since = (request.query as { since?: string }).since;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        kdfType: true,
        kdfIterations: true,
        kdfMemory: true,
        kdfParallelism: true,
        publicKey: true,
        securityStamp: true,
      },
    });

    if (!user) {
      throw new ApiError("RESOURCE_NOT_FOUND", 404, "用户不存在");
    }

    const cipherWhere = since
      ? { userId, modifiedAt: { gt: new Date(since) } }
      : { userId };

    const ciphers = await prisma.cipher.findMany({
      where: cipherWhere,
      orderBy: { modifiedAt: "asc" },
    });

    const deletedCipherIds = ciphers
      .filter((c) => c.deletedAt !== null)
      .map((c) => c.id);

    const domainAssociations = await prisma.domainAssociation.findMany({
      where: { userId },
    });

    // 设备元信息从登录时建立的 Device 记录读取，避免硬编码 deviceType/deviceName
    const device = await prisma.device.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });
    if (!device) {
      throw new ApiError("INVALID_TOKEN", 400, "设备会话已失效，请重新登录");
    }

    await prisma.syncRecord.upsert({
      where: {
        userId_deviceId: { userId, deviceId },
      },
      update: { lastSyncAt: new Date() },
      create: {
        userId,
        deviceId,
        deviceType: device.deviceType,
        deviceName: device.deviceName,
        lastSyncAt: new Date(),
      },
    });

    const syncToken = new Date().toISOString();
    const checksum = calculateSyncChecksum(ciphers);

    return reply.send({
      profile: user,
      ciphers: ciphers.filter((c) => c.deletedAt === null),
      deletedCipherIds,
      domainAssociations: domainAssociations.map((da) => ({
        ...da,
        domains: JSON.parse(da.domains),
        packageNames: JSON.parse(da.packageNames),
      })),
      syncToken,
      checksum,
    });
  });

  app.post("/push", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;
    const deviceId = request.user!.deviceId;
    if (!deviceId) {
      throw new ApiError("INVALID_TOKEN", 400, "缺少设备会话，请重新登录");
    }
    const body = pushSchema.parse(request.body);

    const accepted: string[] = [];
    const rejected: string[] = [];
    const conflicts: string[] = [];

    // 使用事务确保原子性。Prisma interactive transaction 默认 5s 超时，
    // 单批最多 500 条变更，给 30s 留足处理空间。
    await prisma.$transaction(
      async (tx) => {
        for (const change of body.changes) {
          try {
            const existing = await tx.cipher.findUnique({
              where: { id: change.cipher.id },
            });

            // 校验所有权：existing 必须不存在或属于当前用户
            if (existing && existing.userId !== userId) {
              // 跨租户操作，拒绝
              rejected.push(change.id);
              continue;
            }

            if (change.type === "DELETE") {
              if (existing && existing.userId === userId) {
                await tx.cipher.update({
                  where: { id: change.cipher.id, userId },
                  data: { deletedAt: new Date(), modifiedAt: new Date() },
                });
              }
              accepted.push(change.id);
              continue;
            }

            const serverModifiedAt = existing?.modifiedAt ?? new Date(0);
            const clientModifiedAt = new Date(change.cipher.modifiedAt);

            if (clientModifiedAt >= serverModifiedAt) {
              await tx.cipher.upsert({
                where: { id: change.cipher.id },
                update: {
                  userId, // 确保 userId 不被篡改
                  type: change.cipher.type,
                  data: change.cipher.data,
                  favorite: change.cipher.favorite,
                  reprompt: change.cipher.reprompt,
                  modifiedAt: clientModifiedAt,
                },
                create: {
                  id: change.cipher.id,
                  userId,
                  type: change.cipher.type,
                  data: change.cipher.data,
                  favorite: change.cipher.favorite,
                  reprompt: change.cipher.reprompt,
                  modifiedAt: clientModifiedAt,
                },
              });
              accepted.push(change.id);
            } else {
              conflicts.push(change.id);
            }
          } catch (e) {
            console.error(`[SyncPush] rejected change ${change.id} (cipher=${change.cipher.id}):`, e);
            rejected.push(change.id);
          }
        }
      },
      { timeout: 30_000, maxWait: 5_000 }
    );

    const newSyncToken = new Date().toISOString();
    const newChecksum = calculateSyncChecksum(
      await prisma.cipher.findMany({ where: { userId, deletedAt: null } })
    );

    // 只有实际有变更时才广播
    if (accepted.length > 0) {
      broadcastSyncRequired(userId, deviceId);
    }

    return reply.send({ accepted, rejected, conflicts, newSyncToken, checksum: newChecksum });
  });
}
