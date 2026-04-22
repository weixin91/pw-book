import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";

const prisma = new PrismaClient();

const domainAssocSchema = z.object({
  domains: z.array(z.string().min(1)),
  packageNames: z.array(z.string().min(1)).optional().default([]),
});

export async function domainAssocRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;

    const records = await prisma.domainAssociation.findMany({
      where: { userId },
    });

    return reply.send({
      data: records.map((r) => ({
        ...r,
        domains: JSON.parse(r.domains),
        packageNames: JSON.parse(r.packageNames),
      })),
    });
  });

  app.post<{ Body: z.infer<typeof domainAssocSchema> }>(
    "/",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const body = domainAssocSchema.parse(request.body);

      const record = await prisma.domainAssociation.create({
        data: {
          userId,
          domains: JSON.stringify(body.domains),
          packageNames: JSON.stringify(body.packageNames),
        },
      });

      return reply.status(201).send({
        ...record,
        domains: JSON.parse(record.domains),
        packageNames: JSON.parse(record.packageNames),
      });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      const record = await prisma.domainAssociation.findFirst({
        where: { id, userId },
      });
      if (!record) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "关联规则不存在");
      }

      await prisma.domainAssociation.delete({ where: { id } });
      return reply.status(204).send();
    }
  );
}
