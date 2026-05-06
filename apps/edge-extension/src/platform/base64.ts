// Base64 / Base64URL 工具函数
// 统一替代分散在 crypto-service.ts、passkey-storage.ts、OptionsApp.tsx 的重复实现

export function bytesToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.byteLength; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlEncode(buf: Uint8Array): string {
  return bytesToBase64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return base64ToBytes(padded + "=".repeat(padLen));
}
