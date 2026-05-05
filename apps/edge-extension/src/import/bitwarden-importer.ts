// Bitwarden 未加密 JSON 导出解析与导入转换

import type { Cipher, CipherData, LoginUri, CipherType } from "@pwbook/shared-types";
import { encryptCipherData, decryptCipherData } from "../crypto/crypto-service.js";
import {
  base64Encode,
  base64Decode,
  base64UrlEncode,
  base64UrlDecode,
} from "../crypto/passkey-storage.js";

// --- Bitwarden 导出类型定义 ---

export interface BitwardenUri {
  uri: string;
}

export interface BitwardenFido2Credential {
  credentialId: string;
  keyType: string;
  keyAlgorithm: string;
  keyCurve: string;
  keyValue: string;
  rpId: string;
  userHandle: string;
  userName: string | null;
  counter: string;
  rpName: string | null;
  userDisplayName: string | null;
  discoverable: string;
  creationDate: string;
}

export interface BitwardenLogin {
  uris: BitwardenUri[] | null;
  fido2Credentials: BitwardenFido2Credential[] | null;
  username: string | null;
  password: string | null;
  totp: string | null;
}

export interface BitwardenItem {
  passwordHistory: unknown[] | null;
  revisionDate: string;
  creationDate: string;
  id: string;
  type: number;
  reprompt: number;
  name: string | null;
  notes: string | null;
  favorite: boolean;
  fields: unknown[] | null;
  login: BitwardenLogin | null;
  collectionIds: unknown;
}

export interface BitwardenExport {
  encrypted: boolean;
  folders: unknown[];
  items: BitwardenItem[];
}

// --- 解析 ---

export interface ParseResult {
  export: BitwardenExport;
  loginCount: number;
  passkeyCount: number;
}

export function parseBitwardenExport(jsonText: string): ParseResult {
  const parsed = JSON.parse(jsonText) as BitwardenExport;
  if (typeof parsed.encrypted !== "boolean") {
    throw new Error("非法的 Bitwarden 导出格式：缺少 encrypted 字段");
  }
  if (parsed.encrypted) {
    throw new Error("不支持导入加密的 Bitwarden 导出文件，请先导出为未加密格式");
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error("非法的 Bitwarden 导出格式：items 不是数组");
  }
  const items = parsed.items || [];
  const loginCount = items.filter((i) => i.type === 1 && i.login).length;
  const passkeyCount = items.filter(
    (i) => i.type === 1 && i.login?.fido2Credentials && i.login.fido2Credentials.length > 0
  ).length;
  return { export: parsed, loginCount, passkeyCount };
}

// --- 公钥提取 ---

export async function extractSpkiFromPkcs8(pkcs8Base64: string): Promise<string | null> {
  try {
    const pkcs8 = base64Decode(pkcs8Base64);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8 as unknown as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"]
    );
    const jwk = await crypto.subtle.exportKey("jwk", privateKey);
    if (!jwk.x || !jwk.y) return null;

    const x = base64UrlToBytes(jwk.x);
    const y = base64UrlToBytes(jwk.y);
    const raw = new Uint8Array(65);
    raw[0] = 0x04;
    raw.set(x, 1);
    raw.set(y, 33);

    const publicKey = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
    const spki = await crypto.subtle.exportKey("spki", publicKey);
    return base64Encode(new Uint8Array(spki));
  } catch {
    return null;
  }
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padLen));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// --- Credential ID / UserHandle 标准化 ---

function normalizeCredentialId(credId: string): string {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(credId)) {
    const hex = credId.replace(/-/g, "");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return base64UrlEncode(bytes);
  }
  return credId;
}

function normalizeUserHandle(userHandle: string): string {
  if (!userHandle) return userHandle;
  // 尝试验证是否为合法 base64url：能解码且重新编码后一致
  try {
    const decoded = base64UrlDecode(userHandle);
    const reEncoded = base64UrlEncode(decoded);
    if (reEncoded === userHandle.replace(/=+$/, "")) {
      return userHandle;
    }
  } catch {
    // 不是合法 base64url，当作 UTF-8 字符串重新编码
  }
  const encoder = new TextEncoder();
  return base64UrlEncode(encoder.encode(userHandle));
}

// --- 去重键生成 ---

function buildDedupKey(name: string, username: string | null, uri: string | null): string {
  return `${name.trim().toLowerCase()}|${(username || "").trim().toLowerCase()}|${(uri || "").trim().toLowerCase()}`;
}

// --- 映射与导入 ---

export interface ImportResult {
  ciphers: Cipher[];
  skipped: number;
}

export async function convertBitwardenItems(
  items: BitwardenItem[],
  userKey: Uint8Array,
  existingCiphers: Cipher[],
  userId: string
): Promise<ImportResult> {
  // 构建现有凭据去重索引
  const existingKeys = new Set<string>();
  for (const cipher of existingCiphers) {
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plain) as CipherData;
      const name = data.name || "";
      const username = data.login?.username || null;
      const uri = data.login?.uris?.[0]?.uri || null;
      existingKeys.add(buildDedupKey(name, username, uri));
    } catch {
      // 忽略无法解密的现有凭据
    }
  }

  const newCiphers: Cipher[] = [];
  let skipped = 0;

  for (const item of items) {
    if (item.type !== 1 || !item.login) continue;

    const name = item.name || item.login.uris?.[0]?.uri || "未命名";
    const username = item.login.username;
    const uri = item.login.uris?.[0]?.uri || null;

    const dedupKey = buildDedupKey(name, username, uri);
    if (existingKeys.has(dedupKey)) {
      skipped++;
      console.log(`[BitwardenImport] skip duplicate: name="${name}" username="${username}" uri="${uri}"`);
      continue;
    }
    // 将新条目也加入去重键，防止同一次导入出现重复
    existingKeys.add(dedupKey);

    // 构建 CipherData
    const cleanUris: LoginUri[] = (item.login.uris || [])
      .filter((u): u is BitwardenUri => u != null && typeof u.uri === "string")
      .map((u) => u.uri.trim())
      .filter((u) => u.length > 0)
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .map((u) => ({ uri: u, match: null }));

    const cipherData: CipherData = {
      name,
      notes: item.notes || null,
      fields: [],
      lastUsedAt: null,
      login: {
        username: username || null,
        password: item.login.password || null,
        uris: cleanUris,
        totp: item.login.totp || null,
      },
    };

    // 处理 Passkey（仅取第一条）
    const fido2 = item.login.fido2Credentials?.[0];
    if (fido2) {
      const publicKey = await extractSpkiFromPkcs8(fido2.keyValue);
      cipherData.passkey = {
        credentialId: normalizeCredentialId(fido2.credentialId),
        privateKey: fido2.keyValue,
        publicKey: publicKey || "",
        rpId: fido2.rpId,
        rpName: fido2.rpName || undefined,
        userHandle: normalizeUserHandle(fido2.userHandle),
        userName: fido2.userName || undefined,
        userDisplayName: fido2.userDisplayName || undefined,
        counter: parseInt(fido2.counter, 10) || 0,
        createdAt: fido2.creationDate,
      };
    }

    const encryptedData = await encryptCipherData(JSON.stringify(cipherData), userKey);

    const cipher: Cipher = {
      id: crypto.randomUUID(),
      userId,
      type: 1 as CipherType, // LOGIN
      data: encryptedData,
      favorite: item.favorite || false,
      reprompt: item.reprompt || 0,
      createdAt: item.creationDate || new Date().toISOString(),
      modifiedAt: item.revisionDate || new Date().toISOString(),
    };

    newCiphers.push(cipher);
  }

  return { ciphers: newCiphers, skipped };
}
