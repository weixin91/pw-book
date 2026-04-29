// Background WebAuthn 处理逻辑
// 从 background.ts 提取以便独立测试

import { StorageService } from "../platform/storage.js";
import { decryptCipherData, encryptCipherData } from "../crypto/crypto-service.js";
import { PendingChangesQueue } from "../sync/pending-changes.js";
import {
  generatePasskey,
  importPasskeyPrivateKey,
  exportPublicKeyRaw,
  buildAuthenticatorData,
  encodeCoseKeyEs256,
  encodeAttestationObjectNone,
  signAssertion,
  base64UrlEncode,
  base64UrlDecode,
  CIPHER_TYPE_PASSKEY,
  type PasskeyData,
} from "../crypto/passkey-storage.js";

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
  const candidates: SaveCandidate[] = [];

  for (const cipher of ciphers) {
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plain) as Record<string, unknown>;
      const login = (data.login as Record<string, unknown>) ?? {};
      const uris = (login.uris as Array<{ uri?: string }>) ?? [];

      // 只展示有 login 数据的凭据
      const uriStr = uris[0]?.uri ?? "";
      const uriHost = uriStr ? (() => {
        try { return new URL(uriStr).hostname.toLowerCase(); } catch { return ""; }
      })() : "";

      // 简单匹配：host 相等或互为子域
      const isMatch = uriHost && (uriHost === host || host.endsWith("." + uriHost) || uriHost.endsWith("." + host));

      if (isMatch) {
        candidates.push({
          id: cipher.id,
          name: String(data.name || ""),
          username: String(login.username || ""),
          uri: uriStr,
        });
      }
    } catch {
      // 跳过无法解密的凭据
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
  const matches: GetMatch[] = [];

  for (const cipher of ciphers) {
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plain) as Record<string, unknown>;
      const passkey = data.passkey as PasskeyData | undefined;
      if (!passkey) continue;

      // rpId 匹配：直接相等，或当前 origin host 以 passkey.rpId 结尾（支持子域）
      const originHost = new URL(origin).hostname.toLowerCase();
      const passkeyRpId = passkey.rpId.toLowerCase();
      const rpIdMatch = passkeyRpId === rpId ||
        (passkeyRpId === originHost) ||
        (originHost.endsWith("." + passkeyRpId));

      if (!rpIdMatch) {
        console.log("[PWBook BG] queryPasskeyGetMatches: rpId 不匹配, passkey.rpId=", passkey.rpId, "computed rpId=", rpId, "originHost=", originHost);
        continue;
      }

      if (allowedIds.size > 0 && !allowedIds.has(passkey.credentialId)) {
        console.log("[PWBook BG] queryPasskeyGetMatches: credentialId 不匹配, passkey.credentialId=", passkey.credentialId, "allowedIds=", Array.from(allowedIds));
        continue;
      }

      console.log("[PWBook BG] queryPasskeyGetMatches: 匹配成功, cipherId=", cipher.id, "name=", data.name, "rpId=", passkey.rpId);
      matches.push({
        id: cipher.id,
        name: String(data.name || ""),
        rpId: passkey.rpId,
        credentialId: passkey.credentialId,
      });
    } catch {
      // 跳过无法解密的凭据
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
    const existingData = JSON.parse(plain) as Record<string, unknown>;

    const updatedData = {
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

    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: targetId,
      operation: "UPDATE",
      encryptedData: resultEncrypted,
      clientTimestamp: new Date().toISOString(),
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

    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: targetId,
      operation: "CREATE",
      encryptedData: resultEncrypted,
      clientTimestamp: new Date().toISOString(),
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
  let matched: { cipher: typeof ciphers[number]; passkey: PasskeyData; data: Record<string, unknown> } | null = null;

  for (const cipher of ciphers) {
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plain) as Record<string, unknown>;
      const passkey = data.passkey as PasskeyData | undefined;
      if (!passkey || passkey.rpId !== rpId) continue;
      if (allowedIds.size > 0 && !allowedIds.has(passkey.credentialId)) continue;
      if (selectedCredentialId && passkey.credentialId !== selectedCredentialId) continue;
      matched = { cipher, passkey, data };
      if (selectedCredentialId) break; // 找到指定的就停
    } catch {
      // 跳过无法解密的凭据
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
  const updatedData = {
    ...matched.data,
    lastUsedAt: new Date().toISOString(),
    passkey: { ...passkey, counter: newCounter },
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
    await queue.enqueue({
      cipherId: ciphers[idx].id,
      operation: "UPDATE",
      encryptedData: encrypted,
      clientTimestamp: new Date().toISOString(),
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
