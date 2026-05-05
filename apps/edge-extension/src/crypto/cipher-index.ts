// Cipher 索引管理
// 从加密凭据中提取非敏感匹配字段，用于快速筛选
// 避免 URL 匹配时全量解密，提升性能

import { parseUri, isUriMatch, type UriIdentifier, type DomainAssocLite } from "../autofill/domain-utils.js";
import type { Cipher, CipherData } from "@pwbook/shared-types";

/** 素引条目：存储用于匹配的非敏感信息 */
export interface CipherIndexEntry {
  cipherId: string;
  /** 从 login.uris 提取的基础域名列表 */
  domains: string[];
  /** 从 passkey 提取的 rpId 列表 */
  rpIds: string[];
  /** 用户名哈希（用于去重判断，不存储真实用户名） */
  usernameHash: string | null;
  /** 凭据类型标记 */
  hasLogin: boolean;
  hasPasskey: boolean;
}

const INDEX_KEY = "cipherIndex";

/** 计算用户名哈希（简单 SHA-256，不存储真实用户名） */
async function hashUsername(username: string): Promise<string | null> {
  if (!username) return null;
  const encoder = new TextEncoder();
  const data = encoder.encode(username.toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16); // 只取前 16 字符，足够去重
}

/** 从 CipherData 提取索引信息 */
export async function buildCipherIndexEntry(
  cipherId: string,
  data: CipherData
): Promise<CipherIndexEntry> {
  const domains: string[] = [];
  const rpIds: string[] = [];

  // 从 login.uris 提取域名
  if (data.login?.uris) {
    for (const u of data.login.uris) {
      if (u.uri) {
        const id = parseUri(u.uri);
        if (id?.kind === "web" && id.baseDomain) {
          domains.push(id.baseDomain);
        } else if (id?.kind === "android" && id.packageName) {
          domains.push(id.packageName);
        }
      }
    }
  }

  // 从 passkey 提取 rpId
  if (data.passkey?.rpId) {
    rpIds.push(data.passkey.rpId.toLowerCase());
  }

  // 用户名哈希
  const usernameHash = data.login?.username
    ? await hashUsername(data.login.username)
    : null;

  return {
    cipherId,
    domains,
    rpIds,
    usernameHash,
    hasLogin: !!data.login,
    hasPasskey: !!data.passkey,
  };
}

/** 索引存储服务 */
export const CipherIndexService = {
  /** 获取全部索引 */
  async getAll(): Promise<CipherIndexEntry[]> {
    const result = await chrome.storage.local.get(INDEX_KEY);
    return result[INDEX_KEY] ?? [];
  },

  /** 设置全部索引 */
  async setAll(entries: CipherIndexEntry[]): Promise<void> {
    await chrome.storage.local.set({ [INDEX_KEY]: entries });
  },

  /** 根据凭据列表重建索引（需要解密） */
  async rebuild(
    ciphers: Cipher[],
    decryptFn: (data: string) => Promise<string>
  ): Promise<void> {
    const entries: CipherIndexEntry[] = [];
    for (const cipher of ciphers) {
      try {
        const plain = await decryptFn(cipher.data);
        const data = JSON.parse(plain) as CipherData;
        const entry = await buildCipherIndexEntry(cipher.id, data);
        entries.push(entry);
      } catch {
        // 解密失败，跳过该凭据
      }
    }
    await this.setAll(entries);
  },

  /** 更新单个凭据的索引 */
  async updateOne(cipherId: string, data: CipherData): Promise<void> {
    const entries = await this.getAll();
    const entry = await buildCipherIndexEntry(cipherId, data);
    const idx = entries.findIndex((e) => e.cipherId === cipherId);
    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }
    await this.setAll(entries);
  },

  /** 删除单个凭据的索引 */
  async removeOne(cipherId: string): Promise<void> {
    const entries = await this.getAll();
    const filtered = entries.filter((e) => e.cipherId !== cipherId);
    await this.setAll(filtered);
  },

  /** 清空索引 */
  async clear(): Promise<void> {
    await chrome.storage.local.remove(INDEX_KEY);
  },

  /** 根据域名筛选匹配的 cipher ID 列表 */
  filterByDomain(
    entries: CipherIndexEntry[],
    sourceId: UriIdentifier,
    rules: DomainAssocLite[]
  ): string[] {
    return entries
      .filter((e) => {
        // 检查域名匹配
        for (const domain of e.domains) {
          const targetId = parseUri(domain);
          if (targetId && isUriMatch(sourceId, targetId, rules)) {
            return true;
          }
        }
        return false;
      })
      .map((e) => e.cipherId);
  },

  /** 根据域名和用户名哈希筛选（用于去重判断） */
  filterByDomainAndUsername(
    entries: CipherIndexEntry[],
    sourceId: UriIdentifier,
    username: string,
    rules: DomainAssocLite[]
  ): Promise<string[]> {
    return hashUsername(username).then((hash) => {
      return entries
        .filter((e) => {
          // 域名匹配
          const domainMatch = e.domains.some((domain) => {
            const targetId = parseUri(domain);
            return targetId && isUriMatch(sourceId, targetId, rules);
          });
          if (!domainMatch) return false;
          // 用户名匹配（哈希相等）
          if (hash && e.usernameHash !== hash) return false;
          return true;
        })
        .map((e) => e.cipherId);
    });
  },

  /** 根据 rpId 筛选 passkey 凭据 */
  filterByRpId(
    entries: CipherIndexEntry[],
    rpId: string
  ): string[] {
    const lowerRpId = rpId.toLowerCase();
    return entries
      .filter((e) => e.hasPasskey && e.rpIds.includes(lowerRpId))
      .map((e) => e.cipherId);
  },

  /** 根据 rpId 和域名筛选（Passkey 注册候选） */
  filterPasskeyCandidates(
    entries: CipherIndexEntry[],
    hostname: string,
    rules: DomainAssocLite[]
  ): string[] {
    return entries
      .filter((e) => {
        if (!e.hasLogin) return false;
        // 检查域名匹配（子域名共享）
        for (const domain of e.domains) {
          const d = domain.toLowerCase();
          const h = hostname.toLowerCase();
          if (d === h || h.endsWith(`.${d}`) || d.endsWith(`.${h}`)) {
            return true;
          }
        }
        return false;
      })
      .map((e) => e.cipherId);
  },
};