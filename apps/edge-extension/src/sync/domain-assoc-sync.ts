// 域名关联规则同步 (T057)
//
// 与后端 /api/domain-associations 通信，负责：
// - 列表拉取（已由 SyncClient.fullSync 通过 SyncResponse.domainAssociations 实现）
// - 创建/更新/删除关联规则，并立即写入本地缓存
//
// 设计：
// - 创建/删除走专用 REST 接口，避免与凭据同步队列竞争
// - 任一 mutate 操作成功后，强制刷新本地缓存（避免本地与后端不一致）
// - 网络失败时抛出，由调用方决定重试策略

import { StorageService } from "../platform/storage.js";
import { fetchWithAuth } from "./auth-http.js";
import type { DomainAssociation } from "@pwbook/shared-types";

interface CreateAssocPayload {
  domains: string[];
  packageNames: string[];
}

interface UpdateAssocPayload {
  id: string;
  domains: string[];
  packageNames: string[];
}

export class DomainAssocSync {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? "";
  }

  private async getBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      this.baseUrl = await StorageService.getServerUrl();
    }
    return this.baseUrl;
  }

  /** 全量获取域名关联规则并刷新本地缓存 */
  async pull(): Promise<DomainAssociation[]> {
    const baseUrl = await this.getBaseUrl();
    const res = await fetchWithAuth(`${baseUrl}/api/domain-associations`);
    if (!res.ok) {
      throw new Error(`拉取域名关联失败: ${res.status}`);
    }
    const body = (await res.json()) as { data: DomainAssociation[] };
    const list = body.data ?? [];
    await StorageService.setDomainAssociations(list);
    return list;
  }

  /** 创建一条新的关联规则 */
  async create(payload: CreateAssocPayload): Promise<DomainAssociation> {
    const baseUrl = await this.getBaseUrl();
    const res = await fetchWithAuth(`${baseUrl}/api/domain-associations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`创建域名关联失败: ${res.status}`);
    }
    const created = (await res.json()) as DomainAssociation;
    const list = await StorageService.getDomainAssociations();
    list.push(created);
    await StorageService.setDomainAssociations(list);
    return created;
  }

  /** 更新一条关联规则（全量替换 domains/packageNames） */
  async update(payload: UpdateAssocPayload): Promise<DomainAssociation> {
    const baseUrl = await this.getBaseUrl();
    const res = await fetchWithAuth(`${baseUrl}/api/domain-associations/${payload.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domains: payload.domains,
        packageNames: payload.packageNames,
      }),
    });
    if (!res.ok) {
      throw new Error(`更新域名关联失败: ${res.status}`);
    }
    const updated = (await res.json()) as DomainAssociation;
    const list = await StorageService.getDomainAssociations();
    const idx = list.findIndex((r) => r.id === updated.id);
    if (idx >= 0) list[idx] = updated;
    else list.push(updated);
    await StorageService.setDomainAssociations(list);
    return updated;
  }

  /** 删除一条关联规则 */
  async remove(id: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    const res = await fetchWithAuth(`${baseUrl}/api/domain-associations/${id}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`删除域名关联失败: ${res.status}`);
    }
    const list = await StorageService.getDomainAssociations();
    await StorageService.setDomainAssociations(list.filter((r) => r.id !== id));
  }
}
