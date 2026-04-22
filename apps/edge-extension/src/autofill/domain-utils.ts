// 基础域名提取工具

export function getBaseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".");
  if (parts.length <= 2) return hostname;
  // 简单实现：取最后两段
  return parts.slice(-2).join(".");
}

export function matchDomain(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}
