// Background Service Worker — 核心业务逻辑、API 通信、保险库管理

import { BrowserApi } from "../platform/browser-api.js";
import { StorageService } from "../platform/storage.js";
import { decryptCipherData, encryptCipherData } from "../crypto/crypto-service.js";
import { startLockTimer, initIdleListener } from "./lock-timer.js";
import { PendingChangesQueue } from "../sync/pending-changes.js";
import { SyncScheduler } from "../sync/sync-scheduler.js";
import { parseUri, isUriMatch, type DomainAssocLite } from "../autofill/domain-utils.js";
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
  type PasskeyCipherData,
} from "../crypto/passkey-storage.js";

interface StoredFormData {
  tabId: number;
  url: string;
  username: string;
  password: string;
  timestamp: number;
}

// 后台暂存表单提交数据（用于处理登录后重定向）
const pendingFormData = new Map<number, StoredFormData>();
const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const FORM_DATA_TTL = 10_000; // 10 秒
const FALLBACK_DELAY = 5_000;  // 5 秒兜底：无导航也触发保存提示

function getPendingKey(tabId: number): string {
  return `_pwbook_pending_${tabId}`;
}

async function getAssocRules(): Promise<DomainAssocLite[]> {
  const list = await StorageService.getDomainAssociations();
  return list.map((r) => ({
    domains: r.domains ?? [],
    packageNames: r.packageNames ?? [],
  }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message !== "object" || message === null) return false;

  const msg = message as Record<string, unknown>;
  console.log("[PWBook BG] 收到消息:", msg.type, "来自 tab:", sender.tab?.id, "url:", sender.tab?.url);

  if (msg.type === "FORM_SUBMITTED" && sender.tab?.id && sender.tab.url) {
    const data: StoredFormData = {
      tabId: sender.tab.id,
      url: sender.tab.url,
      username: String(msg.username ?? ""),
      password: String(msg.password ?? ""),
      timestamp: Date.now(),
    };
    pendingFormData.set(sender.tab.id, data);
    // 持久化到 local storage，防止 Service Worker 终止后丢失
    chrome.storage.local.set({ [getPendingKey(sender.tab.id)]: data });

    // 取消旧定时器
    const oldTimer = pendingTimers.get(sender.tab.id);
    if (oldTimer) clearTimeout(oldTimer);

    // 启动兜底定时器：5 秒后若未触发导航，也弹出保存提示（兼容 SPA/AJAX 登录）
    const tabId = sender.tab.id;
    const timer = setTimeout(() => {
      const d = pendingFormData.get(tabId);
      if (!d) return;

      isCredentialAlreadySaved(d.url, d.username, d.password).then((exists) => {
        pendingFormData.delete(tabId);
        pendingTimers.delete(tabId);
        chrome.storage.local.remove(getPendingKey(tabId));

        if (exists) {
          console.log("[PWBook BG] 兜底定时器：凭据未变化，跳过保存提示");
          return;
        }

        console.log("[PWBook BG] 兜底定时器触发，发送保存提示（SPA/AJAX）");
        chrome.tabs.sendMessage(tabId, {
          type: "SHOW_SAVE_PROMPT",
          username: d.username,
          password: d.password,
          url: d.url,
        });
      });
    }, FALLBACK_DELAY);
    pendingTimers.set(tabId, timer);

    // 10 秒后清理
    setTimeout(() => {
      pendingFormData.delete(sender.tab?.id ?? data.tabId);
      pendingTimers.delete(sender.tab?.id ?? data.tabId);
      chrome.storage.local.remove(getPendingKey(sender.tab?.id ?? data.tabId));
    }, FORM_DATA_TTL);

    sendResponse({ success: true });
    return false;
  }

  if (msg.type === "AJAX_LOGIN_SUCCESS" && sender.tab?.id && sender.tab.url) {
    const tabId = sender.tab.id;
    const username = String(msg.username ?? "");
    const password = String(msg.password ?? "");
    const url = sender.tab.url;

    isCredentialAlreadySaved(url, username, password).then((exists) => {
      if (exists) {
        console.log("[PWBook BG] AJAX 登录凭据未变化，跳过保存提示");
      } else {
        console.log("[PWBook BG] AJAX 登录成功，直接发送保存提示");
        chrome.tabs.sendMessage(tabId, {
          type: "SHOW_SAVE_PROMPT",
          username,
          password,
          url,
        });
      }
      // 清理该 tab 的 pending 状态（防止兜底定时器重复触发）
      pendingFormData.delete(tabId);
      pendingTimers.delete(tabId);
      chrome.storage.local.remove(getPendingKey(tabId));
    });

    sendResponse({ success: true });
    return false;
  }

  if (msg.type === "GET_PENDING_FORM_DATA" && sender.tab?.id) {
    const tabId = sender.tab.id;
    const data = pendingFormData.get(tabId);
    if (data && Date.now() - data.timestamp < FORM_DATA_TTL) {
      // 检查凭据是否已存在，避免重复提示
      isCredentialAlreadySaved(data.url, data.username, data.password).then((exists) => {
        if (exists) {
          console.log("[PWBook BG] GET_PENDING_FORM_DATA: 凭据未变化，跳过");
          sendResponse({ data: null });
        } else {
          sendResponse({ data });
        }
        pendingFormData.delete(tabId);
        chrome.storage.local.remove(getPendingKey(tabId));
      });
      return true;
    }
    // 内存中没有，尝试从 local storage 恢复（Service Worker 终止后的兜底）
    chrome.storage.local.get(getPendingKey(tabId)).then(async (result) => {
      const localData = result[getPendingKey(tabId)] as StoredFormData | undefined;
      if (localData && Date.now() - localData.timestamp < FORM_DATA_TTL) {
        const exists = await isCredentialAlreadySaved(localData.url, localData.username, localData.password);
        if (exists) {
          console.log("[PWBook BG] GET_PENDING_FORM_DATA(local): 凭据未变化，跳过");
          sendResponse({ data: null });
        } else {
          sendResponse({ data: localData });
        }
      } else {
        sendResponse({ data: null });
      }
      chrome.storage.local.remove(getPendingKey(tabId));
    });
    return true;
  }

  if (msg.type === "CHECK_LOGIN_STATUS") {
    StorageService.getUserKey().then((key) => {
      sendResponse({ isLoggedIn: !!key });
    });
    return true;
  }

  if (msg.type === "GET_VAULT_ITEMS_FOR_URL") {
    handleGetVaultItems(String(msg.url ?? "")).then((items) => {
      sendResponse({ items });
    });
    return true;
  }

  if (msg.type === "SAVE_CIPHER") {
    handleSaveCipher(msg.data as Record<string, unknown>).then((result) => {
      sendResponse(result);
    });
    return true;
  }

  if (msg.type === "WEBAUTHN_CREATE") {
    handleWebAuthnCreate(
      String(msg.origin ?? ""),
      msg.publicKey
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }

  if (msg.type === "WEBAUTHN_GET") {
    handleWebAuthnGet(
      String(msg.origin ?? ""),
      msg.publicKey
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }

  return false;
});

// 监听页面导航完成，判定登录成功
BrowserApi.onWebNavigationCompleted((details) => {
  if (details.frameId !== 0) return;

  const data = pendingFormData.get(details.tabId);
  if (!data) return;

  const beforeUrl = new URL(data.url);
  const afterUrl = new URL(details.url);

  // URL 发生变化（非 hash 变化），判定登录成功
  if (
    beforeUrl.origin !== afterUrl.origin ||
    beforeUrl.pathname !== afterUrl.pathname
  ) {
    isCredentialAlreadySaved(data.url, data.username, data.password).then((exists) => {
      pendingFormData.delete(details.tabId);
      pendingTimers.delete(details.tabId);
      chrome.storage.local.remove(getPendingKey(details.tabId));

      if (exists) {
        console.log("[PWBook BG] 凭据未变化，跳过保存提示");
        return;
      }

      // 向 content script 发送保存密码提示
      chrome.tabs.sendMessage(details.tabId, {
        type: "SHOW_SAVE_PROMPT",
        username: data.username,
        password: data.password,
        url: data.url,
      });
    });
  }
});

async function handleGetVaultItems(urlStr: string): Promise<Array<Record<string, unknown>>> {
  const ciphers = await StorageService.getCiphers();
  const userKey = await StorageService.getUserKey();
  if (!userKey) {
    return [];
  }

  const sourceId = parseUri(urlStr);
  if (!sourceId) return [];
  const rules = await getAssocRules();

  const matched = [];
  for (const cipher of ciphers) {
    try {
      const plainText = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plainText);
      const uris = data.login?.uris ?? [];
      const isMatch = uris.some((u: { uri?: string }) => {
        if (!u.uri) return false;
        const targetId = parseUri(u.uri);
        if (!targetId) return false;
        return isUriMatch(sourceId, targetId, rules);
      });
      if (isMatch) matched.push({ cipher, data });
    } catch {
      // 跳过无法解密的凭据
    }
  }

  // 按 lastUsedAt 降序排列
  matched.sort((a, b) => {
    const ta = a.data.lastUsedAt ? new Date(a.data.lastUsedAt).getTime() : 0;
    const tb = b.data.lastUsedAt ? new Date(b.data.lastUsedAt).getTime() : 0;
    return tb - ta;
  });

  const result = matched.map(({ cipher, data }) => ({
    id: cipher.id,
    name: data.name,
    username: data.login?.username ?? "",
    password: data.login?.password ?? "",
    uri: data.login?.uris?.[0]?.uri ?? "",
    totp: data.login?.totp ?? "",
  }));
  return result;
}

async function handleSaveCipher(data: Record<string, unknown>): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const userKey = await StorageService.getUserKey();
    if (!userKey) {
      return { success: false, error: "未解锁保险库" };
    }

    const ciphers = await StorageService.getCiphers();
    const incomingLogin = (data.login as Record<string, unknown>) ?? {};
    const incomingUsername = String(incomingLogin.username ?? "");
    const incomingPassword = String(incomingLogin.password ?? "");
    const incomingUris = (incomingLogin.uris as Array<{ uri?: string }>) ?? [];
    const incomingUri = incomingUris[0]?.uri ?? "";
    const incomingId = incomingUri ? parseUri(incomingUri) : null;
    const rules = await getAssocRules();

    // 命中条件：URI 匹配（含子域名共享与关联规则） + 用户名完全相同
    let updatedCipherId: string | null = null;
    let resultEncrypted: string | null = null;

    if (incomingId) {
      for (let i = 0; i < ciphers.length; i++) {
        try {
          const plainText = await decryptCipherData(ciphers[i].data, userKey);
          const existing = JSON.parse(plainText) as Record<string, unknown>;
          const existingLogin = (existing.login as Record<string, unknown>) ?? {};
          const existingUsername = String(existingLogin.username ?? "");
          if (existingUsername !== incomingUsername) continue;

          const existingUris = (existingLogin.uris as Array<{ uri?: string }>) ?? [];
          const uriMatched = existingUris.some((u) => {
            if (!u.uri) return false;
            const id = parseUri(u.uri);
            return id ? isUriMatch(incomingId, id, rules) : false;
          });
          if (!uriMatched) continue;

          // 命中：保留原有 name / notes / fields / uris 等，仅更新 password 与 lastUsedAt
          const merged = {
            ...existing,
            lastUsedAt: new Date().toISOString(),
            login: {
              ...existingLogin,
              password: incomingPassword,
            },
          };
          resultEncrypted = await encryptCipherData(JSON.stringify(merged), userKey);
          ciphers[i] = {
            ...ciphers[i],
            data: resultEncrypted,
            modifiedAt: new Date().toISOString(),
          };
          updatedCipherId = ciphers[i].id;
          break;
        } catch {
          // 跳过无法解密的凭据
        }
      }
    }

    let newCipherId: string | null = null;
    if (!updatedCipherId) {
      resultEncrypted = await encryptCipherData(JSON.stringify(data), userKey);
      const cipher = {
        id: crypto.randomUUID(),
        userId: "", // 由服务端填充
        type: 1, // LOGIN
        data: resultEncrypted,
        favorite: false,
        reprompt: 0,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };
      ciphers.push(cipher);
      newCipherId = cipher.id;
    }

    await StorageService.setCiphers(ciphers);

    const targetId = updatedCipherId ?? newCipherId!;
    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: targetId,
      operation: updatedCipherId ? "UPDATE" : "CREATE",
      encryptedData: resultEncrypted!,
      clientTimestamp: new Date().toISOString(),
    });

    return { success: true, id: targetId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── WebAuthn 桥接处理 ───────────────────────────────────────────

const PASSKEY_AAGUID = new Uint8Array(16); // 全 0：软件认证器

interface WebAuthnEnvelope {
  id: string;
  rawId: BufferMarker;
  response: Record<string, BufferMarker | string | undefined>;
}

interface BufferMarker {
  __pwbookBytes: string;
}

function bytes(buf: Uint8Array): BufferMarker {
  return { __pwbookBytes: base64UrlEncode(buf) };
}

function deserializeBuffers(value: unknown): unknown {
  if (value === null || value === undefined) return value;
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

function originToRpId(origin: string, requested?: string): string {
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

function buildClientDataJSON(type: "webauthn.create" | "webauthn.get", challenge: Uint8Array, origin: string): Uint8Array {
  const json = JSON.stringify({
    type,
    challenge: base64UrlEncode(challenge),
    origin,
    crossOrigin: false,
  });
  return new TextEncoder().encode(json);
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as unknown as BufferSource));
}

async function handleWebAuthnCreate(origin: string, publicKeyRaw: unknown): Promise<WebAuthnEnvelope> {
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

  // 加密保存为 PASSKEY 类型 Cipher
  const cipherData: PasskeyCipherData = {
    name: rpName ?? rpId,
    notes: null,
    fields: [],
    lastUsedAt: new Date().toISOString(),
    passkey: material.data,
  };
  const encrypted = await encryptCipherData(JSON.stringify(cipherData), userKey);
  const cipher = {
    id: crypto.randomUUID(),
    userId: "",
    type: CIPHER_TYPE_PASSKEY,
    data: encrypted,
    favorite: false,
    reprompt: 0,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
  const ciphers = await StorageService.getCiphers();
  ciphers.push(cipher);
  await StorageService.setCiphers(ciphers);

  const queue = new PendingChangesQueue();
  await queue.enqueue({
    cipherId: cipher.id,
    operation: "CREATE",
    encryptedData: encrypted,
    clientTimestamp: new Date().toISOString(),
  });

  return {
    id: material.data.credentialId,
    rawId: bytes(credentialIdBytes),
    response: {
      clientDataJSON: bytes(clientDataJSON),
      attestationObject: bytes(attestationObject),
    },
  };
}

async function handleWebAuthnGet(origin: string, publicKeyRaw: unknown): Promise<WebAuthnEnvelope> {
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
  let matched: { cipher: typeof ciphers[number]; passkey: PasskeyCipherData } | null = null;
  for (const cipher of ciphers) {
    if (cipher.type !== CIPHER_TYPE_PASSKEY) continue;
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plain) as PasskeyCipherData;
      if (data.passkey?.rpId !== rpId) continue;
      if (allowedIds.size > 0 && !allowedIds.has(data.passkey.credentialId)) continue;
      matched = { cipher, passkey: data };
      break;
    } catch {
      // 跳过无法解密的凭据
    }
  }

  if (!matched) {
    throw new Error("当前站点没有可用的 Passkey");
  }

  const passkey = matched.passkey.passkey;
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
  const updatedData: PasskeyCipherData = {
    ...matched.passkey,
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
  return {
    id: passkey.credentialId,
    rawId: bytes(credentialIdBytes),
    response: {
      clientDataJSON: bytes(clientDataJSON),
      authenticatorData: bytes(authData),
      signature: bytes(signature),
      userHandle: bytes(base64UrlDecode(passkey.userHandle)),
    },
  };
}

async function isCredentialAlreadySaved(url: string, username: string, password: string): Promise<boolean> {
  if (!username && !password) return false;
  const userKey = await StorageService.getUserKey();
  if (!userKey) return false;

  const ciphers = await StorageService.getCiphers();
  const sourceId = parseUri(url);
  if (!sourceId) return false;
  const rules = await getAssocRules();

  for (const cipher of ciphers) {
    try {
      const plainText = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plainText);
      const uris = data.login?.uris ?? [];
      const isDomainMatch = uris.some((u: { uri?: string }) => {
        if (!u.uri) return false;
        const targetId = parseUri(u.uri);
        if (!targetId) return false;
        return isUriMatch(sourceId, targetId, rules);
      });
      if (isDomainMatch && data.login?.username === username && data.login?.password === password) {
        return true;
      }
    } catch {
      // 跳过无法解密的凭据
    }
  }
  return false;
}

// 初始化后台锁定监听
initIdleListener();

// 初始化同步调度器
const syncScheduler = new SyncScheduler();
syncScheduler.start();

// 监听保险库解锁消息，启动锁定计时器
chrome.runtime.onMessage.addListener((message) => {
  if (typeof message !== "object" || message === null) return false;
  const msg = message as Record<string, unknown>;
  if (msg.type === "VAULT_UNLOCKED") {
    startLockTimer().catch(() => {});
    // 解锁后立即尝试同步
    syncScheduler.performSync().catch(() => {});
  }
  return false;
});
