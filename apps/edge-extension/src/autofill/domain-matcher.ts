// 域名/URI 匹配 — 自动填充候选凭据筛选
//
// 匹配规则（按 spec FR-019/FR-020 与 contracts/sync-protocol.md）：
// 1. 凭据 `login.uris` 中任一 URI 与当前页面 URL 匹配 → 命中
// 2. 同一基础域名（含子域名）自动共享
// 3. 通过 DomainAssociation 规则手动关联的多组域名/包名互相共享
//
// 输入的 ciphers 仍保持加密形态，由本模块负责解密以便完成匹配；
// 调用方需要传入 userKey 与（可选）域名关联规则集合。

import { parseUri, isUriMatch, type DomainAssocLite } from "./domain-utils.js";
import { decryptCipherData } from "../crypto/crypto-service.js";

export interface CipherItem {
  id: string;
  data: string;
}

export interface MatchedCipher {
  cipher: CipherItem;
  data: Record<string, unknown>;
}

export async function findMatchingCiphers(
  url: string,
  ciphers: CipherItem[],
  userKey: Uint8Array,
  rules: DomainAssocLite[] = []
): Promise<MatchedCipher[]> {
  const sourceId = parseUri(url);
  if (!sourceId) return [];

  const matched: MatchedCipher[] = [];

  for (const cipher of ciphers) {
    try {
      const plainText = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plainText) as Record<string, unknown>;
      const login = data.login as Record<string, unknown> | undefined;
      const uris = (login?.uris as Array<{ uri?: string }> | undefined) ?? [];

      const isMatch = uris.some((entry) => {
        if (!entry?.uri) return false;
        const targetId = parseUri(entry.uri);
        if (!targetId) return false;
        return isUriMatch(sourceId, targetId, rules);
      });

      if (isMatch) matched.push({ cipher, data });
    } catch {
      // 跳过解密/解析失败的条目
    }
  }

  return matched;
}
