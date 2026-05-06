// 多段顶级域后缀（简化版 PSL）
//
// 目的：在 Edge 与 Android 之间统一基础域名（baseDomain）的提取规则，
// 防止同一 URL 在两端解析出不同结果，导致跨平台凭据匹配不一致。
//
// 同步要求：
// - Edge 直接 import 本常量；
// - Android 端 `apps/android/.../UriMatcher.kt` 中的 `MULTI_SEGMENT_TLDS`
//   必须与本文件保持一致（合并集），调整时需同步两侧。

export const MULTI_SEGMENT_TLDS: readonly string[] = [
  // 中国大陆
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  // 英国
  "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk",
  // 日本
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  // 中国香港
  "com.hk", "org.hk", "edu.hk", "gov.hk",
  // 中国台湾
  "com.tw", "org.tw", "edu.tw", "gov.tw",
  // 澳大利亚
  "com.au", "net.au", "org.au", "edu.au",
  // 韩国
  "co.kr", "or.kr",
  // 新加坡
  "com.sg", "edu.sg", "gov.sg",
  // 巴西
  "com.br",
  // 墨西哥
  "com.mx",
  // 南非
  "co.za",
  // 印度
  "co.in",
  // 阿根廷
  "com.ar",
  // 土耳其
  "com.tr",
  // 乌克兰
  "com.ua",
  // 马来西亚
  "com.my",
  // 越南
  "com.vn",
  // 印度尼西亚
  "co.id",
  // 菲律宾
  "com.ph",
  // 泰国
  "com.th",
  // 新西兰
  "co.nz",
  // 波兰
  "com.pl",
  // 俄罗斯
  "com.ru",
  // 公共平台托管域名（PSL 规则）
  "github.io",
  "gitlab.io",
  "gitee.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "fly.dev",
  "railway.app",
  "herokuapp.com",
  "firebaseapp.com",
  "web.app",
  "azurewebsites.net",
  "cloudfront.net",
  "amazonaws.com",
  "workers.dev",
  "blogspot.com",
  "wordpress.com",
  "glitch.me",
  "repl.co",
  "codeberg.page",
  "render.com",
  "surge.sh",
];

export const MULTI_SEGMENT_TLD_SET: ReadonlySet<string> = new Set(MULTI_SEGMENT_TLDS);
