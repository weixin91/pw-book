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

/**
 * 验证客户端推送的校验和是否与服务端计算的一致
 */
export function validateSyncChecksum(ciphers: Array<{ id: string; modifiedAt: Date }>, expectedChecksum: string): boolean {
  return calculateSyncChecksum(ciphers) === expectedChecksum;
}

/**
 * 为同步响应生成包含校验和的载荷
 */
export function buildSyncPayload<T extends { id: string; modifiedAt: Date }>(
  ciphers: T[]
): { ciphers: T[]; checksum: string } {
  return {
    ciphers,
    checksum: calculateSyncChecksum(ciphers),
  };
}
