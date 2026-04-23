// Background Service Worker — 核心业务逻辑、API 通信、保险库管理

import { BrowserApi } from "../platform/browser-api.js";
import { StorageService } from "../platform/storage.js";
import { decryptCipherData, encryptCipherData } from "../crypto/crypto-service.js";

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
    const timer = setTimeout(() => {
      const d = pendingFormData.get(sender.tab!.id!);
      if (d) {
        console.log("[PWBook BG] 兜底定时器触发，发送保存提示（SPA/AJAX）");
        pendingFormData.delete(sender.tab!.id!);
        pendingTimers.delete(sender.tab!.id!);
        chrome.storage.local.remove(getPendingKey(sender.tab!.id!));
        chrome.tabs.sendMessage(sender.tab!.id!, {
          type: "SHOW_SAVE_PROMPT",
          username: d.username,
          password: d.password,
          url: d.url,
        });
      }
    }, FALLBACK_DELAY);
    pendingTimers.set(sender.tab.id, timer);

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
    // SPA/AJAX 登录成功：直接弹出保存提示，无需等待导航
    console.log("[PWBook BG] AJAX 登录成功，直接发送保存提示");
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "SHOW_SAVE_PROMPT",
      username: String(msg.username ?? ""),
      password: String(msg.password ?? ""),
      url: sender.tab.url,
    });

    // 清理该 tab 的 pending 状态（防止兜底定时器重复触发）
    pendingFormData.delete(sender.tab.id);
    pendingTimers.delete(sender.tab.id);
    chrome.storage.local.remove(getPendingKey(sender.tab.id));

    sendResponse({ success: true });
    return false;
  }

  if (msg.type === "GET_PENDING_FORM_DATA" && sender.tab?.id) {
    const tabId = sender.tab.id;
    const data = pendingFormData.get(tabId);
    if (data && Date.now() - data.timestamp < FORM_DATA_TTL) {
      sendResponse({ data });
      pendingFormData.delete(tabId);
      chrome.storage.local.remove(getPendingKey(tabId));
      return false;
    }
    // 内存中没有，尝试从 local storage 恢复（Service Worker 终止后的兜底）
    chrome.storage.local.get(getPendingKey(tabId)).then((result) => {
      const localData = result[getPendingKey(tabId)] as StoredFormData | undefined;
      if (localData && Date.now() - localData.timestamp < FORM_DATA_TTL) {
        sendResponse({ data: localData });
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
    pendingFormData.delete(details.tabId);
    pendingTimers.delete(details.tabId);
    chrome.storage.local.remove(getPendingKey(details.tabId));

    // 向 content script 发送保存密码提示
    chrome.tabs.sendMessage(details.tabId, {
      type: "SHOW_SAVE_PROMPT",
      username: data.username,
      password: data.password,
      url: data.url,
    });
  }
});

async function handleGetVaultItems(urlStr: string): Promise<Array<Record<string, unknown>>> {
  console.log("[PWBook BG] handleGetVaultItems, url:", urlStr);
  const ciphers = await StorageService.getCiphers();
  console.log("[PWBook BG] 本地凭据总数:", ciphers.length);
  const userKey = await StorageService.getUserKey();
  if (!userKey) {
    console.log("[PWBook BG] 保险库未解锁，无 userKey");
    return [];
  }

  const url = new URL(urlStr);
  const hostname = url.hostname.toLowerCase();
  console.log("[PWBook BG] 目标 hostname:", hostname);

  // 简单域名匹配：基础域名或完整主机名匹配
  const matched = [];
  for (const cipher of ciphers) {
    try {
      const plainText = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plainText);
      const uris = data.login?.uris ?? [];
      console.log("[PWBook BG] 检查凭据:", data.name, "URIs:", uris.map((u: { uri?: string }) => u.uri));
      const isMatch = uris.some((u: { uri?: string }) => {
        if (!u.uri) return false;
        try {
          const uHost = new URL(u.uri).hostname.toLowerCase();
          const match = hostname === uHost || hostname.endsWith(`.${uHost}`) || uHost.endsWith(`.${hostname}`);
          if (match) console.log("[PWBook BG] 匹配成功:", uHost, "===", hostname);
          return match;
        } catch {
          const match = u.uri.includes(hostname);
          if (match) console.log("[PWBook BG] 匹配成功(回退):", u.uri, "includes", hostname);
          return match;
        }
      });
      if (isMatch) matched.push({ cipher, data });
    } catch (e) {
      console.log("[PWBook BG] 解密/解析凭据失败:", e);
    }
  }

  console.log("[PWBook BG] 匹配凭据数:", matched.length);

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
  }));
  console.log("[PWBook BG] 返回结果:", result.map((r) => ({ id: r.id, username: r.username, uri: r.uri })));
  return result;
}

async function handleSaveCipher(data: Record<string, unknown>): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const userKey = await StorageService.getUserKey();
    if (!userKey) {
      return { success: false, error: "未解锁保险库" };
    }
    console.log("[PWBook BG] 保存凭据，userKey 长度:", userKey.length, "摘要:", userKey.slice(0, 4).join(","));

    const encryptedData = await encryptCipherData(JSON.stringify(data), userKey);
    console.log("[PWBook BG] 加密完成，密文长度:", encryptedData.length);

    const cipher = {
      id: crypto.randomUUID(),
      userId: "", // 由服务端填充
      type: 1, // LOGIN
      data: encryptedData,
      favorite: false,
      reprompt: 0,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    const ciphers = await StorageService.getCiphers();
    const name = String(data.name ?? "");
    const username = String((data.login as Record<string, unknown>)?.username ?? "");

    // 检查是否已有相同域名+用户名的凭据，有则更新
    let updated = false;
    for (let i = 0; i < ciphers.length; i++) {
      try {
        const plainText = await decryptCipherData(ciphers[i].data, userKey);
        const existing = JSON.parse(plainText) as Record<string, unknown>;
        const existingName = String(existing.name ?? "");
        const existingUsername = String((existing.login as Record<string, unknown>)?.username ?? "");
        if (existingName === name && existingUsername === username) {
          ciphers[i] = {
            ...ciphers[i],
            data: encryptedData,
            modifiedAt: new Date().toISOString(),
          };
          updated = true;
          console.log("[PWBook BG] 更新已有凭据:", name, username);
          break;
        }
      } catch {
        // 跳过无法解密的凭据
      }
    }

    if (!updated) {
      ciphers.push(cipher);
      console.log("[PWBook BG] 新增凭据:", name, username);
    }

    await StorageService.setCiphers(ciphers);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
