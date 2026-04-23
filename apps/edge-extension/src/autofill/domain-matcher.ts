// 域名匹配算法

import { getBaseDomain } from "./domain-utils.js";
import { decryptCipherData } from "../crypto/crypto-service.js";

export interface CipherItem {
  id: string;
  data: string;
}

export async function findMatchingCiphers(
  url: string,
  ciphers: CipherItem[],
  userKey: Uint8Array
): Promise<Array<{ cipher: CipherItem; data: Record<string, unknown> }>> {
  const hostname = new URL(url).hostname.toLowerCase();
  const baseDomain = getBaseDomain(hostname);

  const matched: Array<{ cipher: CipherItem; data: Record<string, unknown> }> = [];

  for (const cipher of ciphers) {
    try {
      const plainText = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plainText) as Record<string, unknown>;
      const uris = (data.login as Record<string, unknown> | undefined)?.uris as Array<{ uri?: string }> | undefined ?? [];
      const matches = uris.some((u: { uri?: string }) => {
        if (!u.uri) return false;
        try {
          const uHost = new URL(u.uri).hostname.toLowerCase();
          return (
            hostname === uHost ||
            hostname.endsWith(`.${uHost}`) ||
            uHost.endsWith(`.${hostname}`) ||
            baseDomain === getBaseDomain(uHost)
          );
        } catch {
          return u.uri.includes(hostname);
        }
      });
      if (matches) matched.push({ cipher, data });
    } catch {
      // 跳过解密/解析失败的条目
    }
  }

  return matched;
}
