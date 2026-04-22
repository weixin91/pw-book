import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";

const prisma = new PrismaClient();

const cookieSchema = z.object({
  domain: z.string().min(1),
  encryptedData: z.string().min(1),
  modifiedAt: z.string().datetime().optional(),
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
}
