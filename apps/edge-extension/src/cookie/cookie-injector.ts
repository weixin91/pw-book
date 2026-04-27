// Cookie 注入引擎
// 通过 chrome.cookies.set 精确还原 Cookie，通过 content script 注入 localStorage

import type { CookieItem, LocalStorageItem, CookieData } from "./cookie-extractor.js";

function buildSetDetails(cookie: CookieItem, overrideSecure?: boolean): chrome.cookies.SetDetails {
  const secure = overrideSecure ?? cookie.secure;
  const protocol = secure ? "https" : "http";
  const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const url = `${protocol}://${host}${cookie.path}`;

  const details: chrome.cookies.SetDetails = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure,
    httpOnly: cookie.httpOnly,
  };
  if (cookie.storeId) {
    details.storeId = cookie.storeId;
  }
  if (!cookie.hostOnly) {
    details.domain = host;
  }
  if (cookie.sameSite && cookie.sameSite !== "unspecified") {
    details.sameSite = cookie.sameSite as chrome.cookies.SameSiteStatus;
  }
  if (cookie.expirationDate) {
    details.expirationDate = cookie.expirationDate;
  }
  if ((cookie as unknown as Record<string, unknown>).partitioned === true) {
    (details as unknown as Record<string, unknown>).partitioned = true;
  }
  return details;
}

/**
 * 注入单个 Cookie
 */
export async function injectCookie(cookie: CookieItem): Promise<boolean> {
  try {
    await chrome.cookies.set(buildSetDetails(cookie));
    return true;
  } catch {
    // 首次失败：对于非 secure cookie，尝试强制 secure=true 重试（兼容 HSTS 站点）
    if (!cookie.secure) {
      try {
        await chrome.cookies.set(buildSetDetails(cookie, true));
        return true;
      } catch {
        // 重试也失败，继续走最后的降级
      }
    }
    // 最终降级：不传递 domain，让 Chrome 根据 URL 自行推断
    try {
      const details = buildSetDetails(cookie);
      delete (details as unknown as Record<string, unknown>).domain;
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
