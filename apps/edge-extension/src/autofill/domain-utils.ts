// 基础域名提取与 URI 匹配工具
//
// 设计目标：
// 1. 浏览器 URL（http/https）→ 抽取 hostname，再按 PSL 简化规则获取基础域名
// 2. Android 包名 URI（androidapp://com.example）→ 抽取包名作为标识
// 3. 提供统一的 URI 匹配 API，便于自动填充与保存提示复用
// 4. 对域名关联规则（DomainAssociation）提供成员化判断

const ANDROID_PROTOCOL = "androidapp://";

/** 常见多段顶级域后缀（简化版 PSL，覆盖中国/英国/日本等常见情况） */
const MULTI_PART_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk",
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  "com.hk", "org.hk", "edu.hk", "gov.hk",
  "com.tw", "org.tw", "edu.tw", "gov.tw",
  "com.au", "net.au", "org.au", "edu.au",
  "co.kr", "or.kr",
  "com.sg", "edu.sg", "gov.sg",
]);

/** 从 hostname 中提取基础域名（如 `www.tieba.baidu.com` → `baidu.com`） */
export function getBaseDomain(hostname: string): string {
  const host = (hostname || "").toLowerCase().trim();
  if (!host) return "";

  // 已经是 IP 或单段，直接返回
  if (/^[\d.]+$/.test(host) || /^[a-f0-9:]+$/.test(host)) return host;
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 1) return host;
  if (parts.length === 2) return parts.join(".");

  // 检查最后两段是否构成多段后缀
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/**
 * URI 标准化：返回用于匹配的关键标识
 * - http/https → 基础域名
 * - androidapp://com.example → com.example（小写）
 * - 其他协议 → 原样小写
 */
export interface UriIdentifier {
  /** 类型：web 或 android */
  kind: "web" | "android" | "other";
  /** 主机名（仅 web） */
  hostname?: string;
  /** 基础域名（仅 web，等价于 getBaseDomain(hostname)） */
  baseDomain?: string;
  /** Android 包名（仅 android） */
  packageName?: string;
  /** 原始字符串（小写后） */
  raw: string;
}

/** 解析任意 URI 字符串到 UriIdentifier */
export function parseUri(rawUri: string): UriIdentifier | null {
  if (!rawUri) return null;
  const trimmed = rawUri.trim();
  if (!trimmed) return null;

  // androidapp:// 协议
  if (trimmed.toLowerCase().startsWith(ANDROID_PROTOCOL)) {
    const pkg = trimmed.slice(ANDROID_PROTOCOL.length).split(/[/?#]/)[0]?.toLowerCase();
    if (!pkg) return null;
    return { kind: "android", packageName: pkg, raw: trimmed.toLowerCase() };
  }

  // http/https/其他网页协议
  try {
    const u = new URL(trimmed);
    const hostname = u.hostname.toLowerCase();
    if (!hostname) return null;
    return {
      kind: "web",
      hostname,
      baseDomain: getBaseDomain(hostname),
      raw: trimmed.toLowerCase(),
    };
  } catch {
    // 无协议时尝试当成 hostname
    if (/^[\w.-]+(:\d+)?$/.test(trimmed)) {
      const hostname = trimmed.split(":")[0].toLowerCase();
      return {
        kind: "web",
        hostname,
        baseDomain: getBaseDomain(hostname),
        raw: trimmed.toLowerCase(),
      };
    }
    return { kind: "other", raw: trimmed.toLowerCase() };
  }
}

/** 简化版基础域名（接受 URL 或 hostname） */
export function getBaseDomainFromAny(input: string): string {
  const id = parseUri(input);
  if (id?.kind === "web" && id.baseDomain) return id.baseDomain;
  if (id?.kind === "android" && id.packageName) return id.packageName;
  return getBaseDomain(input);
}

/** 检查 hostname 是否落在 pattern 域名（含子域）下 */
export function matchDomain(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}

/**
 * 域名关联规则（DomainAssociation）匹配辅助
 * 用户可通过关联规则把多个不同基础域名/Android 包名归入同一组
 */
export interface DomainAssocLite {
  domains: string[];
  packageNames: string[];
}

/** 同一关联组下的所有标识（基础域名 + 包名） */
export function expandAssociationKeys(rules: DomainAssocLite[], key: string): Set<string> {
  const result = new Set<string>([key]);
  const lowerKey = key.toLowerCase();
  for (const rule of rules) {
    const domains = (rule.domains || []).map((d) => d.toLowerCase());
    const pkgs = (rule.packageNames || []).map((p) => p.toLowerCase());
    if (domains.includes(lowerKey) || pkgs.includes(lowerKey)) {
      domains.forEach((d) => result.add(d));
      pkgs.forEach((p) => result.add(p));
    }
  }
  return result;
}

/**
 * 判断目标 URI 是否与查询源（页面 URL 或包名）匹配
 *
 * 匹配规则：
 * - 同一基础域名 → 共享（含子域名）
 * - 同一 Android 包名 → 共享
 * - 通过 DomainAssociation 关联到同一组
 */
export function isUriMatch(
  source: UriIdentifier,
  target: UriIdentifier,
  rules: DomainAssocLite[] = []
): boolean {
  if (!source || !target) return false;

  // web ↔ web：基础域名 + 子域名匹配
  if (source.kind === "web" && target.kind === "web") {
    if (source.baseDomain && target.baseDomain) {
      if (source.baseDomain === target.baseDomain) return true;
      // 关联规则：基础域名互通
      const expanded = expandAssociationKeys(rules, source.baseDomain);
      if (expanded.has(target.baseDomain)) return true;
    }
    if (source.hostname && target.hostname) {
      if (matchDomain(source.hostname, target.hostname)) return true;
      if (matchDomain(target.hostname, source.hostname)) return true;
    }
    return false;
  }

  // android ↔ android：包名相等或在同一关联组
  if (source.kind === "android" && target.kind === "android") {
    if (source.packageName === target.packageName) return true;
    if (source.packageName) {
      const expanded = expandAssociationKeys(rules, source.packageName);
      if (target.packageName && expanded.has(target.packageName)) return true;
    }
    return false;
  }

  // 跨类型（web ↔ android）：必须通过关联规则
  const sKey = source.kind === "web" ? source.baseDomain : source.packageName;
  const tKey = target.kind === "web" ? target.baseDomain : target.packageName;
  if (!sKey || !tKey) return false;
  const expanded = expandAssociationKeys(rules, sKey);
  return expanded.has(tKey);
}
