import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { calculateSyncChecksum } from "./checksum.js";

const prisma = new PrismaClient();

const pushSchema = z.object({
  changes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["CREATE", "UPDATE", "DELETE"]),
      cipher: z.object({
        id: z.string(),
        type: z.number().int(),
        data: z.string(),
        favorite: z.boolean().optional().default(false),
        reprompt: z.number().int().optional().default(0),
        modifiedAt: z.string().datetime(),
      }),
      clientTimestamp: z.string().datetime(),
    })
  ),
  lastSyncToken: z.string().optional(),
});

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;
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

    const domainAssociations = await prisma.domainAssociation.findMany({
      where: { userId },
    });

    await prisma.syncRecord.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId: request.user!.deviceId || "default",
        },
      },
      update: { lastSyncAt: new Date() },
      create: {
        userId,
        deviceId: request.user!.deviceId || "default",
        deviceType: "BROWSER",
        deviceName: "Edge Browser",
        lastSyncAt: new Date(),
      },
    });

    const syncToken = new Date().toISOString();
    const checksum = calculateSyncChecksum(ciphers);

    return reply.send({
      profile: user,
      ciphers,
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
    const body = pushSchema.parse(request.body);

    const accepted: string[] = [];
    const rejected: string[] = [];
    const conflicts: string[] = [];

    for (const change of body.changes) {
      try {
        const existing = await prisma.cipher.findUnique({
          where: { id: change.cipher.id },
        });

        if (change.type === "DELETE") {
          if (existing) {
            await prisma.cipher.delete({ where: { id: change.cipher.id } });
          }
          accepted.push(change.id);
          continue;
        }

        const serverModifiedAt = existing?.modifiedAt ?? new Date(0);
        const clientModifiedAt = new Date(change.cipher.modifiedAt);

        if (clientModifiedAt >= serverModifiedAt) {
          await prisma.cipher.upsert({
            where: { id: change.cipher.id },
            update: {
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
      } catch {
        rejected.push(change.id);
      }
    }

    const newSyncToken = new Date().toISOString();
    const newChecksum = calculateSyncChecksum(
      await prisma.cipher.findMany({ where: { userId } })
    );
    return reply.send({ accepted, rejected, conflicts, newSyncToken, checksum: newChecksum });
  });
}
