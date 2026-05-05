import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/jwt.js";
import { ApiError } from "../errors/handler.js";
import { prisma } from "../db/prisma.js";

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user!.sub;

    const devices = await prisma.device.findMany({
      where: { userId },
      orderBy: { lastSyncAt: "desc" },
    });

    return reply.send({
      data: devices.map((d) => ({
        ...d,
        isCurrentDevice: d.deviceId === request.user!.deviceId,
      })),
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { id } = request.params;

      const device = await prisma.device.findFirst({
        where: { id, userId },
      });
      if (!device) {
        throw new ApiError("RESOURCE_NOT_FOUND", 404, "设备不存在");
      }

      await prisma.device.delete({ where: { id } });
      return reply.status(204).send();
    }
  );
}
