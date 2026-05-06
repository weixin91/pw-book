import { timingSafeEqual } from "node:crypto";

// 长度不等时直接返回 false，避免对不同长度的 buffer 调用 timingSafeEqual 抛错；
// 同长度时使用恒定时间比较，防止通过响应耗时差异推断哈希前缀。
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
