// TOTP 验证码生成器
// 遵循 RFC 6238（TOTP）+ RFC 4226（HOTP），支持 SHA-1 / SHA-256 / SHA-512

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpConfig {
  secret: string; // Base32 编码
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  issuer?: string;
  accountName?: string;
}

export interface TotpCode {
  code: string;
  remainingSeconds: number;
  period: number;
}

const DEFAULT_CONFIG = {
  algorithm: "SHA1" as TotpAlgorithm,
  digits: 6,
  period: 30,
};

// Base32 解码（RFC 4648，忽略空格、连字符与小写）
export function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/\s+|-/g, "").toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const idx = alphabet.indexOf(cleaned[i]);
    if (idx < 0) {
      throw new Error(`Base32 解码失败：非法字符 "${cleaned[i]}"`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// 解析 otpauth:// URI；非 URI 输入则视作裸 secret，使用默认参数
export function parseOtpauthUri(input: string): TotpConfig | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (!trimmed.toLowerCase().startsWith("otpauth://")) {
    // 视作裸 Base32 secret
    try {
      base32Decode(trimmed);
    } catch {
      return null;
    }
    return {
      secret: trimmed.replace(/\s+|-/g, "").toUpperCase(),
      algorithm: DEFAULT_CONFIG.algorithm,
      digits: DEFAULT_CONFIG.digits,
      period: DEFAULT_CONFIG.period,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "otpauth:") return null;
  if (url.hostname.toLowerCase() !== "totp") return null;

  const secret = url.searchParams.get("secret");
  if (!secret) return null;
  try {
    base32Decode(secret);
  } catch {
    return null;
  }

  const algorithmRaw = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
  const algorithm: TotpAlgorithm =
    algorithmRaw === "SHA256"
      ? "SHA256"
      : algorithmRaw === "SHA512"
      ? "SHA512"
      : "SHA1";

  const digitsRaw = parseInt(url.searchParams.get("digits") ?? "", 10);
  const digits = Number.isFinite(digitsRaw) && digitsRaw >= 6 && digitsRaw <= 10 ? digitsRaw : DEFAULT_CONFIG.digits;

  const periodRaw = parseInt(url.searchParams.get("period") ?? "", 10);
  const period = Number.isFinite(periodRaw) && periodRaw > 0 ? periodRaw : DEFAULT_CONFIG.period;

  // pathname 形如 "/Issuer:account" 或 "/account"
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const issuerFromQuery = url.searchParams.get("issuer") ?? undefined;
  let issuer = issuerFromQuery;
  let accountName: string | undefined;
  if (label) {
    const colonIdx = label.indexOf(":");
    if (colonIdx > 0) {
      issuer = issuer ?? label.slice(0, colonIdx);
      accountName = label.slice(colonIdx + 1);
    } else {
      accountName = label;
    }
  }

  return {
    secret: secret.replace(/\s+|-/g, "").toUpperCase(),
    algorithm,
    digits,
    period,
    issuer,
    accountName,
  };
}

function algorithmToHashName(alg: TotpAlgorithm): string {
  switch (alg) {
    case "SHA256":
      return "SHA-256";
    case "SHA512":
      return "SHA-512";
    case "SHA1":
    default:
      return "SHA-1";
  }
}

// HOTP 计数器：8 字节大端序
function counterToBuffer(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // JavaScript 位运算限制 32 位，需要分高低 32 位处理
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  buf[0] = (high >>> 24) & 0xff;
  buf[1] = (high >>> 16) & 0xff;
  buf[2] = (high >>> 8) & 0xff;
  buf[3] = high & 0xff;
  buf[4] = (low >>> 24) & 0xff;
  buf[5] = (low >>> 16) & 0xff;
  buf[6] = (low >>> 8) & 0xff;
  buf[7] = low & 0xff;
  return buf;
}

// 计算指定计数器值的 HOTP 验证码
async function hotp(
  secretBytes: Uint8Array,
  counter: number,
  algorithm: TotpAlgorithm,
  digits: number
): Promise<string> {
  const hashName = algorithmToHashName(algorithm);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes as unknown as BufferSource,
    { name: "HMAC", hash: hashName },
    false,
    ["sign"]
  );
  const counterBuf = counterToBuffer(counter);
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    counterBuf as unknown as BufferSource
  );
  const hmac = new Uint8Array(sigBuf);

  // 动态截断（RFC 4226 §5.3）
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const modulus = Math.pow(10, digits);
  const code = (binCode % modulus).toString().padStart(digits, "0");
  return code;
}

// 计算给定时间戳（秒）的 TOTP 验证码
export async function generateTotpCode(
  config: TotpConfig,
  nowSeconds?: number
): Promise<TotpCode> {
  const secretBytes = base32Decode(config.secret);
  const seconds = nowSeconds ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(seconds / config.period);
  const code = await hotp(secretBytes, counter, config.algorithm, config.digits);
  const remainingSeconds = config.period - (seconds % config.period);
  return {
    code,
    remainingSeconds,
    period: config.period,
  };
}
