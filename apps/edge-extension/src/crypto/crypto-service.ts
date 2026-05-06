// Web Crypto API 加密核心实现
// 遵循 contracts/crypto.md 规范

import { RECOVERY_KEY_PBKDF2_ITERATIONS, MASTER_KEY_PBKDF2_ITERATIONS } from "@pwbook/shared-types";
import { bytesToBase64, base64ToBytes } from "../platform/base64.js";

const ENC_INFO = new TextEncoder().encode("enc");
const MAC_INFO = new TextEncoder().encode("mac");

export interface KdfConfig {
  kdfType: "PBKDF2_SHA256" | "ARGON2ID";
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
}

// Uint8Array 天然兼容 BufferSource，包装以消除重复的类型断言噪音
export function toBufferSource(buf: Uint8Array): BufferSource {
  return buf as unknown as BufferSource;
}

export async function sha256(input: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input.toLowerCase().trim());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

export async function deriveMasterKey(
  password: string,
  email: string,
  config: KdfConfig
): Promise<Uint8Array> {
  const salt = await sha256(email);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // 注：Web Crypto 原生不支持 Argon2id，此处统一使用 PBKDF2
  // 实际生产环境需通过 WebAssembly 引入 argon2-browser
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations: config.kdfIterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

export async function deriveMasterPasswordHash(
  masterKey: Uint8Array,
  password: string
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toBufferSource(masterKey),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  // 提升至 600000 次迭代（OWASP 2023 推荐），防止暴力破解
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(password),
      iterations: MASTER_KEY_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toBufferSource(ikm), "HKDF", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toBufferSource(salt ?? new Uint8Array(0)), info: toBufferSource(info) },
    key,
    length * 8
  );
  return new Uint8Array(derivedBits);
}

export async function deriveStretchedMasterKey(masterKey: Uint8Array): Promise<Uint8Array> {
  const encPart = await hkdfSha256(masterKey, null, ENC_INFO, 32);
  const macPart = await hkdfSha256(masterKey, null, MAC_INFO, 32);
  const result = new Uint8Array(64);
  result.set(encPart, 0);
  result.set(macPart, 32);
  return result;
}

export async function generateUserKey(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(64));
}

export async function encryptUserKey(
  userKey: Uint8Array,
  stretchedMasterKey: Uint8Array
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    stretchedMasterKey.slice(0, 32),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(iv) },
    aesKey,
    toBufferSource(userKey)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

export async function decryptUserKey(
  protectedKey: string,
  stretchedMasterKey: Uint8Array
): Promise<Uint8Array> {
  const combined = base64ToBytes(protectedKey);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    stretchedMasterKey.slice(0, 32),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );
  return new Uint8Array(plaintext);
}

export async function encryptCipherData(
  plaintext: string,
  userKey: Uint8Array
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    userKey.slice(0, 32),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoder.encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

export async function decryptCipherData(
  encryptedData: string,
  userKey: Uint8Array
): Promise<string> {
  const combined = base64ToBytes(encryptedData);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    userKey.slice(0, 32),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportPublicKeySpki(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

export async function exportPrivateKeyPkcs8(privateKey: CryptoKey): Promise<Uint8Array> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  return new Uint8Array(pkcs8);
}

export async function encryptWithKey(plaintext: Uint8Array, key: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    key.slice(0, 32),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(iv) },
    aesKey,
    toBufferSource(plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

export async function decryptWithKey(encryptedData: string, key: Uint8Array): Promise<Uint8Array> {
  const combined = base64ToBytes(encryptedData);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    key.slice(0, 32),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );
  return new Uint8Array(plaintext);
}

export async function deriveRecoveryKeyHash(
  recoveryKey: string,
  email: string
): Promise<string> {
  const salt = await sha256(email);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(recoveryKey.toUpperCase()),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations: RECOVERY_KEY_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(derivedBits));
}

export async function deriveRecoveryMasterKey(
  recoveryKey: string,
  email: string
): Promise<Uint8Array> {
  const salt = await sha256(email + "recovery");
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(recoveryKey.toUpperCase()),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations: MASTER_KEY_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

export async function generateRecoveryKey(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return base32Encode(bytes);
}

function base32Encode(buffer: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  // 每4字符一组
  return output.match(/.{1,4}/g)?.join("-") ?? output;
}
