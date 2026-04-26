// 同步客户端 — 全量同步、基于时间戳的增量同步

import { StorageService } from "../platform/storage.js";
import type { SyncResponse, SyncPushRequest, SyncPushResponse } from "@pwbook/shared-types";

export class SyncClient {
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

  async fullSync(): Promise<SyncResponse> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/sync`, {
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`同步失败: ${response.status}`);
    }
    const data = (await response.json()) as SyncResponse;
    await this.applySyncData(data);
    return data;
  }

  async incrementalSync(): Promise<SyncResponse> {
    const baseUrl = await this.getBaseUrl();
    const lastToken = await StorageService.getLastSyncToken();
    const url = lastToken
      ? `${baseUrl}/api/sync?since=${encodeURIComponent(lastToken)}`
      : `${baseUrl}/api/sync`;

    const response = await fetch(url, {
      headers: await this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`增量同步失败: ${response.status}`);
    }
    const data = (await response.json()) as SyncResponse;
    await this.applySyncData(data);
    return data;
  }

  async pushChanges(request: SyncPushRequest): Promise<SyncPushResponse> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/sync/push`, {
      method: "POST",
      headers: await this.getAuthHeaders(),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`推送变更失败: ${response.status}`);
    }
    return (await response.json()) as SyncPushResponse;
  }

  private async applySyncData(data: SyncResponse): Promise<void> {
    if (data.ciphers && data.ciphers.length > 0) {
      const localCiphers = await StorageService.getCiphers();
      const localMap = new Map(localCiphers.map((c) => [c.id, c]));

      for (const serverCipher of data.ciphers) {
        const local = localMap.get(serverCipher.id);
        if (!local || new Date(serverCipher.modifiedAt) >= new Date(local.modifiedAt)) {
          localMap.set(serverCipher.id, serverCipher);
        }
      }

      await StorageService.setCiphers(Array.from(localMap.values()));
    }

    // 域名关联规则采用服务端权威：每次拉取都覆盖本地缓存
    if (Array.isArray(data.domainAssociations)) {
      await StorageService.setDomainAssociations(data.domainAssociations);
    }

    await StorageService.setLastSyncToken(data.syncToken);
  }
}
