// 拒绝保存站点存储 — 30 天内不再提示

export function shouldPromptSave(
  domain: string,
  rejectedSites: Array<{ domain: string; rejectedAt: string; expireAt: string }>
): boolean {
  const now = new Date();
  // 清理过期记录
  const validSites = rejectedSites.filter((r) => new Date(r.expireAt) > now);

  const record = validSites.find(
    (r) => r.domain === domain || domain.endsWith(`.${r.domain}`) || r.domain.endsWith(`.${domain}`)
  );
  return !record;
}
