// Cookie 同步客户端
// 封装 Cookie 同步相关的 HTTP API 调用

import { StorageService } from "../platform/storage.js";

export interface CookieServerRecord {
  id: string;
  domain: string;
  encryptedData: string;
  modifiedAt: string;
}

export interface CookieSyncConfigRecord {
  id: string;
  domain: string;
  autoPush: boolean;
  autoPull: boolean;
  includeLocalStorage: boolean;
  createdAt: string;
  modifiedAt: string;
}

export class CookieSyncClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || "";
  }

  async getBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      this.baseUrl = await StorageService.getServerUrl();
    }
    return this.baseUrl;
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const profile = await StorageService.getProfile();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile?.token || ""}`,
    };
  }

  /** 上传/覆盖某域名 Cookie */
  async uploadCookie(domain: string, encryptedData: string, modifiedAt?: string): Promise<CookieServerRecord> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookies`, {
      method: "POST",
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({
        domain,
        encryptedData,
        modifiedAt: modifiedAt || new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`上传 Cookie 失败: ${response.status}`);
    }
    return (await response.json()) as CookieServerRecord;
  }

  /** 批量上传多域名 Cookie */
  async batchUploadCookies(
    items: Array<{ domain: string; encryptedData: string; modifiedAt?: string }>
  ): Promise<{ accepted: string[]; rejected: string[]; newSyncToken: string }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookies/batch`, {
      method: "POST",
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({
        items: items.map((i) => ({
          domain: i.domain,
          encryptedData: i.encryptedData,
          modifiedAt: i.modifiedAt || new Date().toISOString(),
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`批量上传 Cookie 失败: ${response.status}`);
    }
    return (await response.json()) as { accepted: string[]; rejected: string[]; newSyncToken: string };
  }

  /** 获取某域名 Cookie */
  async fetchCookie(domain: string): Promise<CookieServerRecord | null> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookies/${encodeURIComponent(domain)}`, {
      headers: await this.getAuthHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`拉取 Cookie 失败: ${response.status}`);
    }
    return (await response.json()) as CookieServerRecord;
  }

  /** 获取全部 Cookie 同步列表 */
  async fetchAllCookies(): Promise<{ data: CookieServerRecord[]; syncToken: string }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookies`, {
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`拉取全部 Cookie 失败: ${response.status}`);
    }
    return (await response.json()) as { data: CookieServerRecord[]; syncToken: string };
  }

  /** 删除某域名 Cookie */
  async deleteCookie(domain: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookies/${encodeURIComponent(domain)}`, {
      method: "DELETE",
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`删除 Cookie 失败: ${response.status}`);
    }
  }

  // --- 同步规则配置 ---

  /** 获取所有同步规则 */
  async fetchAllConfigs(): Promise<{ data: CookieSyncConfigRecord[] }> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookie-sync-config`, {
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`拉取同步规则失败: ${response.status}`);
    }
    return (await response.json()) as { data: CookieSyncConfigRecord[] };
  }

  /** 创建/更新某域名同步规则 */
  async upsertConfig(
    domain: string,
    config: { autoPush?: boolean; autoPull?: boolean; includeLocalStorage?: boolean }
  ): Promise<CookieSyncConfigRecord> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookie-sync-config/${encodeURIComponent(domain)}`, {
      method: "PUT",
      headers: await this.getAuthHeaders(),
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`更新同步规则失败: ${response.status}`);
    }
    return (await response.json()) as CookieSyncConfigRecord;
  }

  /** 删除某域名同步规则 */
  async deleteConfig(domain: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/cookie-sync-config/${encodeURIComponent(domain)}`, {
      method: "DELETE",
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`删除同步规则失败: ${response.status}`);
    }
  }
}
