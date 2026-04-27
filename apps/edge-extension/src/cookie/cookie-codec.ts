// Cookie 数据编解码与压缩
// JSON -> gzip -> AES-256-GCM 加密 -> Base64；反向解码

import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  encryptWithKey,
  decryptWithKey,
} from "../crypto/crypto-service.js";

/**
 * 使用 CompressionStream 对字符串进行 gzip 压缩
 */
async function gzipCompress(input: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(encoder.encode(input) as any);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // 合并 chunks
  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * 使用 DecompressionStream 对 gzip 压缩数据进行解压
 */
async function gzipDecompress(data: Uint8Array): Promise<string> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(data as any);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

/**
 * 编码：CookieData JSON -> gzip -> AES-256-GCM -> Base64
 */
export async function encodeCookieData(
  cookieData: unknown,
  userKey: Uint8Array
): Promise<string> {
  const jsonStr = JSON.stringify(cookieData);
  const compressed = await gzipCompress(jsonStr);
  return encryptWithKey(compressed as unknown as Uint8Array, userKey);
}

/**
 * 解码：Base64 -> AES-256-GCM 解密 -> gzip 解压 -> JSON
 */
export async function decodeCookieData<T = unknown>(
  encryptedBase64: string,
  userKey: Uint8Array
): Promise<T> {
  const compressed = await decryptWithKey(encryptedBase64, userKey);
  const jsonStr = await gzipDecompress(compressed);
  return JSON.parse(jsonStr) as T;
}
