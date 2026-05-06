// 同步载荷校验和验证
// 遵循 contracts/sync-protocol.md 第 7.1 节

import { createHash } from "crypto";

/**
 * 计算同步数据的 SHA-256 校验和
 * 公式: SHA-256(ciphers.map(c => c.id + c.modifiedAt).join(""))
 */
export function calculateSyncChecksum(ciphers: Array<{ id: string; modifiedAt: Date }>): string {
  const payload = ciphers
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => c.id + c.modifiedAt.toISOString())
    .join("");
  return createHash("sha256").update(payload).digest("hex");
}
