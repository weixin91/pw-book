// Background WebAuthn 处理逻辑
// 从 background.ts 提取以便独立测试

import { StorageService } from "../platform/storage.js";
import { decryptCipherData, encryptCipherData } from "../crypto/crypto-service.js";
import { PendingChangesQueue } from "../sync/pending-changes.js";
import { parseCipherData, getLoginData, getPasskeyData } from "../crypto/cipher-data-parser.js";
import { CipherIndexService } from "../crypto/cipher-index.js";
import type { CipherData } from "@pwbook/shared-types";
import {
  generatePasskey,
  importPasskeyPrivateKey,
  exportPublicKeyRaw,
  buildAuthenticatorData,
  encodeCoseKeyEs256,
  encodeAttestationObjectNone,
  signAssertion,
} from "../crypto/passkey-storage.js";
import { base64UrlEncode, base64UrlDecode } from "../platform/base64.js";

const PASSKEY_AAGUID = new Uint8Array(16); // 全 0：软件认证器

export interface WebAuthnEnvelope {
  id: string;
  rawId: BufferMarker;
  response: Record<string, BufferMarker | string | undefined>;
}

export interface BufferMarker {
  __pwbookBytes: string;
}

export function bytes(buf: Uint8Array): BufferMarker {
  return { __pwbookBytes: base64UrlEncode(buf) };
}

export function deserializeBuffers(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(deserializeBuffers);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__pwbookBytes === "string" && Object.keys(obj).length === 1) {
      return base64UrlDecode(obj.__pwbookBytes as string);
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) out[k] = deserializeBuffers(obj[k]);
    return out;
  }
  return value;
}

export function originToRpId(origin: string, requested?: string): string {
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    host = origin;
  }
  if (!requested) return host;
  // RP 仅允许指定与当前 host 相等或为其父域
  const reqLower = requested.toLowerCase();
  const hostLower = host.toLowerCase();
  if (hostLower === reqLower) return reqLower;
  if (hostLower.endsWith("." + reqLower)) return reqLower;
  // 不合法的 rpId，使用当前 host 兜底
  return hostLower;
}

export function buildClientDataJSON(type: "webauthn.create" | "webauthn.get", challenge: Uint8Array, origin: string): Uint8Array {
  const json = JSON.stringify({
    type,
    challenge: base64UrlEncode(challenge),
    origin,
    crossOrigin: false,
  });
  return new TextEncoder().encode(json);
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as unknown as BufferSource));
}

// ── 查询：保存 Passkey 时匹配的候选 LOGIN 凭据 ──

export interface SaveCandidate {
  id: string;
  name: string;
  username: string;
  uri: string;
}

export async function queryPasskeySaveCandidates(origin: string): Promise<SaveCandidate[]> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) return [];

  let host = "";
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return [];
  }

  const ciphers = await StorageService.getCiphers();

  // 先从索引筛选匹配域名的 cipher ID
  const indexEntries = await CipherIndexService.getAll();
  const matchedIds = CipherIndexService.filterPasskeyCandidates(indexEntries, host, []);

  // 只解密匹配的凭据
  const candidates: SaveCandidate[] = [];
  for (const cipherId of matchedIds) {
    const cipher = ciphers.find((c) => c.id === cipherId);
    if (!cipher) continue;
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = parseCipherData(plain);
      const login = getLoginData(data);
      const uriStr = login.uris[0]?.uri ?? "";
      candidates.push({
        id: cipher.id,
        name: data.name || "",
        username: login.username,
        uri: uriStr,
      });
    } catch (e) {
      console.error("[PWBook] queryPasskeySaveCandidates 解密失败:", cipher.id, e);
    }
  }

  return candidates;
}

// ── 查询：使用 Passkey 时匹配的凭据 ──

export interface GetMatch {
  id: string;
  name: string;
  rpId: string;
  credentialId: string;
}

export async function queryPasskeyGetMatches(origin: string, publicKeyRaw: unknown): Promise<GetMatch[]> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) {
    console.log("[PWBook BG] queryPasskeyGetMatches: 保险库未解锁");
    return [];
  }

  const publicKey = deserializeBuffers(publicKeyRaw) as Record<string, unknown>;
  const rpIdRequested = typeof publicKey.rpId === "string" ? publicKey.rpId : undefined;
  const rpId = originToRpId(origin, rpIdRequested);
  const allowList = Array.isArray(publicKey.allowCredentials)
    ? (publicKey.allowCredentials as Array<Record<string, unknown>>)
    : [];
  const allowedIds = new Set<string>(
    allowList
      .map((c) => (c.id instanceof Uint8Array ? base64UrlEncode(c.id) : null))
      .filter((v): v is string => !!v)
  );

  console.log("[PWBook BG] queryPasskeyGetMatches: origin=", origin, "rpIdRequested=", rpIdRequested, "computed rpId=", rpId, "allowedIds count=", allowedIds.size);

  const ciphers = await StorageService.getCiphers();

  // 先从索引筛选匹配 rpId 的 passkey cipher ID
  const indexEntries = await CipherIndexService.getAll();
  const matchedIds = CipherIndexService.filterByRpId(indexEntries, rpId);

  // 只解密匹配的凭据
  const matches: GetMatch[] = [];
  for (const cipherId of matchedIds) {
    const cipher = ciphers.find((c) => c.id === cipherId);
    if (!cipher) continue;
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = parseCipherData(plain);
      const passkey = getPasskeyData(data);
      if (!passkey) continue;

      // 允许列表过滤
      if (allowedIds.size > 0 && !allowedIds.has(passkey.credentialId)) {
        console.log("[PWBook BG] queryPasskeyGetMatches: credentialId 不匹配, passkey.credentialId=", passkey.credentialId, "allowedIds=", Array.from(allowedIds));
        continue;
      }

      console.log("[PWBook BG] queryPasskeyGetMatches: 匹配成功, cipherId=", cipher.id, "name=", data.name, "rpId=", passkey.rpId);
      matches.push({
        id: cipher.id,
        name: data.name || "",
        rpId: passkey.rpId,
        credentialId: passkey.credentialId,
      });
    } catch (e) {
      console.error("[PWBook] queryPasskeyGetMatches 解密失败:", cipher.id, e);
    }
  }

  console.log("[PWBook BG] queryPasskeyGetMatches: 总匹配数=", matches.length);
  return matches;
}

// ── WebAuthn Create ──

export async function handleWebAuthnCreate(
  origin: string,
  publicKeyRaw: unknown,
  targetCipherId?: string
): Promise<WebAuthnEnvelope> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) throw new Error("保险库未解锁，无法创建 Passkey");

  const publicKey = deserializeBuffers(publicKeyRaw) as Record<string, unknown>;
  const rp = (publicKey.rp as Record<string, unknown>) ?? {};
  const user = (publicKey.user as Record<string, unknown>) ?? {};
  const rpIdRequested = typeof rp.id === "string" ? rp.id : undefined;
  const rpId = originToRpId(origin, rpIdRequested);
  const rpName = typeof rp.name === "string" ? rp.name : undefined;
  const challenge = publicKey.challenge instanceof Uint8Array ? publicKey.challenge : new Uint8Array(0);
  const userHandle = user.id instanceof Uint8Array ? user.id : crypto.getRandomValues(new Uint8Array(16));
  const userName = typeof user.name === "string" ? user.name : undefined;
  const userDisplayName = typeof user.displayName === "string" ? user.displayName : undefined;

  const material = await generatePasskey({
    rpId,
    rpName,
    userHandle,
    userName,
    userDisplayName,
  });

  const { x, y } = await exportPublicKeyRaw(material.publicKey);
  const cose = encodeCoseKeyEs256(x, y);
  const credentialIdBytes = base64UrlDecode(material.data.credentialId);

  const authData = await buildAuthenticatorData({
    rpId,
    signCount: 0,
    userPresent: true,
    userVerified: true,
    attestedCredentialData: {
      aaguid: PASSKEY_AAGUID,
      credentialId: credentialIdBytes,
      publicKeyCose: cose,
    },
  });

  const attestationObject = encodeAttestationObjectNone(authData);
  const clientDataJSON = buildClientDataJSON("webauthn.create", challenge, origin);

  const ciphers = await StorageService.getCiphers();
  let resultEncrypted: string;
  let targetId: string;

  if (targetCipherId) {
    // 保存到现有凭据
    const idx = ciphers.findIndex((c) => c.id === targetCipherId);
    if (idx < 0) throw new Error("目标凭据不存在");

    const plain = await decryptCipherData(ciphers[idx].data, userKey);
    const existingData = parseCipherData(plain);

    const updatedData: CipherData = {
      ...existingData,
      lastUsedAt: new Date().toISOString(),
      passkey: material.data,
    };

    resultEncrypted = await encryptCipherData(JSON.stringify(updatedData), userKey);
    ciphers[idx] = {
      ...ciphers[idx],
      data: resultEncrypted,
      modifiedAt: new Date().toISOString(),
    };
    targetId = targetCipherId;

    // 更新索引
    await CipherIndexService.updateOne(targetId, updatedData);

    const queue = new PendingChangesQueue();
    const updatedCipher = ciphers[idx];
    await queue.enqueue({
      cipherId: targetId,
      operation: "UPDATE",
      encryptedData: resultEncrypted,
      clientTimestamp: new Date().toISOString(),
      userId: updatedCipher.userId,
      type: updatedCipher.type,
      favorite: updatedCipher.favorite,
      reprompt: updatedCipher.reprompt,
      createdAt: updatedCipher.createdAt,
      modifiedAt: updatedCipher.modifiedAt,
    });
  } else {
    // 新建 LOGIN 凭据
    const cipherData = {
      name: rpName ?? rpId,
      notes: null,
      fields: [],
      lastUsedAt: new Date().toISOString(),
      login: {
        username: userName || null,
        password: null,
        uris: [{ uri: `https://${rpId}`, match: null }],
        totp: null,
      },
      passkey: material.data,
    };

    resultEncrypted = await encryptCipherData(JSON.stringify(cipherData), userKey);
    const cipher = {
      id: crypto.randomUUID(),
      userId: "",
      type: 1, // LOGIN
      data: resultEncrypted,
      favorite: false,
      reprompt: 0,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    ciphers.push(cipher);
    targetId = cipher.id;

    // 更新索引
    const parsedCipherData = parseCipherData(JSON.stringify(cipherData));
    await CipherIndexService.updateOne(targetId, parsedCipherData);

    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: targetId,
      operation: "CREATE",
      encryptedData: resultEncrypted,
      clientTimestamp: new Date().toISOString(),
      userId: cipher.userId,
      type: cipher.type,
      favorite: cipher.favorite,
      reprompt: cipher.reprompt,
      createdAt: cipher.createdAt,
      modifiedAt: cipher.modifiedAt,
    });
  }

  await StorageService.setCiphers(ciphers);

  return {
    id: material.data.credentialId,
    rawId: bytes(credentialIdBytes),
    response: {
      clientDataJSON: bytes(clientDataJSON),
      attestationObject: bytes(attestationObject),
    },
  };
}

// ── WebAuthn Get ──

export async function handleWebAuthnGet(
  origin: string,
  publicKeyRaw: unknown,
  selectedCredentialId?: string
): Promise<WebAuthnEnvelope> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) throw new Error("保险库未解锁，无法使用 Passkey");

  const publicKey = deserializeBuffers(publicKeyRaw) as Record<string, unknown>;
  const rpIdRequested = typeof publicKey.rpId === "string" ? publicKey.rpId : undefined;
  const rpId = originToRpId(origin, rpIdRequested);
  const challenge = publicKey.challenge instanceof Uint8Array ? publicKey.challenge : new Uint8Array(0);
  const allowList = Array.isArray(publicKey.allowCredentials)
    ? (publicKey.allowCredentials as Array<Record<string, unknown>>)
    : [];
  const allowedIds = new Set<string>(
    allowList
      .map((c) => (c.id instanceof Uint8Array ? base64UrlEncode(c.id) : null))
      .filter((v): v is string => !!v)
  );

  const ciphers = await StorageService.getCiphers();
  let matched: { cipher: typeof ciphers[number]; passkey: NonNullable<ReturnType<typeof getPasskeyData>>; data: CipherData } | null = null;

  for (const cipher of ciphers) {
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = parseCipherData(plain);
      const passkey = getPasskeyData(data);
      if (!passkey || passkey.rpId !== rpId) continue;
      if (allowedIds.size > 0 && !allowedIds.has(passkey.credentialId)) continue;
      if (selectedCredentialId && passkey.credentialId !== selectedCredentialId) continue;
      matched = { cipher, passkey, data };
      if (selectedCredentialId) break; // 找到指定的就停
    } catch (e) {
      console.error("[PWBook] handleWebAuthnGet 解密失败:", cipher.id, e);
    }
  }

  if (!matched) {
    throw new Error("当前站点没有可用的 Passkey");
  }

  const passkey = matched.passkey;
  const newCounter = (passkey.counter ?? 0) + 1;
  const authData = await buildAuthenticatorData({
    rpId,
    signCount: newCounter,
    userPresent: true,
    userVerified: true,
  });

  const clientDataJSON = buildClientDataJSON("webauthn.get", challenge, origin);
  const clientDataHash = await sha256Bytes(clientDataJSON);
  const privateKey = await importPasskeyPrivateKey(passkey.privateKey);
  const signature = await signAssertion(privateKey, authData, clientDataHash);

  // 更新 counter 并重新加密保存
  const updatedData: CipherData = {
    ...matched.data,
    lastUsedAt: new Date().toISOString(),
    passkey: { ...matched.passkey, counter: newCounter },
  };
  const encrypted = await encryptCipherData(JSON.stringify(updatedData), userKey);
  const idx = ciphers.findIndex((c) => c.id === matched!.cipher.id);
  if (idx >= 0) {
    ciphers[idx] = {
      ...ciphers[idx],
      data: encrypted,
      modifiedAt: new Date().toISOString(),
    };
    await StorageService.setCiphers(ciphers);

    const queue = new PendingChangesQueue();
    const updatedCipher = ciphers[idx];
    await queue.enqueue({
      cipherId: updatedCipher.id,
      operation: "UPDATE",
      encryptedData: encrypted,
      clientTimestamp: new Date().toISOString(),
      userId: updatedCipher.userId,
      type: updatedCipher.type,
      favorite: updatedCipher.favorite,
      reprompt: updatedCipher.reprompt,
      createdAt: updatedCipher.createdAt,
      modifiedAt: updatedCipher.modifiedAt,
    });
  }

  const credentialIdBytes = base64UrlDecode(passkey.credentialId);
  // userHandle 容错：部分导入数据可能不是合法 base64url，fallback 到 UTF-8
  let userHandleBytes: Uint8Array;
  try {
    userHandleBytes = base64UrlDecode(passkey.userHandle);
  } catch {
    userHandleBytes = new TextEncoder().encode(passkey.userHandle);
  }
  return {
    id: passkey.credentialId,
    rawId: bytes(credentialIdBytes),
    response: {
      clientDataJSON: bytes(clientDataJSON),
      authenticatorData: bytes(authData),
      signature: bytes(signature),
      userHandle: bytes(userHandleBytes),
    },
  };
}
