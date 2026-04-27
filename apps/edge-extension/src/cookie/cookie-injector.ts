// Cookie 注入引擎
// 通过 chrome.cookies.set 精确还原 Cookie，通过 content script 注入 localStorage

import type { CookieItem, LocalStorageItem, CookieData } from "./cookie-extractor.js";

/**
 * 构造 Cookie 设置的 URL
 */
function buildCookieUrl(cookie: CookieItem): string {
  const protocol = cookie.secure ? "https" : "http";
  // domain 可能以 . 开头（表示子域共享），构造 URL 时去掉前缀点
  const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  return `${protocol}://${host}${cookie.path}`;
}

/**
 * 注入单个 Cookie
 */
export async function injectCookie(cookie: CookieItem): Promise<boolean> {
  try {
    const url = buildCookieUrl(cookie);
    const details: chrome.cookies.SetDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
    };
    // 不传递空/undefined 的 storeId
    if (cookie.storeId) {
      details.storeId = cookie.storeId;
    }
    // hostOnly cookie 不传递 domain；非 hostOnly 去掉前导点（.domain → domain）
    if (!cookie.hostOnly) {
      details.domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
    }
    // sameSite 为 unspecified 时不传递
    if (cookie.sameSite && cookie.sameSite !== "unspecified") {
      details.sameSite = cookie.sameSite as chrome.cookies.SameSiteStatus;
    }
    if (cookie.expirationDate) {
      details.expirationDate = cookie.expirationDate;
    }
    // Partitioned Cookie (CHIPS) 支持
    if ((cookie as unknown as Record<string, unknown>).partitioned === true) {
      (details as unknown as Record<string, unknown>).partitioned = true;
    }
    await chrome.cookies.set(details);
    return true;
  } catch (err) {
    console.warn(
      `[PWBook] Cookie 注入失败: ${cookie.name} ` +
      `(domain=${cookie.domain}, path=${cookie.path}, secure=${cookie.secure}, sameSite=${cookie.sameSite}, hostOnly=${cookie.hostOnly})`,
      err
    );
    return false;
  }
}

/**
 * 批量注入 Cookie
 */
export async function injectCookies(cookies: CookieItem[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (const cookie of cookies) {
    const ok = await injectCookie(cookie);
    if (ok) success++;
    else failed++;
  }
  return { success, failed };
}

/**
 * 注入某域名下的全部 Cookie（从 CookieData 对象）
 */
export async function injectCookieData(cookieData: CookieData): Promise<{ success: number; failed: number }> {
  return injectCookies(cookieData.cookies);
}

/**
 * 通过 content script 注入 localStorage
 * @param tabId 目标标签页 ID
 * @param items localStorage 键值对列表
 */
export async function injectLocalStorage(tabId: number, items: LocalStorageItem[]): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SET_LOCAL_STORAGE",
      items,
    });
  } catch (err) {
    console.warn("[PWBook] localStorage 注入失败:", err);
  }
}

/**
 * 通过 content script 读取 localStorage
 * @param tabId 目标标签页 ID
 */
export async function readLocalStorage(tabId: number): Promise<LocalStorageItem[]> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_LOCAL_STORAGE" });
    return (response?.items as LocalStorageItem[]) ?? [];
  } catch (err) {
    console.warn("[PWBook] localStorage 读取失败:", err);
    return [];
  }
}
