import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { prisma } from "../db/prisma.js";

const domainAssocSchema = z.object({
  domains: z.array(z.string().min(1)),
  packageNames: z.array(z.string().min(1)).optional().default([]),
});

const domainAssocUpdateSchema = z.object({
  domains: z.array(z.string().min(1)).optional(),
  packageNames: z.array(z.string().min(1)).optional(),
});

function serialize(record: { id: string; userId: string; domains: string; packageNames: string; createdAt: Date }) {
  return {
    id: record.id,
    userId: record.userId,
    domains: JSON.parse(record.domains) as string[],
    packageNames: JSON.parse(record.packageNames) as string[],
    createdAt: record.createdAt.toISOString(),
  };
}

export async function domainAssocRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;

    const records = await prisma.domainAssociation.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      data: records.map(serialize),
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

      return reply.status(201).send(serialize(record));
    }
  );

  app.put<{ Params: { id: string }; Body: z.infer<typeof domainAssocUpdateSchema> }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;
      const body = domainAssocUpdateSchema.parse(request.body);

      const existing = await prisma.domainAssociation.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "关联规则不存在");
      }

      const updated = await prisma.domainAssociation.update({
        where: { id },
        data: {
          domains:
            body.domains !== undefined
              ? JSON.stringify(body.domains)
              : existing.domains,
          packageNames:
            body.packageNames !== undefined
              ? JSON.stringify(body.packageNames)
              : existing.packageNames,
        },
      });

      return reply.send(serialize(updated));
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
