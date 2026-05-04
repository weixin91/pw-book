import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { prisma } from "../db/prisma.js";

const cookieSchema = z.object({
  domain: z.string().min(1),
  encryptedData: z.string().min(1),
  modifiedAt: z.string().datetime().optional(),
});

const batchSchema = z.object({
  items: z.array(cookieSchema).min(1).max(50),
});

export async function cookieRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: z.infer<typeof cookieSchema> }>(
    "/",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const body = cookieSchema.parse(request.body);

      const record = await prisma.cookieData.upsert({
        where: { userId_domain: { userId, domain: body.domain } },
        update: {
          encryptedData: body.encryptedData,
          modifiedAt: body.modifiedAt ? new Date(body.modifiedAt) : new Date(),
        },
        create: {
          userId,
          domain: body.domain,
          encryptedData: body.encryptedData,
          modifiedAt: body.modifiedAt ? new Date(body.modifiedAt) : new Date(),
        },
      });

      return reply.status(201).send(record);
    }
  );

  app.post<{ Body: z.infer<typeof batchSchema> }>(
    "/batch",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const body = batchSchema.parse(request.body);

      // 使用事务批量写入，确保原子性
      const results = await prisma.$transaction(
        body.items.map((item) =>
          prisma.cookieData.upsert({
            where: { userId_domain: { userId, domain: item.domain } },
            update: {
              encryptedData: item.encryptedData,
              modifiedAt: item.modifiedAt ? new Date(item.modifiedAt) : new Date(),
            },
            create: {
              userId,
              domain: item.domain,
              encryptedData: item.encryptedData,
              modifiedAt: item.modifiedAt ? new Date(item.modifiedAt) : new Date(),
            },
          })
        )
      );

      const accepted = results.map((r) => r.domain);

      return reply.send({
        accepted,
        rejected: [],
        newSyncToken: crypto.randomUUID(),
      });
    }
  );

  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;

    const records = await prisma.cookieData.findMany({
      where: { userId },
      orderBy: { modifiedAt: "desc" },
    });

    return reply.send({
      data: records,
      syncToken: crypto.randomUUID(),
    });
  });

  app.get<{ Params: { domain: string } }>(
    "/:domain",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { domain } = request.params;

      const record = await prisma.cookieData.findUnique({
        where: { userId_domain: { userId, domain } },
      });
      if (!record) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "Cookie 记录不存在");
      }

      return reply.send(record);
    }
  );

  app.delete<{ Params: { domain: string } }>(
    "/:domain",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { domain } = request.params;

      const record = await prisma.cookieData.findUnique({
        where: { userId_domain: { userId, domain } },
      });
      if (!record) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "Cookie 记录不存在");
      }

      await prisma.cookieData.delete({ where: { id: record.id } });
      return reply.status(204).send();
    }
  );
}
