// Passkey 存储结构与签名核心
// 遵循 data-model.md §2.2 (PASSKEY 类型 Cipher)、FR-008
//
// 私钥使用 ECDSA P-256，存储为 PKCS#8 (Base64)。
// 实际明文私钥不会直接落盘 —— passkey 字段位于 Cipher.data 内，
// 上层在保存时会与其他凭据数据一同走 AES-256-GCM 加密。

export const CIPHER_TYPE_PASSKEY = 5;

export interface PasskeyData {
  credentialId: string; // base64url
  privateKey: string; // PKCS#8 base64
  publicKey: string; // SPKI base64（用于签名验证 / 注册阶段返回 RP）
  rpId: string;
  rpName?: string;
  userHandle: string; // base64url
  userName?: string;
  userDisplayName?: string;
  counter: number;
  createdAt: string;
}

export interface PasskeyCipherData {
  name: string;
  notes: string | null;
  fields: unknown[];
  lastUsedAt: string | null;
  passkey: PasskeyData;
}

export interface PasskeyCreationParams {
  rpId: string;
  rpName?: string;
  userHandle: Uint8Array;
  userName?: string;
  userDisplayName?: string;
}

export interface PasskeyMaterial {
  data: PasskeyData;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

// 生成全新 Passkey（ECDSA P-256）
export async function generatePasskey(params: PasskeyCreationParams): Promise<PasskeyMaterial> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const credentialIdBytes = crypto.getRandomValues(new Uint8Array(32));
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  const data: PasskeyData = {
    credentialId: base64UrlEncode(credentialIdBytes),
    privateKey: base64Encode(new Uint8Array(pkcs8)),
    publicKey: base64Encode(new Uint8Array(spki)),
    rpId: params.rpId,
    rpName: params.rpName,
    userHandle: base64UrlEncode(params.userHandle),
    userName: params.userName,
    userDisplayName: params.userDisplayName,
    counter: 0,
    createdAt: new Date().toISOString(),
  };

  return { data, privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}

// 导入已有 Passkey 数据（用于解密后断言签名）
export async function importPasskeyPrivateKey(privateKeyB64: string): Promise<CryptoKey> {
  const pkcs8 = base64UrlDecode(privateKeyB64);
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8 as unknown as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

// 导出公钥 P-256 raw 坐标 (x, y) 用于 COSE key 编码
export async function exportPublicKeyRaw(publicKey: CryptoKey): Promise<{ x: Uint8Array; y: Uint8Array }> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
  // raw 格式：0x04 || X(32) || Y(32)
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error("非预期的 P-256 公钥格式");
  }
  return {
    x: raw.slice(1, 33),
    y: raw.slice(33, 65),
  };
}

// 计算 rpIdHash = SHA-256(rpId)
export async function rpIdHash(rpId: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(rpId);
  const hash = await crypto.subtle.digest("SHA-256", enc as unknown as BufferSource);
  return new Uint8Array(hash);
}

// 根据 WebAuthn 规范构造 authenticatorData
// 详见: https://www.w3.org/TR/webauthn-2/#sctn-authenticator-data
export interface AuthenticatorDataOptions {
  rpId: string;
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
  attestedCredentialData?: {
    aaguid: Uint8Array; // 16 bytes
    credentialId: Uint8Array;
    publicKeyCose: Uint8Array; // CBOR 编码的 COSE Key
  };
}

export async function buildAuthenticatorData(opts: AuthenticatorDataOptions): Promise<Uint8Array> {
  const rpHash = await rpIdHash(opts.rpId);
  let flags = 0;
  if (opts.userPresent) flags |= 0x01;
  if (opts.userVerified) flags |= 0x04;
  if (opts.attestedCredentialData) flags |= 0x40;

  const baseLen = 32 + 1 + 4;
  let attLen = 0;
  if (opts.attestedCredentialData) {
    attLen =
      16 +
      2 +
      opts.attestedCredentialData.credentialId.length +
      opts.attestedCredentialData.publicKeyCose.length;
  }

  const buf = new Uint8Array(baseLen + attLen);
  buf.set(rpHash, 0);
  buf[32] = flags;
  buf[33] = (opts.signCount >>> 24) & 0xff;
  buf[34] = (opts.signCount >>> 16) & 0xff;
  buf[35] = (opts.signCount >>> 8) & 0xff;
  buf[36] = opts.signCount & 0xff;

  if (opts.attestedCredentialData) {
    let pos = 37;
    buf.set(opts.attestedCredentialData.aaguid, pos);
    pos += 16;
    const credLen = opts.attestedCredentialData.credentialId.length;
    buf[pos] = (credLen >>> 8) & 0xff;
    buf[pos + 1] = credLen & 0xff;
    pos += 2;
    buf.set(opts.attestedCredentialData.credentialId, pos);
    pos += credLen;
    buf.set(opts.attestedCredentialData.publicKeyCose, pos);
  }

  return buf;
}

// 使用 Passkey 私钥对 (authenticatorData || clientDataHash) 进行 ECDSA-SHA256 签名
// 返回 ASN.1 DER 编码（WebAuthn 要求 IEEE-P1363 → DER 转换）
export async function signAssertion(
  privateKey: CryptoKey,
  authenticatorData: Uint8Array,
  clientDataHash: Uint8Array
): Promise<Uint8Array> {
  const data = new Uint8Array(authenticatorData.length + clientDataHash.length);
  data.set(authenticatorData, 0);
  data.set(clientDataHash, authenticatorData.length);
  const sigRaw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      data as unknown as BufferSource
    )
  );
  // sigRaw 是 IEEE-P1363（r||s 各 32 字节），转 DER 以便 RP 服务端使用主流验证库
  return p1363ToDer(sigRaw);
}

// 构造 COSE_Key（仅 EC2 / P-256 / ES256）
// 手动 CBOR 编码以确保 WebAuthn 规范兼容性
export function encodeCoseKeyEs256(x: Uint8Array, y: Uint8Array): Uint8Array {
  // 简化的 CBOR 编码：固定 5 个键值对的 map
  // map(5) = 0xA5
  // 1 (kty)  -> 2 (EC2)
  // 3 (alg)  -> -7 (ES256)
  // -1 (crv) -> 1 (P-256)
  // -2 (x)   -> bstr(32)
  // -3 (y)   -> bstr(32)

  const out: number[] = [];
  out.push(0xa5); // map of 5

  // 1 -> 2
  out.push(0x01); // unsigned 1
  out.push(0x02); // unsigned 2

  // 3 -> -7
  out.push(0x03);
  out.push(0x26); // negative integer -7 (-7-1=6 → 0x20|0x06)

  // -1 -> 1
  out.push(0x20); // negative 0 (== -1)
  out.push(0x01);

  // -2 -> bstr(32) X
  out.push(0x21); // negative 1 (== -2)
  out.push(0x58); // bytes of length 1-byte length
  out.push(0x20); // length 32
  for (let i = 0; i < x.length; i++) out.push(x[i]);

  // -3 -> bstr(32) Y
  out.push(0x22); // negative 2 (== -3)
  out.push(0x58);
  out.push(0x20);
  for (let i = 0; i < y.length; i++) out.push(y[i]);

  return new Uint8Array(out);
}

// 构造 attestationObject = { fmt: "none", attStmt: {}, authData: <bytes> }
// 使用 fmt=none，避免引入可信硬件证书链
export function encodeAttestationObjectNone(authData: Uint8Array): Uint8Array {
  // CBOR map(3)
  const out: number[] = [];
  out.push(0xa3);

  // "fmt" -> "none"
  pushTextString(out, "fmt");
  pushTextString(out, "none");

  // "attStmt" -> {}
  pushTextString(out, "attStmt");
  out.push(0xa0); // empty map

  // "authData" -> authData bytes
  pushTextString(out, "authData");
  pushByteString(out, authData);

  return new Uint8Array(out);
}

function pushTextString(out: number[], text: string): void {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= 23) {
    out.push(0x60 | bytes.length);
  } else if (bytes.length <= 0xff) {
    out.push(0x78);
    out.push(bytes.length);
  } else {
    out.push(0x79);
    out.push((bytes.length >>> 8) & 0xff);
    out.push(bytes.length & 0xff);
  }
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
}

function pushByteString(out: number[], data: Uint8Array): void {
  if (data.length <= 23) {
    out.push(0x40 | data.length);
  } else if (data.length <= 0xff) {
    out.push(0x58);
    out.push(data.length);
  } else if (data.length <= 0xffff) {
    out.push(0x59);
    out.push((data.length >>> 8) & 0xff);
    out.push(data.length & 0xff);
  } else {
    out.push(0x5a);
    out.push((data.length >>> 24) & 0xff);
    out.push((data.length >>> 16) & 0xff);
    out.push((data.length >>> 8) & 0xff);
    out.push(data.length & 0xff);
  }
  for (let i = 0; i < data.length; i++) out.push(data[i]);
}

// IEEE P1363 (r||s) → ASN.1 DER 编码（ECDSA 签名）
function p1363ToDer(sig: Uint8Array): Uint8Array {
  if (sig.length % 2 !== 0) throw new Error("非法 P1363 签名长度");
  const half = sig.length / 2;
  const r = trimLeadingZeros(sig.slice(0, half));
  const s = trimLeadingZeros(sig.slice(half));
  const rEncoded = encodeAsn1Integer(r);
  const sEncoded = encodeAsn1Integer(s);
  const total = rEncoded.length + sEncoded.length;
  const out = new Uint8Array(2 + total);
  out[0] = 0x30; // SEQUENCE
  out[1] = total;
  out.set(rEncoded, 2);
  out.set(sEncoded, 2 + rEncoded.length);
  return out;
}

function trimLeadingZeros(arr: Uint8Array): Uint8Array {
  let i = 0;
  while (i < arr.length - 1 && arr[i] === 0) i++;
  return arr.slice(i);
}

function encodeAsn1Integer(value: Uint8Array): Uint8Array {
  // 若最高位为 1，需要前置 0x00 以表示正数
  const needsPad = (value[0] & 0x80) !== 0;
  const len = value.length + (needsPad ? 1 : 0);
  const out = new Uint8Array(2 + len);
  out[0] = 0x02; // INTEGER
  out[1] = len;
  if (needsPad) {
    out[2] = 0x00;
    out.set(value, 3);
  } else {
    out.set(value, 2);
  }
  return out;
}

// Base64 / Base64URL 工具
export function base64Encode(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

export function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64UrlEncode(buf: Uint8Array): string {
  return base64Encode(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return base64Decode(padded + "=".repeat(padLen));
}
