// 域名匹配算法

import { getBaseDomain, matchDomain } from "./domain-utils.js";

export interface CipherItem {
  id: string;
  data: string;
}

export function findMatchingCiphers(
  url: string,
  ciphers: CipherItem[]
): CipherItem[] {
  const hostname = new URL(url).hostname.toLowerCase();
  const baseDomain = getBaseDomain(hostname);

  const matched: CipherItem[] = [];

  for (const cipher of ciphers) {
    try {
      const data = JSON.parse(cipher.data);
      const uris = data.login?.uris ?? [];
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
      if (matches) matched.push(cipher);
    } catch {
      // 跳过解析失败的条目
    }
  }

  return matched;
}
