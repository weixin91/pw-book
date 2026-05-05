import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { prisma } from "../db/prisma.js";

const cipherSchema = z.object({
  id: z.string().min(1),
  type: z.number().int(),
  data: z.string().min(1),
  favorite: z.boolean().optional().default(false),
  reprompt: z.number().int().optional().default(0),
  modifiedAt: z.string().datetime().optional(),
});

export async function cipherRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: z.infer<typeof cipherSchema> }>(
    "/",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const body = cipherSchema.parse(request.body);

      const existing = await prisma.cipher.findUnique({
        where: { id: body.id },
      });
      if (existing) {
        throw new ApiError("VALIDATION_ERROR", 400, "凭据 ID 已存在");
      }

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
    }
  );

  app.put<{ Params: { id: string }; Body: Omit<z.infer<typeof cipherSchema>, "id"> }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;
      const body = cipherSchema.omit({ id: true }).parse(request.body);

      const existing = await prisma.cipher.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在");
      }

      const cipher = await prisma.cipher.update({
        where: { id },
        data: {
          type: body.type,
          data: body.data,
          favorite: body.favorite,
          reprompt: body.reprompt,
          modifiedAt: body.modifiedAt ? new Date(body.modifiedAt) : new Date(),
        },
      });

      return reply.send(cipher);
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      const existing = await prisma.cipher.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在");
      }

      await prisma.cipher.delete({ where: { id } });
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
        where: { id, userId },
      });
      if (!cipher) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "凭据不存在");
      }

      return reply.send(cipher);
    }
  );
}
