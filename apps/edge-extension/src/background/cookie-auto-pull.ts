// Cookie 手动拉取

import { decodeCookieData } from "../cookie/cookie-codec.js";
import { CookieSyncClient } from "../sync/cookie-sync-client.js";
import { StorageService } from "../platform/storage.js";
import { injectCookieData, injectLocalStorage } from "../cookie/cookie-injector.js";
import { getSyncConfig } from "../cookie/sync-config-storage.js";

/** 手动触发某域名的 Cookie 拉取 */
export async function manualPullCookie(baseDomain: string, tabId: number): Promise<void> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) throw new Error("保险库未解锁");

  const client = new CookieSyncClient();
  const record = await client.fetchCookie(baseDomain);
  if (!record) throw new Error("该域名无同步记录");

  const cookieData = await decodeCookieData<import("../cookie/cookie-extractor.js").CookieData>(record.encryptedData, userKey);
  await injectCookieData(cookieData);

  const config = await getSyncConfig(baseDomain);
  if (config?.includeLocalStorage && cookieData.localStorageItems) {
    await injectLocalStorage(tabId, cookieData.localStorageItems);
  }
}
