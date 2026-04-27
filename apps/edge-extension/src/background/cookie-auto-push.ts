// Cookie 手动推送
// 提供 manualPushCookie，支持可选的 localStorage 提取

import { buildCookieData } from "../cookie/cookie-extractor.js";
import { encodeCookieData } from "../cookie/cookie-codec.js";
import { CookieSyncClient } from "../sync/cookie-sync-client.js";
import { StorageService } from "../platform/storage.js";
import { readLocalStorage } from "../cookie/cookie-injector.js";
import { getBaseDomainFromAny } from "../autofill/domain-utils.js";

/**
 * 查找匹配某域名的活动标签页，读取其 localStorage
 */
async function tryReadLocalStorage(baseDomain: string): Promise<import("../cookie/cookie-extractor.js").LocalStorageItem[] | undefined> {
  const tabs = await chrome.tabs.query({});
  const matchedTab = tabs.find((t) => {
    if (!t.url) return false;
    const domain = getBaseDomainFromAny(t.url);
    return domain === baseDomain && t.id != null;
  });
  if (!matchedTab?.id) return undefined;
  try {
    const items = await readLocalStorage(matchedTab.id);
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

/** 手动触发某域名的 Cookie 推送（可选 localStorage） */
export async function manualPushCookie(baseDomain: string, includeLocalStorage?: boolean): Promise<void> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) throw new Error("保险库未解锁");

  let localStorageItems: import("../cookie/cookie-extractor.js").LocalStorageItem[] | undefined;
  if (includeLocalStorage) {
    localStorageItems = await tryReadLocalStorage(baseDomain);
  }

  const cookieData = await buildCookieData(baseDomain, localStorageItems);
  const encryptedData = await encodeCookieData(cookieData, userKey);
  const client = new CookieSyncClient();
  await client.uploadCookie(baseDomain, encryptedData);
}
