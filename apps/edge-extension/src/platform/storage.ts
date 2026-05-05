// 保险库本地存储抽象层
// 使用 chrome.storage.local 持久化加密数据，session 存储解密密钥

import type { Cipher, PendingChange, SyncStatus, DomainAssociation } from "@pwbook/shared-types";

const LOCAL_KEYS = {
  ENCRYPTED_KEY: "encKey",
  ENCRYPTED_PRIVATE_KEY: "encPrivateKey",
  PROFILE: "profile",
  CIPHERS: "ciphers",
  FOLDERS: "folders",
  SETTINGS: "settings",
  PENDING_CHANGES: "pendingChanges",
  SYNC_STATUS: "syncStatus",
  LAST_SYNC_TOKEN: "lastSyncToken",
  REJECTED_SITES: "rejectedSites",
  SERVER_URL: "serverUrl",
  AUTOFILL_MODE: "autofillMode",
  DOMAIN_ASSOCIATIONS: "domainAssociations",
} as const;

export interface StoredProfile {
  id: string;
  email: string;
  kdfType: string;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  publicKey: string;
  securityStamp: string;
  token: string;
  refreshToken: string;
}

export const StorageService = {
  // --- chrome.storage.local ---

  async getEncryptedKey(): Promise<string | null> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.ENCRYPTED_KEY);
    return result[LOCAL_KEYS.ENCRYPTED_KEY] ?? null;
  },

  async setEncryptedKey(value: string): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.ENCRYPTED_KEY]: value });
  },

  async getProfile(): Promise<StoredProfile | null> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.PROFILE);
    return result[LOCAL_KEYS.PROFILE] ?? null;
  },

  async setProfile(profile: StoredProfile): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.PROFILE]: profile });
  },

  async clearProfile(): Promise<void> {
    await chrome.storage.local.remove([
      LOCAL_KEYS.PROFILE,
      LOCAL_KEYS.ENCRYPTED_KEY,
      LOCAL_KEYS.ENCRYPTED_PRIVATE_KEY,
      LOCAL_KEYS.CIPHERS,
      LOCAL_KEYS.LAST_SYNC_TOKEN,
      LOCAL_KEYS.PENDING_CHANGES,
    ]);
  },

  async getCiphers(): Promise<Cipher[]> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.CIPHERS);
    return result[LOCAL_KEYS.CIPHERS] ?? [];
  },

  async setCiphers(ciphers: Cipher[]): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.CIPHERS]: ciphers });
  },

  async getPendingChanges(): Promise<PendingChange[]> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.PENDING_CHANGES);
    return result[LOCAL_KEYS.PENDING_CHANGES] ?? [];
  },

  async setPendingChanges(changes: PendingChange[]): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.PENDING_CHANGES]: changes });
  },

  async addPendingChange(change: PendingChange): Promise<void> {
    const changes = await this.getPendingChanges();
    changes.push(change);
    await this.setPendingChanges(changes);
  },

  async removePendingChange(changeId: string): Promise<void> {
    const changes = await this.getPendingChanges();
    const filtered = changes.filter((c) => c.id !== changeId);
    await this.setPendingChanges(filtered);
  },

  async getSyncStatus(): Promise<SyncStatus | null> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.SYNC_STATUS);
    return result[LOCAL_KEYS.SYNC_STATUS] ?? null;
  },

  async setSyncStatus(status: SyncStatus): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.SYNC_STATUS]: status });
  },

  async getLastSyncToken(): Promise<string | null> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.LAST_SYNC_TOKEN);
    return result[LOCAL_KEYS.LAST_SYNC_TOKEN] ?? null;
  },

  async setLastSyncToken(token: string): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.LAST_SYNC_TOKEN]: token });
  },

  async getRejectedSites(): Promise<Array<{ domain: string; rejectedAt: string; expireAt: string }>> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.REJECTED_SITES);
    return result[LOCAL_KEYS.REJECTED_SITES] ?? [];
  },

  async setRejectedSites(sites: Array<{ domain: string; rejectedAt: string; expireAt: string }>): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.REJECTED_SITES]: sites });
  },

  async getServerUrl(): Promise<string> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.SERVER_URL);
    return result[LOCAL_KEYS.SERVER_URL] ?? "http://localhost:3000";
  },

  async setServerUrl(url: string): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.SERVER_URL]: url });
  },

  async getAutofillMode(): Promise<"auto" | "manual"> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.AUTOFILL_MODE);
    return result[LOCAL_KEYS.AUTOFILL_MODE] ?? "auto";
  },

  async setAutofillMode(mode: "auto" | "manual"): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.AUTOFILL_MODE]: mode });
  },

  async getDomainAssociations(): Promise<DomainAssociation[]> {
    const result = await chrome.storage.local.get(LOCAL_KEYS.DOMAIN_ASSOCIATIONS);
    return result[LOCAL_KEYS.DOMAIN_ASSOCIATIONS] ?? [];
  },

  async setDomainAssociations(rules: DomainAssociation[]): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.DOMAIN_ASSOCIATIONS]: rules });
  },

  // --- chrome.storage.session (MV3, Service Worker 存活期间) + 条件持久化 ---

  /**
   * 存储用户密钥
   * @param userKey 解密后的用户密钥
   * @param persist 是否持久化到 local storage（仅"从不锁定"时为 true）
   */
  async setUserKey(userKey: Uint8Array, persist: boolean = false): Promise<void> {
    const data = { userKey: Array.from(userKey) };
    // 始终写入 session storage（浏览器关闭后自动清除）
    await chrome.storage.session.set(data);

    if (persist) {
      // 仅"从不锁定"模式才持久化到 local storage
      await chrome.storage.local.set(data);
    } else {
      // 确保 local storage 中没有残留密钥
      await chrome.storage.local.remove("userKey");
    }
  },

  /**
   * 获取用户密钥
   * 优先从 session 获取；仅在"从不锁定"模式下从 local 恢复
   */
  async getUserKey(): Promise<Uint8Array | null> {
    try {
      // 优先从 session storage 获取（会话期间有效）
      const sessionResult = await chrome.storage.session.get("userKey");
      if (sessionResult.userKey) {
        return new Uint8Array(sessionResult.userKey);
      }

      // 检查锁定设置，仅"从不锁定"时才从 local storage 恢复
      const lockSettings = await this.getLockSettings();
      if (lockSettings && lockSettings.timeoutMin <= 0) {
        const localResult = await chrome.storage.local.get("userKey");
        if (localResult.userKey) {
          // 恢复到 session storage
          await chrome.storage.session.set({ userKey: localResult.userKey });
          return new Uint8Array(localResult.userKey);
        }
      }

      return null;
    } catch {
      return null;
    }
  },

  async clearUserKey(): Promise<void> {
    await chrome.storage.session.remove("userKey");
    await chrome.storage.local.remove("userKey");
  },

  // --- 锁定设置 ---

  async getLockSettings(): Promise<{ timeoutMin: number; lockOnBackground: boolean } | null> {
    try {
      const result = await chrome.storage.local.get("lockSettings");
      return result.lockSettings ?? { timeoutMin: 15, lockOnBackground: false };
    } catch {
      return { timeoutMin: 15, lockOnBackground: false };
    }
  },

  async setLockSettings(settings: { timeoutMin: number; lockOnBackground: boolean }): Promise<void> {
    await chrome.storage.local.set({ lockSettings: settings });
  },
} as const;