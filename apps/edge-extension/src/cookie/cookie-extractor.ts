// Cookie 提取模块
// 封装 chrome.cookies.getAll，格式化并过滤敏感 Cookie

import { getBaseDomain } from "../autofill/domain-utils.js";

export interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "no_restriction" | "lax" | "strict" | "unspecified";
  partitioned?: boolean;
  expirationDate?: number;
  hostOnly: boolean;
  session: boolean;
  storeId?: string;
}

export interface LocalStorageItem {
  key: string;
  value: string;
}

export interface CookieData {
  domain: string;
  cookies: CookieItem[];
  localStorageItems?: LocalStorageItem[];
  userAgent?: string;
  createdAt: number;
  updatedAt: number;
}

/** 敏感 Cookie 名称模式，提取时跳过 */
const SENSITIVE_PATTERNS = [
  /^sessionid$/i,
  /^phpsessid$/i,
  /^__Host-/i,
  /^__Secure-/i,
  /^csrf/i,
  /^xsrf/i,
  /^auth/i,
  /^token$/i,
  /^jwt/i,
];

function isSensitiveCookie(name: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(name));
}

/**
 * 提取某域名下的所有 Cookie
 * @param baseDomain 基础域名（如 example.com）
 */
export async function extractCookiesForDomain(baseDomain: string): Promise<CookieItem[]> {
  const allCookies = await chrome.cookies.getAll({});
  const matched = allCookies.filter((c) => {
    const cookieDomain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const cookieBase = getBaseDomain(cookieDomain);
    return cookieBase === baseDomain;
  });

  return matched
    .filter((c) => !isSensitiveCookie(c.name))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: (c.sameSite as CookieItem["sameSite"]) || "unspecified",
      expirationDate: c.expirationDate,
      hostOnly: c.hostOnly,
      session: c.session,
      storeId: c.storeId,
      partitioned: (c as unknown as Record<string, unknown>).partitioned as boolean | undefined,
    }));
}

/**
 * 构建 CookieData 对象
 */
export async function buildCookieData(
  baseDomain: string,
  localStorageItems?: LocalStorageItem[]
): Promise<CookieData> {
  const cookies = await extractCookiesForDomain(baseDomain);
  const now = Date.now();
  return {
    domain: baseDomain,
    cookies,
    localStorageItems,
    userAgent: navigator.userAgent,
    createdAt: now,
    updatedAt: now,
  };
}
