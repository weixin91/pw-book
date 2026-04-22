// Background Service Worker — 核心业务逻辑、API 通信、保险库管理

import { BrowserApi } from "../platform/browser-api.js";
import { StorageService } from "../platform/storage.js";

interface StoredFormData {
  tabId: number;
  url: string;
  username: string;
  password: string;
  timestamp: number;
}

// 后台暂存表单提交数据（用于处理登录后重定向）
const pendingFormData = new Map<number, StoredFormData>();
const FORM_DATA_TTL = 10_000; // 10 秒

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

    // 10 秒后清理
    setTimeout(() => {
      pendingFormData.delete(sender.tab?.id ?? data.tabId);
    }, FORM_DATA_TTL);

    sendResponse({ success: true });
    return false;
  }

  if (msg.type === "GET_PENDING_FORM_DATA" && sender.tab?.id) {
    const data = pendingFormData.get(sender.tab.id);
    if (data && Date.now() - data.timestamp < FORM_DATA_TTL) {
      sendResponse({ data });
    } else {
      sendResponse({ data: null });
    }
    pendingFormData.delete(sender.tab.id);
    return false;
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
  const url = new URL(urlStr);
  const hostname = url.hostname.toLowerCase();
  console.log("[PWBook BG] 目标 hostname:", hostname);

  // 简单域名匹配：基础域名或完整主机名匹配
  const matched = ciphers.filter((cipher) => {
    try {
      const data = JSON.parse(cipher.data);
      const uris = data.login?.uris ?? [];
      console.log("[PWBook BG] 检查凭据:", data.name, "URIs:", uris.map((u: { uri?: string }) => u.uri));
      return uris.some((u: { uri?: string }) => {
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
    } catch (e) {
      console.log("[PWBook BG] 解析凭据失败:", e);
      return false;
    }
  });

  console.log("[PWBook BG] 匹配凭据数:", matched.length);

  // 按 lastUsedAt 降序排列
  matched.sort((a, b) => {
    try {
      const da = JSON.parse(a.data);
      const db = JSON.parse(b.data);
      const ta = da.lastUsedAt ? new Date(da.lastUsedAt).getTime() : 0;
      const tb = db.lastUsedAt ? new Date(db.lastUsedAt).getTime() : 0;
      return tb - ta;
    } catch {
      return 0;
    }
  });

  const result = matched.map((c) => {
    try {
      const data = JSON.parse(c.data);
      return {
        id: c.id,
        name: data.name,
        username: data.login?.username ?? "",
        password: data.login?.password ?? "",
        uri: data.login?.uris?.[0]?.uri ?? "",
      };
    } catch {
      return { id: c.id, name: "", username: "", password: "", uri: "" };
    }
  });
  console.log("[PWBook BG] 返回结果:", result.map((r) => ({ id: r.id, username: r.username, uri: r.uri })));
  return result;
}

async function handleSaveCipher(data: Record<string, unknown>): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const userKey = await StorageService.getUserKey();
    if (!userKey) {
      return { success: false, error: "未解锁保险库" };
    }

    const { encryptCipherData } = await import("../crypto/crypto-service.js");
    const encryptedData = await encryptCipherData(JSON.stringify(data.data), userKey);

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
    ciphers.push(cipher);
    await StorageService.setCiphers(ciphers);

    return { success: true, id: cipher.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
