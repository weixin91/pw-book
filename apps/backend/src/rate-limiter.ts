// 登录速率限制（基于账号/邮箱）
// 防止暴力破解密码

import type { FastifyRequest, FastifyReply, preValidationHookHandler } from "fastify";
import { ApiError } from "./errors/handler.js";

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
}

// 内存存储（单实例足够，SQLite 后端本身单进程）
const loginAttempts = new Map<string, RateLimitEntry>();
const recoverAttempts = new Map<string, RateLimitEntry>();

const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 60_000; // 1 分钟窗口

// 恢复密钥：更严格的限制，防止暴力枚举
const MAX_RECOVER_ATTEMPTS = 5;
const RECOVER_WINDOW_MS = 3600_000; // 1 小时窗口

/**
 * 检查邮箱是否可继续尝试登录
 */
function checkRateLimit(email: string): boolean {
  const normalizedEmail = email.toLowerCase();
  const entry = loginAttempts.get(normalizedEmail);

  if (!entry) return true;

  const elapsed = Date.now() - entry.firstAttempt;
  if (elapsed > LOGIN_WINDOW_MS) {
    // 窗口过期，清除记录
    loginAttempts.delete(normalizedEmail);
    return true;
  }

  return entry.count < MAX_LOGIN_ATTEMPTS;
}

/**
 * 检查邮箱是否可继续尝试恢复（更严格）
 */
function checkRecoverRateLimit(email: string): boolean {
  const normalizedEmail = email.toLowerCase();
  const entry = recoverAttempts.get(normalizedEmail);

  if (!entry) return true;

  const elapsed = Date.now() - entry.firstAttempt;
  if (elapsed > RECOVER_WINDOW_MS) {
    // 窗口过期，清除记录
    recoverAttempts.delete(normalizedEmail);
    return true;
  }

  return entry.count < MAX_RECOVER_ATTEMPTS;
}

/**
 * 记录一次失败尝试
 */
export function recordLoginAttempt(email: string): void {
  const normalizedEmail = email.toLowerCase();
  const existing = loginAttempts.get(normalizedEmail);

  if (existing) {
    existing.count++;
  } else {
    loginAttempts.set(normalizedEmail, {
      count: 1,
      firstAttempt: Date.now(),
    });
  }
}

/**
 * 记录一次恢复失败尝试
 */
export function recordRecoverAttempt(email: string): void {
  const normalizedEmail = email.toLowerCase();
  const existing = recoverAttempts.get(normalizedEmail);

  if (existing) {
    existing.count++;
  } else {
    recoverAttempts.set(normalizedEmail, {
      count: 1,
      firstAttempt: Date.now(),
    });
  }
}

/**
 * 登录成功后清除记录
 */
export function clearLoginAttempts(email: string): void {
  loginAttempts.delete(email.toLowerCase());
}

/**
 * 恢复成功后清除记录
 */
export function clearRecoverAttempts(email: string): void {
  recoverAttempts.delete(email.toLowerCase());
}

/**
 * Fastify preValidation hook：检查登录速率限制
 */
export const loginRateLimitHook: preValidationHookHandler = (
  request: FastifyRequest,
  _reply: FastifyReply,
  done: (err?: Error) => void
) => {
  const body = request.body as { email?: string } | undefined;
  const email = body?.email;

  if (!email) {
    // 无邮箱，跳过检查（后续验证会报错）
    done();
    return;
  }

  if (!checkRateLimit(email)) {
    done(new ApiError("RATE_LIMITED", 429, "尝试次数过多，请 1 分钟后重试"));
    return;
  }

  done();
};

/**
 * Fastify preValidation hook：检查恢复速率限制（更严格）
 */
export const recoverRateLimitHook: preValidationHookHandler = (
  request: FastifyRequest,
  _reply: FastifyReply,
  done: (err?: Error) => void
) => {
  const body = request.body as { email?: string } | undefined;
  const email = body?.email;

  if (!email) {
    done();
    return;
  }

  if (!checkRecoverRateLimit(email)) {
    done(new ApiError("RATE_LIMITED", 429, "恢复尝试次数过多，请 1 小时后重试"));
    return;
  }

  done();
};