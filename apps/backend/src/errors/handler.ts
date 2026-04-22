import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

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
