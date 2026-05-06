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
import { startLockTimer, initIdleListener, initLockAlarmListener } from "./lock-timer.js";
import { PendingChangesQueue } from "../sync/pending-changes.js";
import { SyncScheduler } from "../sync/sync-scheduler.js";
import { parseUri, type DomainAssocLite } from "../autofill/domain-utils.js";
import { parseCipherData, getLoginData } from "../crypto/cipher-data-parser.js";
import { CipherIndexService } from "../crypto/cipher-index.js";
import type { CipherData } from "@pwbook/shared-types";
interface StoredFormData {
  tabId: number;
  url: string;
  username: string;
  password: string;
  timestamp: number;
}

import { FORM_DATA_TTL_MS, FALLBACK_DELAY_MS, SYNC_INTERVAL_MS } from "../config/constants.js";

// 后台暂存表单提交数据（用于处理登录后重定向）
const pendingFormData = new Map<number, StoredFormData>();
const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

function getPendingKey(tabId: number): string {
  return `_pwbook_pending_${tabId}`;
}

// 使用 chrome.storage.session 替代 local，防止明文密码持久化到磁盘
// session storage 在 Service Worker 终止后自动清除，更安全
async function setPendingData(tabId: number, data: StoredFormData): Promise<void> {
  pendingFormData.set(tabId, data);
  if (chrome.storage.session) {
    await chrome.storage.session.set({ [getPendingKey(tabId)]: data });
  } else {
    // fallback: 旧版本浏览器无 session storage
    await chrome.storage.local.set({ [getPendingKey(tabId)]: data });
  }
}

async function getPendingData(tabId: number): Promise<StoredFormData | undefined> {
  const memoryData = pendingFormData.get(tabId);
  if (memoryData) return memoryData;

  // 从 session storage 恢复
  if (chrome.storage.session) {
    const result = await chrome.storage.session.get(getPendingKey(tabId));
    return result[getPendingKey(tabId)] as StoredFormData | undefined;
  } else {
    const result = await chrome.storage.local.get(getPendingKey(tabId));
    return result[getPendingKey(tabId)] as StoredFormData | undefined;
  }
}

async function removePendingData(tabId: number): Promise<void> {
  pendingFormData.delete(tabId);
  if (chrome.storage.session) {
    await chrome.storage.session.remove(getPendingKey(tabId));
  } else {
    await chrome.storage.local.remove(getPendingKey(tabId));
  }
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

  // 跨 frame Passkey 弹窗转发：iframe → 顶层 frame → iframe
  if (msg.type === "SHOW_PASSKEY_PROMPT" && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, message, { frameId: 0 });
    return false;
  }
  if (msg.type === "PASSKEY_PROMPT_RESPONSE" && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, message);
    return false;
  }

  if (msg.type === "FORM_SUBMITTED" && sender.tab?.id && sender.tab.url) {
    const data: StoredFormData = {
      tabId: sender.tab.id,
      url: sender.tab.url,
      username: String(msg.username ?? ""),
      password: String(msg.password ?? ""),
      timestamp: Date.now(),
    };
    // 使用 session storage 存储，防止明文密码持久化到磁盘
    setPendingData(sender.tab.id, data);

    // 取消旧定时器
    const oldTimer = pendingTimers.get(sender.tab.id);
    if (oldTimer) clearTimeout(oldTimer);

    // 启动兜底定时器：5 秒后若未触发导航，也弹出保存提示（兼容 SPA/AJAX 登录）
    const tabId = sender.tab.id;
    const timer = setTimeout(async () => {
      const d = await getPendingData(tabId);
      if (!d) return;

      isCredentialAlreadySaved(d.url, d.username, d.password).then((exists) => {
        pendingFormData.delete(tabId);
        pendingTimers.delete(tabId);
        removePendingData(tabId);

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
        }, { frameId: 0 });
      });
    }, FALLBACK_DELAY_MS);
    pendingTimers.set(tabId, timer);

    // 10 秒后清理
    setTimeout(async () => {
      pendingFormData.delete(sender.tab?.id ?? data.tabId);
      pendingTimers.delete(sender.tab?.id ?? data.tabId);
      removePendingData(sender.tab?.id ?? data.tabId);
    }, FORM_DATA_TTL_MS);

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
        }, { frameId: 0 });
      }
      // 清理该 tab 的 pending 状态（防止兜底定时器重复触发）
      pendingFormData.delete(tabId);
      pendingTimers.delete(tabId);
      removePendingData(tabId);
    });

    sendResponse({ success: true });
    return false;
  }

  if (msg.type === "GET_PENDING_FORM_DATA" && sender.tab?.id) {
    const tabId = sender.tab.id;
    const data = pendingFormData.get(tabId);
    if (data && Date.now() - data.timestamp < FORM_DATA_TTL_MS) {
      // 检查凭据是否已存在，避免重复提示
      isCredentialAlreadySaved(data.url, data.username, data.password).then((exists) => {
        if (exists) {
          console.log("[PWBook BG] GET_PENDING_FORM_DATA: 凭据未变化，跳过");
          sendResponse({ data: null });
        } else {
          sendResponse({ data });
        }
        pendingFormData.delete(tabId);
        removePendingData(tabId);
      });
      return true;
    }
    // 内存中没有，尝试从 session storage 恢复（Service Worker 终止后的兜底）
    getPendingData(tabId).then(async (localData) => {
      if (localData && Date.now() - localData.timestamp < FORM_DATA_TTL_MS) {
        const exists = await isCredentialAlreadySaved(localData.url, localData.username, localData.password);
        if (exists) {
          console.log("[PWBook BG] GET_PENDING_FORM_DATA(session): 凭据未变化，跳过");
          sendResponse({ data: null });
        } else {
          sendResponse({ data: localData });
        }
      } else {
        sendResponse({ data: null });
      }
      removePendingData(tabId);
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

  getPendingData(details.tabId).then((data) => {
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
        removePendingData(details.tabId);

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
        }, { frameId: 0 });
      });
    }
  });
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

  // 先从索引筛选匹配的 cipher ID，减少解密次数
  const indexEntries = await CipherIndexService.getAll();
  const matchedIds = CipherIndexService.filterByDomain(indexEntries, sourceId, rules);

  // 只解密匹配的凭据
  const matched = [];
  for (const cipherId of matchedIds) {
    const cipher = ciphers.find((c) => c.id === cipherId);
    if (!cipher) continue;
    try {
      const plainText = await decryptCipherData(cipher.data, userKey);
      const cipherData = parseCipherData(plainText);
      matched.push({ cipher, data: cipherData });
    } catch (e) {
      console.error("[PWBook] 解密凭据失败:", cipher.id, e);
    }
  }

  // 按 lastUsedAt 降序排列
  matched.sort((a, b) => {
    const ta = a.data.lastUsedAt ? new Date(a.data.lastUsedAt).getTime() : 0;
    const tb = b.data.lastUsedAt ? new Date(b.data.lastUsedAt).getTime() : 0;
    return tb - ta;
  });

  const result = matched.map(({ cipher, data }) => {
    const login = getLoginData(data);
    return {
      id: cipher.id,
      name: data.name,
      username: login.username,
      password: login.password,
      uri: login.uris[0]?.uri ?? "",
      totp: login.totp ?? "",
    };
  });
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
    let resultData: CipherData | null = null;

    if (incomingId) {
      // 先从索引筛选匹配域名和用户名的 cipher ID
      const indexEntries = await CipherIndexService.getAll();
      const matchedIds = await CipherIndexService.filterByDomainAndUsername(
        indexEntries,
        incomingId,
        incomingUsername,
        rules
      );

      for (const cipherId of matchedIds) {
        const i = ciphers.findIndex((c) => c.id === cipherId);
        if (i < 0) continue;
        try {
          const plainText = await decryptCipherData(ciphers[i].data, userKey);
          const existing = parseCipherData(plainText);
          const existingLogin = getLoginData(existing);

          // 命中：保留原有 name / notes / fields / uris 等，仅更新 password 与 lastUsedAt
          const merged: CipherData = {
            ...existing,
            lastUsedAt: new Date().toISOString(),
            login: {
              username: existingLogin.username,
              password: incomingPassword,
              uris: existingLogin.uris,
              totp: existingLogin.totp,
            },
          };
          resultEncrypted = await encryptCipherData(JSON.stringify(merged), userKey);
          resultData = merged;
          ciphers[i] = {
            ...ciphers[i],
            data: resultEncrypted,
            modifiedAt: new Date().toISOString(),
          };
          updatedCipherId = ciphers[i].id;
          break;
        } catch (e) {
          console.error("[PWBook] 解密凭据失败:", ciphers[i].id, e);
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
      // 新建凭据时，从 data 中解析出 CipherData 用于索引更新
      resultData = parseCipherData(JSON.stringify(data));
    }

    await StorageService.setCiphers(ciphers);

    // 更新索引
    const targetId = updatedCipherId ?? newCipherId!;
    if (resultData) {
      await CipherIndexService.updateOne(targetId, resultData);
    }

    const queue = new PendingChangesQueue();
    const targetCipher = ciphers.find((c) => c.id === targetId);
    await queue.enqueue({
      cipherId: targetId,
      operation: updatedCipherId ? "UPDATE" : "CREATE",
      encryptedData: resultEncrypted!,
      clientTimestamp: new Date().toISOString(),
      userId: targetCipher?.userId ?? "",
      type: targetCipher?.type ?? 1,
      favorite: targetCipher?.favorite ?? false,
      reprompt: targetCipher?.reprompt ?? 0,
      createdAt: targetCipher?.createdAt ?? new Date().toISOString(),
      modifiedAt: targetCipher?.modifiedAt ?? new Date().toISOString(),
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

  // 先从索引筛选匹配域名和用户名的 cipher ID
  const indexEntries = await CipherIndexService.getAll();
  const matchedIds = await CipherIndexService.filterByDomainAndUsername(
    indexEntries,
    sourceId,
    username,
    rules
  );

  // 只解密匹配的凭据检查密码
  for (const cipherId of matchedIds) {
    const cipher = ciphers.find((c) => c.id === cipherId);
    if (!cipher) continue;
    try {
      const plainText = await decryptCipherData(cipher.data, userKey);
      const cipherData = parseCipherData(plainText);
      const login = getLoginData(cipherData);
      if (login.password === password) {
        return true;
      }
    } catch (e) {
      console.error("[PWBook] 解密凭据失败:", cipher.id, e);
    }
  }
  return false;
}

// 解锁后重建索引（确保索引与当前数据一致）
async function rebuildCipherIndex(): Promise<void> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) return;

  const ciphers = await StorageService.getCiphers();
  await CipherIndexService.rebuild(ciphers, (data) => decryptCipherData(data, userKey));
}

// 初始化后台锁定监听
initIdleListener();
// 注册 chrome.alarms 锁定回调（必须在 SW 顶层注册，SW 重启后会自动恢复）
initLockAlarmListener();

// 初始化同步调度器（轮询间隔 10 分钟）
const syncScheduler = new SyncScheduler();
syncScheduler.start(SYNC_INTERVAL_MS);

// 监听保险库解锁消息，启动锁定计时器
chrome.runtime.onMessage.addListener((message) => {
  if (typeof message !== "object" || message === null) return false;
  const msg = message as Record<string, unknown>;
  if (msg.type === "VAULT_UNLOCKED") {
    startLockTimer().catch(() => {});
    // 解锁后立即尝试同步
    syncScheduler.performSync().catch(() => {});
    // 解锁后重建索引（确保索引与当前数据一致）
    rebuildCipherIndex().catch(() => {});
  }
  if (msg.type === "TRIGGER_SYNC_NOW") {
    syncScheduler.performSync().catch(() => {});
  }
  return false;
});
