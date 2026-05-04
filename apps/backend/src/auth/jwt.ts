import { SignJWT, jwtVerify } from "jose";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ApiError } from "../errors/handler.js";

// 启动时校验 JWT_SECRET，防止使用默认值
const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  throw new Error("JWT_SECRET 环境变量必须配置且至少 32 字符");
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export interface JwtPayload {
  sub: string;
  email: string;
  securityStamp: string;
  deviceId?: string;
}

export async function createToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

export async function createRefreshToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { clockTolerance: 60 });
    return payload as unknown as JwtPayload;
  } catch {
    throw new ApiError("INVALID_TOKEN", 401, "Token 无效或已过期");
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError("INVALID_TOKEN", 401, "缺少认证令牌");
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  request.user = payload;
}

// 扩展 FastifyRequest 类型
declare module "fastify" {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
