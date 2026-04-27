// Cookie 同步规则配置本地存储

import { CookieSyncClient } from "../sync/cookie-sync-client.js";

const STORAGE_KEY = "cookieSyncConfig";

export interface DomainSyncConfig {
  includeLocalStorage: boolean;
}

/**
 * 读取本地存储的全部同步规则
 */
export async function getAllSyncConfigs(): Promise<Record<string, DomainSyncConfig>> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Record<string, DomainSyncConfig>) ?? {};
}

/**
 * 读取某域名的同步规则
 */
export async function getSyncConfig(domain: string): Promise<DomainSyncConfig | undefined> {
  const configs = await getAllSyncConfigs();
  return configs[domain];
}

/**
 * 保存某域名的同步规则（仅本地）
 */
export async function setSyncConfig(domain: string, config: DomainSyncConfig): Promise<void> {
  const configs = await getAllSyncConfigs();
  configs[domain] = config;
  await chrome.storage.local.set({ [STORAGE_KEY]: configs });
}

/**
 * 删除某域名的同步规则（仅本地）
 */
export async function removeSyncConfig(domain: string): Promise<void> {
  const configs = await getAllSyncConfigs();
  delete configs[domain];
  await chrome.storage.local.set({ [STORAGE_KEY]: configs });
}

/**
 * 从服务端拉取所有规则并覆盖本地缓存
 */
export async function pullConfigsFromServer(): Promise<void> {
  const client = new CookieSyncClient();
  try {
    const { data } = await client.fetchAllConfigs();
    const localConfigs: Record<string, DomainSyncConfig> = {};
    for (const record of data) {
      localConfigs[record.domain] = {
        includeLocalStorage: record.includeLocalStorage,
      };
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: localConfigs });
  } catch (err) {
    console.warn("[PWBook] 拉取同步规则失败:", err);
  }
}

/**
 * 将本地规则推送到服务端
 */
export async function pushConfigToServer(domain: string, config: DomainSyncConfig): Promise<void> {
  const client = new CookieSyncClient();
  try {
    await client.upsertConfig(domain, config);
  } catch (err) {
    console.warn("[PWBook] 推送同步规则失败:", err);
  }
}

/**
 * 检查某域名是否同步 localStorage
 */
export async function isLocalStorageEnabled(domain: string): Promise<boolean> {
  const config = await getSyncConfig(domain);
  return config?.includeLocalStorage ?? false;
}
