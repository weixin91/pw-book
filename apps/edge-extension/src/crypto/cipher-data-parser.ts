// Cipher 数据类型安全解析辅助
// 使用 shared-types 定义的标准类型

import type { CipherData } from "@pwbook/shared-types";

/**
 * 解析加密后的 Cipher JSON 数据
 * 提供类型安全访问，避免散落的类型断言
 */
export function parseCipherData(json: string): CipherData {
  return JSON.parse(json) as CipherData;
}

/**
 * 从 CipherData 中安全获取 login 数据
 */
export function getLoginData(data: CipherData): {
  username: string;
  password: string;
  uris: Array<{ uri: string; match: number | null }>;
  totp: string | null;
} {
  const login = data.login;
  return {
    username: login?.username ?? "",
    password: login?.password ?? "",
    uris: login?.uris ?? [],
    totp: login?.totp ?? null,
  };
}

/**
 * 从 CipherData 中安全获取 passkey 数据
 */
export function getPasskeyData(data: CipherData): {
  credentialId: string;
  privateKey: string;
  publicKey: string;
  rpId: string;
  rpName?: string;
  userHandle: string;
  userName?: string;
  userDisplayName?: string;
  counter: number;
  createdAt: string;
} | null {
  return data.passkey ?? null;
}

/**
 * 检查 CipherData 是否包含 passkey
 */
export function hasPasskey(data: CipherData): boolean {
  return data.passkey?.credentialId != null;
}