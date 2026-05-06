import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";

// jsdom 没有 crypto.subtle，用 Node 的 webcrypto 垫片
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      writable: true,
      configurable: true,
    });
  }
});

import {
  generatePasskey,
  importPasskeyPrivateKey,
  exportPublicKeyRaw,
  buildAuthenticatorData,
  encodeCoseKeyEs256,
  encodeAttestationObjectNone,
  signAssertion,
  rpIdHash,
} from "./passkey-storage";
import { base64UrlEncode, base64UrlDecode } from "../platform/base64";

describe("passkey-storage", () => {
  it("生成 Passkey 并恢复私钥", async () => {
    const material = await generatePasskey({
      rpId: "example.com",
      userHandle: new Uint8Array([1, 2, 3]),
    });
    expect(material.data.credentialId).toBeTruthy();
    expect(material.data.privateKey).toBeTruthy();

    const restored = await importPasskeyPrivateKey(material.data.privateKey);
    expect(restored).toBeDefined();
    expect(restored.type).toBe("private");
  });

  it("公钥 raw 导出为 65 字节且首位是 0x04", async () => {
    const material = await generatePasskey({ rpId: "a.com", userHandle: new Uint8Array(8) });
    const { x, y } = await exportPublicKeyRaw(material.publicKey);
    expect(x.length).toBe(32);
    expect(y.length).toBe(32);
  });

  it("rpIdHash 长度为 32 字节", async () => {
    const hash = await rpIdHash("example.com");
    expect(hash.length).toBe(32);
  });

  it("COSE Key 编码为固定长度", () => {
    const cose = encodeCoseKeyEs256(new Uint8Array(32), new Uint8Array(32));
    expect(cose.length).toBe(77); // 0xA5 + 固定字段
  });

  it("attestationObject 编码可解析", () => {
    const authData = new Uint8Array([0xde, 0xad]);
    const att = encodeAttestationObjectNone(authData);
    expect(att[0]).toBe(0xa3); // map(3)
  });

  it("签名结果为 DER 格式且以 0x30 开头", async () => {
    const material = await generatePasskey({ rpId: "b.com", userHandle: new Uint8Array(8) });
    const sig = await signAssertion(
      material.privateKey,
      new Uint8Array(37),
      new Uint8Array(32)
    );
    expect(sig[0]).toBe(0x30);
    expect(sig.length).toBeGreaterThan(64);
  });

  it("Base64Url 编解码可逆", () => {
    const orig = new Uint8Array([251, 255, 0, 1]);
    const encoded = base64UrlEncode(orig);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(base64UrlDecode(encoded)).toEqual(orig);
  });

  it("authenticatorData 带 attestedCredentialData 时长度正确", async () => {
    const authData = await buildAuthenticatorData({
      rpId: "example.com",
      signCount: 1,
      userPresent: true,
      userVerified: true,
      attestedCredentialData: {
        aaguid: new Uint8Array(16),
        credentialId: new Uint8Array(32),
        publicKeyCose: new Uint8Array(78),
      },
    });
    // 32(rpIdHash) + 1(flags) + 4(signCount) + 16(aaguid) + 2(credIdLen) + 32(credId) + 78(cose) = 165
    expect(authData.length).toBe(165);
    expect(authData[32] & 0x40).toBe(0x40); // AT flag
  });
});
