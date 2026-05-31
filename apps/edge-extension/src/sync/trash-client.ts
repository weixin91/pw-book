// 回收站 REST 客户端
// 封装 /api/ciphers/trash、/:id/restore、/:id/permanent 三个接口

import { StorageService } from "../platform/storage.js";
import { fetchWithAuth } from "./auth-http.js";
import type { Cipher } from "@pwbook/shared-types";

export class TrashClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || "";
  }

  private async getBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      this.baseUrl = await StorageService.getServerUrl();
    }
    return this.baseUrl;
  }

  /** 列出回收站中的所有凭据(按 deletedAt 倒序) */
  async list(): Promise<Cipher[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetchWithAuth(`${baseUrl}/api/ciphers/trash`);
    if (!response.ok) {
      throw new Error(`拉取回收站失败: ${response.status}`);
    }
    return (await response.json()) as Cipher[];
  }

  /** 恢复指定凭据,返回恢复后的 Cipher(deletedAt = null) */
  async restore(id: string): Promise<Cipher> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetchWithAuth(`${baseUrl}/api/ciphers/${id}/restore`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`恢复凭据失败: ${response.status}`);
    }
    return (await response.json()) as Cipher;
  }

  /** 永久删除指定凭据(必须当前为软删除状态) */
  async permanentDelete(id: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetchWithAuth(`${baseUrl}/api/ciphers/${id}/permanent`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`永久删除凭据失败: ${response.status}`);
    }
  }
}
