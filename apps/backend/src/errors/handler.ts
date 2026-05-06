import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: Error, _request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof ApiError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            details: error.details ?? {},
          },
        });
      }

      // Zod 校验错误：返回 400 与字段级错误明细，避免落入 500
      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "请求参数无效",
            details: { issues: error.issues },
          },
        });
      }

      // Prisma 已知错误：唯一约束 → 409，记录不存在 → 404，外键约束 → 400
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          return reply.status(409).send({
            error: {
              code: "RESOURCE_CONFLICT",
              message: "资源已存在",
              details: {},
            },
          });
        }
        if (error.code === "P2025") {
          return reply.status(404).send({
            error: {
              code: "RESOURCE_NOT_FOUND",
              message: "请求的资源不存在",
              details: {},
            },
          });
        }
        if (error.code === "P2003") {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "外键约束失败",
              details: {},
            },
          });
        }
      }

      app.log.error(error);
      return reply.status(500).send({
        error: {
          code: "INTERNAL_ERROR",
          message: process.env.NODE_ENV === "production" ? "服务器内部错误" : error.message,
          details: {},
        },
      });
    }
  );

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "请求的资源不存在",
        details: {},
      },
    });
  });
}
