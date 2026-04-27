// Background Service Worker — 核心业务逻辑、API 通信、保险库管理

import { BrowserApi } from "../platform/browser-api.js";
import {
  handleWebAuthnCreate,
  handleWebAuthnGet,
  queryPasskeySaveCandidates,
  queryPasskeyGetMatches,
} from "./webauthn-handler.js";
import { StorageService } from "../platform/storage.js";
import { decryptCipherData, encryptCipherData } from "../crypto/crypto-service.js";
import { startLockTimer, initIdleListener } from "./lock-timer.js";
import { PendingChangesQueue } from "../sync/pending-changes.js";
import { SyncScheduler } from "../sync/sync-scheduler.js";
import { parseUri, isUriMatch, type DomainAssocLite } from "../autofill/domain-utils.js";
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

  if (msg.type === "QUERY_PASSKEY_SAVE_CANDIDATES" && sender.tab?.url) {
    queryPasskeySaveCandidates(sender.tab.url)
      .then((candidates) => sendResponse({ ok: true, candidates }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "QUERY_PASSKEY_GET_MATCHES" && sender.tab?.url) {
    queryPasskeyGetMatches(sender.tab.url, msg.publicKey)
      .then((matches) => sendResponse({ ok: true, matches }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "WEBAUTHN_CREATE") {
    handleWebAuthnCreate(
      String(msg.origin ?? ""),
      msg.publicKey,
      typeof msg.targetCipherId === "string" ? msg.targetCipherId : undefined
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
      msg.publicKey,
      typeof msg.selectedCredentialId === "string" ? msg.selectedCredentialId : undefined
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

// 初始化同步调度器（轮询间隔 10 分钟）
const syncScheduler = new SyncScheduler();
syncScheduler.start(600_000);

// 监听保险库解锁消息，启动锁定计时器
chrome.runtime.onMessage.addListener((message) => {
  if (typeof message !== "object" || message === null) return false;
  const msg = message as Record<string, unknown>;
  if (msg.type === "VAULT_UNLOCKED") {
    startLockTimer().catch(() => {});
    // 解锁后立即尝试同步
    syncScheduler.performSync().catch(() => {});
  }
  if (msg.type === "TRIGGER_SYNC_NOW") {
    syncScheduler.performSync().catch(() => {});
  }
  return false;
});
