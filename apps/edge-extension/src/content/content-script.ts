// Content Script — 自动填充、表单检测、消息桥接

import { CollectAutofillContentService } from "../autofill/collect-autofill-content.js";
import { InsertAutofillContentService } from "../autofill/insert-autofill-content.js";
import { LoginDetectionEngine } from "../autofill/login-detection.js";
import { SavePrompt } from "../autofill/save-prompt.js";
import { InlineMenu } from "../autofill/inline-menu.js";

declare const __PWBOOK_INITIALIZED__: boolean | undefined;

// 防止重复注入
if (typeof __PWBOOK_INITIALIZED__ === "undefined") {
  (window as unknown as Record<string, boolean>).__PWBOOK_INITIALIZED__ = true;
  console.log("[PWBook] content script 初始化");
  initContentScript();
} else {
  console.log("[PWBook] content script 已注入，跳过");
}

function initContentScript(): void {
  const collector = new CollectAutofillContentService(document);
  const inserter = new InsertAutofillContentService(document);
  const detector = new LoginDetectionEngine(document, handleLoginDetected);
  const savePrompt = new SavePrompt(document);
  const inlineMenu = new InlineMenu(document, handleAutofillSelected);

  // 初始扫描
  console.log("[PWBook] 开始初始页面扫描，URL:", location.href);
  const formData = collector.scanPage();
  if (formData) {
    console.log("[PWBook] 检测到表单，passwordField:", formData.passwordField ? "有" : "无", "usernameField:", formData.usernameField ? "有" : "无");
    requestVaultItems(formData.url);
  } else {
    console.log("[PWBook] 未检测到登录表单");
  }

  // MutationObserver 防抖扫描
  let scanTimeout: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      const newFormData = collector.scanPage();
      if (newFormData) {
        console.log("[PWBook] MutationObserver 检测到表单变化");
        requestVaultItems(newFormData.url);
      }
    }, 100);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  }

  // 监听 background script 消息
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return false;
    const msg = message as Record<string, unknown>;
    console.log("[PWBook] 收到 background 消息:", msg.type);

    if (msg.type === "SHOW_SAVE_PROMPT") {
      savePrompt.show({
        username: String(msg.username ?? ""),
        password: String(msg.password ?? ""),
        url: String(msg.url ?? location.href),
      });
      sendResponse({ shown: true });
      return false;
    }

    if (msg.type === "FILL_CREDENTIALS") {
      const items = (msg.items as Array<Record<string, unknown>>) ?? [];
      console.log("[PWBook] FILL_CREDENTIALS 收到凭据数:", items.length);
      if (items.length > 0) {
        inserter.fill(items[0]);
        if (items.length > 1) {
          inlineMenu.show(items);
        }
      }
      sendResponse({ filled: items.length > 0 });
      return false;
    }

    return false;
  });

  function handleLoginDetected(username: string, password: string): void {
    console.log("[PWBook] 检测到登录提交");
    chrome.runtime.sendMessage({
      type: "FORM_SUBMITTED",
      username,
      password,
    });
  }

  function handleAutofillSelected(item: Record<string, unknown>): void {
    console.log("[PWBook] 用户选择自动填充:", item.username);
    inserter.fill(item);
    // 更新 lastUsedAt
    chrome.runtime.sendMessage({
      type: "UPDATE_LAST_USED",
      id: String(item.id ?? ""),
    });
  }

  function requestVaultItems(url: string): void {
    console.log("[PWBook] 请求凭据，URL:", url);
    chrome.runtime.sendMessage(
      { type: "GET_VAULT_ITEMS_FOR_URL", url },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("[PWBook] 请求凭据失败:", chrome.runtime.lastError.message);
          return;
        }
        const items = (response?.items as Array<Record<string, unknown>>) ?? [];
        console.log("[PWBook] 收到凭据数:", items.length, "items:", items.map((i) => ({ id: i.id, username: i.username, uri: i.uri })));
        if (items.length === 1) {
          inserter.fill(items[0]);
        } else if (items.length > 1) {
          inlineMenu.show(items);
        }
      }
    );
  }
}
