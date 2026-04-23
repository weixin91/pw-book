// Content Script — 自动填充、表单检测、消息桥接

import { CollectAutofillContentService } from "../autofill/collect-autofill-content.js";
import { InsertAutofillContentService } from "../autofill/insert-autofill-content.js";
import { LoginDetectionEngine } from "../autofill/login-detection.js";
import { SavePrompt } from "../autofill/save-prompt.js";
import { InlineMenu } from "../autofill/inline-menu.js";
import { StorageService } from "../platform/storage.js";

declare const __PWBOOK_INITIALIZED__: boolean | undefined;

// 防止重复注入
if (typeof __PWBOOK_INITIALIZED__ === "undefined") {
  (window as unknown as Record<string, boolean>).__PWBOOK_INITIALIZED__ = true;
  console.log("[PWBook] content script 初始化");
  initContentScript();
} else {
  console.log("[PWBook] content script 已注入，跳过");
}

async function initContentScript(): Promise<void> {
  const collector = new CollectAutofillContentService(document);
  const inserter = new InsertAutofillContentService(document);
  new LoginDetectionEngine(document, handleFormSubmit, handleAjaxLoginSuccess);
  const savePrompt = new SavePrompt(document);
  const inlineMenu = new InlineMenu(document, handleAutofillSelected);

  // 防止同一页面重复自动填充
  let hasAutoFilled = false;

  // 读取自动填充模式配置
  let autofillMode: "auto" | "manual" = "auto";
  try {
    autofillMode = await StorageService.getAutofillMode();
    console.log("[PWBook] 自动填充模式:", autofillMode);
  } catch {
    // 使用默认 auto
  }

  if (autofillMode === "auto") {
    setupAutoDetection(collector, requestVaultItems);
  } else {
    setupManualDetection(collector, requestVaultItems);
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

  // 页面加载后检查是否有待处理的登录数据（导航导致消息丢失时的兜底）
  // 只在主页面（非 iframe）中执行，防止 iframe 被移除导致提示消失
  if (window.top === window.self) {
    try {
      chrome.runtime.sendMessage({ type: "GET_PENDING_FORM_DATA" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("[PWBook] GET_PENDING_FORM_DATA 错误:", chrome.runtime.lastError.message);
          return;
        }
        const data = response?.data as Record<string, unknown> | undefined;
        if (data) {
          console.log("[PWBook] 从 background 恢复 pending 登录数据, username:", data.username, "password:", data.password ? "有" : "无");
          savePrompt.show({
            username: String(data.username ?? ""),
            password: String(data.password ?? ""),
            url: String(data.url ?? location.href),
          });
        } else {
          console.log("[PWBook] 无 pending 登录数据");
        }
      });
    } catch (err) {
      console.error("[PWBook] 扩展上下文已失效，请刷新页面:", err);
    }
  }

  function handleFormSubmit(username: string, password: string): void {
    console.log("[PWBook] 检测到表单提交");
    const msg = { type: "FORM_SUBMITTED", username, password, url: location.href };
    try {
      chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.error("[PWBook] 扩展上下文已失效:", err);
    }
    // 导航前再次发送，防止页面跳转导致消息丢失
    const sendBeforeUnload = () => {
      try {
        chrome.runtime.sendMessage(msg);
      } catch {
        // 忽略
      }
    };
    window.addEventListener("beforeunload", sendBeforeUnload, { once: true });
    setTimeout(() => window.removeEventListener("beforeunload", sendBeforeUnload), 3000);
  }

  function handleAjaxLoginSuccess(username: string, password: string): void {
    console.log("[PWBook] 检测到 AJAX 登录成功");
    const msg = { type: "AJAX_LOGIN_SUCCESS", username, password, url: location.href };
    try {
      chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.error("[PWBook] 扩展上下文已失效:", err);
    }
    const sendBeforeUnload = () => {
      try {
        chrome.runtime.sendMessage(msg);
      } catch {
        // 忽略
      }
    };
    window.addEventListener("beforeunload", sendBeforeUnload, { once: true });
  }

  function handleAutofillSelected(item: Record<string, unknown>): void {
    console.log("[PWBook] 用户选择自动填充:", item.username);
    inserter.fill(item);
    hasAutoFilled = true;
    // 更新 lastUsedAt
    try {
      chrome.runtime.sendMessage({
        type: "UPDATE_LAST_USED",
        id: String(item.id ?? ""),
      });
    } catch (err) {
      console.error("[PWBook] 扩展上下文已失效:", err);
    }
  }

  function requestVaultItems(url: string): void {
    console.log("[PWBook] 请求凭据，URL:", url);
    try {
      chrome.runtime.sendMessage(
        { type: "GET_VAULT_ITEMS_FOR_URL", url },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("[PWBook] 请求凭据失败:", chrome.runtime.lastError.message);
            return;
          }
          const items = (response?.items as Array<Record<string, unknown>>) ?? [];
          console.log("[PWBook] 收到凭据数:", items.length, "items:", items.map((i) => ({ id: i.id, username: i.username, uri: i.uri })));
          if (items.length === 0) return;

          if (autofillMode === "manual") {
            // 手动模式：始终弹出列表供用户选择
            inlineMenu.show(items);
            return;
          }

          // 自动模式
          if (items.length === 1) {
            if (!hasAutoFilled) {
              inserter.fill(items[0]);
              hasAutoFilled = true;
            }
          } else if (items.length > 1) {
            inlineMenu.show(items);
          }
        }
      );
    } catch (err) {
      console.error("[PWBook] 扩展上下文已失效，请刷新页面:", err);
    }
  }
}

// 自动模式：全量检测机制
function setupAutoDetection(
  collector: CollectAutofillContentService,
  requestVaultItems: (url: string) => void
): void {
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
  function startObserver() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.body) {
    startObserver();
  } else {
    document.addEventListener("DOMContentLoaded", startObserver);
  }

  // 监听用户交互：focusin（输入框聚焦）和 click（点击登录按钮）
  // 用于兼容 CSS 显示/隐藏切换的登录表单（MutationObserver 捕获不到 CSS 变化）
  document.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" && target.closest("form, dialog, [role='dialog'], .modal, .login, .auth")) {
      console.log("[PWBook] focusin 触发扫描");
      if (scanTimeout) clearTimeout(scanTimeout);
      scanTimeout = setTimeout(() => {
        const fd = collector.scanPage();
        if (fd) requestVaultItems(fd.url);
      }, 50);
    }
  });

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const text = (target.textContent ?? "").toLowerCase();
    const aria = (target.getAttribute("aria-label") ?? "").toLowerCase();
    const title = (target.getAttribute("title") ?? "").toLowerCase();
    const cls = (target.className ?? "").toLowerCase();
    const isLoginTrigger =
      text.includes("登录") || text.includes("login") || text.includes("sign in") || text.includes("signin") ||
      aria.includes("登录") || aria.includes("login") ||
      title.includes("登录") || title.includes("login") ||
      cls.includes("login") || cls.includes("signin") || cls.includes("auth");
    if (isLoginTrigger) {
      console.log("[PWBook] 检测到登录按钮点击，延迟扫描");
      // 延迟 300ms 等待弹窗/表单显示
      setTimeout(() => {
        const fd = collector.scanPage();
        if (fd) requestVaultItems(fd.url);
      }, 300);
      // 再延迟 800ms 二次扫描（处理动画过渡较慢的情况）
      setTimeout(() => {
        const fd = collector.scanPage();
        if (fd) requestVaultItems(fd.url);
      }, 800);
    }
  });

  // 轻量轮询兜底：每 2 秒扫描一次，最多 30 次（1 分钟），找到表单后停止
  let pollCount = 0;
  const pollInterval = setInterval(() => {
    pollCount++;
    if (pollCount > 30) {
      clearInterval(pollInterval);
      console.log("[PWBook] 轮询结束，未检测到持久登录表单");
      return;
    }
    const fd = collector.scanPage();
    if (fd) {
      console.log("[PWBook] 轮询检测到表单");
      requestVaultItems(fd.url);
      clearInterval(pollInterval);
    }
  }, 2000);
}

// 手动模式：仅通过密码框 focus 触发
function setupManualDetection(
  collector: CollectAutofillContentService,
  requestVaultItems: (url: string) => void
): void {
  console.log("[PWBook] 手动模式：仅密码框聚焦时触发");

  document.addEventListener("focusin", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.tagName !== "INPUT") return;
    // 兼容显示密码后 type 被切换为 text 的情况
    const isPasswordLike = /password|pwd|pass|密码|密碼/i.test(
      `${target.name} ${target.id} ${target.placeholder} ${target.autocomplete}`
    );
    if (target.type === "password" || isPasswordLike) {
      console.log("[PWBook] 密码框获得焦点，触发扫描");
      const fd = collector.scanPage();
      if (fd) requestVaultItems(fd.url);
    }
  });
}
