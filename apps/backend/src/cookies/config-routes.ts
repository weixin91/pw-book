import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { prisma } from "../db/prisma.js";

const configSchema = z.object({
  autoPush: z.boolean().optional(),
  autoPull: z.boolean().optional(),
  includeLocalStorage: z.boolean().optional(),
});

export async function cookieConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;

    const records = await prisma.cookieSyncConfig.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({ data: records });
  });

  app.put<{ Params: { domain: string }; Body: z.infer<typeof configSchema> }>(
    "/:domain",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { domain } = request.params;
      const body = configSchema.parse(request.body);

      const existing = await prisma.cookieSyncConfig.findUnique({
        where: { userId_domain: { userId, domain } },
      });

      const record = await prisma.cookieSyncConfig.upsert({
        where: { userId_domain: { userId, domain } },
        update: {
          autoPush: body.autoPush ?? existing?.autoPush ?? false,
          autoPull: body.autoPull ?? existing?.autoPull ?? false,
          includeLocalStorage: body.includeLocalStorage ?? existing?.includeLocalStorage ?? false,
        },
        create: {
          userId,
          domain,
          autoPush: body.autoPush ?? false,
          autoPull: body.autoPull ?? false,
          includeLocalStorage: body.includeLocalStorage ?? false,
        },
      });

      return reply.send(record);
    }
  );

  app.delete<{ Params: { domain: string } }>(
    "/:domain",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { domain } = request.params;

      const record = await prisma.cookieSyncConfig.findUnique({
        where: { userId_domain: { userId, domain } },
      });
      if (!record) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "同步规则不存在");
      }

      await prisma.cookieSyncConfig.delete({ where: { id: record.id } });
      return reply.status(204).send();
    }
  );
}
