import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { prisma } from "../db/prisma.js";

const cipherSchema = z.object({
  id: z.string().uuid(),
  type: z.number().int(),
  data: z.string().min(1),
  favorite: z.boolean().optional().default(false),
  reprompt: z.number().int().optional().default(0),
  modifiedAt: z.string().datetime().optional(),
});

export async function cipherRoutes(app: FastifyInstance): Promise<void> {
  // 列出当前用户软删除的凭据(回收站)
  app.get("/trash", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;
    const ciphers = await prisma.cipher.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
    });
    return reply.send(ciphers);
  });

  app.post<{ Body: z.infer<typeof cipherSchema> }>(
    "/",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const body = cipherSchema.parse(request.body);

      try {
        const cipher = await prisma.cipher.create({
          data: {
            id: body.id,
            userId,
            type: body.type,
            data: body.data,
            favorite: body.favorite,
            reprompt: body.reprompt,
            modifiedAt: body.modifiedAt ? new Date(body.modifiedAt) : new Date(),
          },
        });
        return reply.status(201).send(cipher);
      } catch (err) {
        // 唯一约束冲突时返回 409，避免泄露其他用户是否占用了同一 id
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ApiError("VALIDATION_ERROR", 409, "凭据创建失败");
        }
        throw err;
      }
    }
  );

  app.put<{ Params: { id: string }; Body: Omit<z.infer<typeof cipherSchema>, "id"> }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;
      const body = cipherSchema.omit({ id: true }).parse(request.body);

      // 单语句原子写：仅当 id+userId 匹配且未被软删时才更新，避免 TOCTOU
      const result = await prisma.cipher.updateMany({
        where: { id, userId, deletedAt: null },
        data: {
          type: body.type,
          data: body.data,
          favorite: body.favorite,
          reprompt: body.reprompt,
          modifiedAt: body.modifiedAt ? new Date(body.modifiedAt) : new Date(),
        },
      });

      if (result.count === 0) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在");
      }

      const cipher = await prisma.cipher.findUnique({ where: { id } });
      return reply.send(cipher);
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      // 原子删除：仅删除当前用户拥有的记录
      const result = await prisma.cipher.deleteMany({
        where: { id, userId },
      });

      if (result.count === 0) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在");
      }

      return reply.status(204).send();
    }
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      const cipher = await prisma.cipher.findFirst({
        where: { id, userId, deletedAt: null },
      });
      if (!cipher) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在");
      }

      return reply.send(cipher);
    }
  );
}
