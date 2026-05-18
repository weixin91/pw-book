import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";
import { clearMockStorage } from "../../tests/mocks/chrome-mock.js";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      writable: true,
      configurable: true,
    });
  }
});

// 维护内存 cipher 数组，让 create / get 流程可串联测试
const mockCiphers: unknown[] = [];

vi.mock("../platform/storage.js", () => ({
  StorageService: {
    getUserKey: vi.fn(() => Promise.resolve(new Uint8Array(64))),
    getCiphers: vi.fn(() => Promise.resolve([...mockCiphers])),
    setCiphers: vi.fn((ciphers: unknown[]) => {
      mockCiphers.length = 0;
      mockCiphers.push(...ciphers);
      return Promise.resolve();
    }),
    getDomainAssociations: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("../crypto/crypto-service.js", () => ({
  toBufferSource: (buf: Uint8Array) => buf as unknown as BufferSource,
  encryptCipherData: vi.fn((plain: string) => Promise.resolve("enc:" + plain)),
  decryptCipherData: vi.fn((data: string) => {
    if (typeof data === "string" && data.startsWith("enc:")) {
      return Promise.resolve(data.slice(4));
    }
    return Promise.resolve(data);
  }),
}));

vi.mock("../sync/pending-changes.js", () => ({
  PendingChangesQueue: class {
    async enqueue() {}
  },
}));

import { StorageService } from "../platform/storage.js";
import {
  handleWebAuthnCreate,
  handleWebAuthnGet,
  originToRpId,
  buildClientDataJSON,
  bytes,
  deserializeBuffers,
  type BufferMarker,
} from "./webauthn-handler";

function b64(marker: unknown): string {
  return (marker as BufferMarker).__pwbookBytes;
}

describe("webauthn-handler", () => {
  beforeEach(() => {
    mockCiphers.length = 0;
    vi.clearAllMocks();
    clearMockStorage();
  });

  describe("originToRpId", () => {
    it("使用当前 host 作为默认 rpId", () => {
      expect(originToRpId("https://example.com", undefined)).toBe("example.com");
    });

    it("允许请求子域", () => {
      expect(originToRpId("https://www.example.com", "example.com")).toBe("example.com");
    });

    it("拒绝跨域 rpId 回退到 host", () => {
      expect(originToRpId("https://evil.com", "example.com")).toBe("evil.com");
    });
  });

  describe("bytes / deserializeBuffers", () => {
    it("bytes 生成 BufferMarker", () => {
      const buf = new Uint8Array([1, 2, 3]);
      const marker = bytes(buf);
      expect(marker.__pwbookBytes).toBeTypeOf("string");
    });

    it("deserializeBuffers 可逆", () => {
      const orig = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const marker = bytes(orig);
      const restored = deserializeBuffers(marker);
      expect(restored).toBeInstanceOf(Uint8Array);
      expect(restored).toEqual(orig);
    });

    it("deserializeBuffers 递归处理对象", () => {
      const payload = {
        a: bytes(new Uint8Array([1])),
        nested: { b: bytes(new Uint8Array([2])) },
      };
      const result = deserializeBuffers(payload) as Record<string, Record<string, unknown>>;
      expect(result.a).toEqual(new Uint8Array([1]));
      expect(result.nested.b).toEqual(new Uint8Array([2]));
    });
  });

  describe("buildClientDataJSON", () => {
    it("包含 type、challenge、origin", () => {
      const challenge = new Uint8Array([0xab, 0xcd]);
      const json = buildClientDataJSON("webauthn.create", challenge, "https://example.com");
      const parsed = JSON.parse(new TextDecoder().decode(json));
      expect(parsed.type).toBe("webauthn.create");
      expect(parsed.origin).toBe("https://example.com");
      expect(parsed.challenge).toBeTruthy();
      expect(parsed.crossOrigin).toBe(false);
    });
  });

  describe("handleWebAuthnCreate", () => {
    it("创建 Passkey 并返回正确结构", async () => {
      const result = await handleWebAuthnCreate("https://example.com", {
        rp: { id: "example.com", name: "Example" },
        user: { id: new Uint8Array([1, 2, 3]), name: "user", displayName: "User" },
        challenge: new Uint8Array(16),
      });

      expect(result.id).toBeTruthy();
      expect(b64(result.rawId)).toBeTruthy();
      expect(b64(result.response.clientDataJSON)).toBeTruthy();
      expect(b64(result.response.attestationObject)).toBeTruthy();

      // 验证 cipher 已写入存储
      const stored = await StorageService.getCiphers();
      expect(stored.length).toBe(1);
      expect(stored[0].type).toBe(1); // LOGIN（passkey 作为 LOGIN 的附加字段存储）
    });

    it("未解锁时抛出错误", async () => {
      vi.mocked(StorageService.getUserKey).mockResolvedValueOnce(null);
      await expect(
        handleWebAuthnCreate("https://example.com", {
          rp: { id: "example.com", name: "Example" },
          user: { id: new Uint8Array(8), name: "u", displayName: "U" },
          challenge: new Uint8Array(16),
        })
      ).rejects.toThrow("保险库未解锁");
    });
  });

  describe("handleWebAuthnGet", () => {
    it("没有匹配 Passkey 时抛出错误", async () => {
      await expect(
        handleWebAuthnGet("https://example.com", {
          rpId: "example.com",
          challenge: new Uint8Array(16),
          allowCredentials: [],
        })
      ).rejects.toThrow("当前站点没有可用的 Passkey");
    });

    it("创建后使用 Passkey 返回 assertion", async () => {
      // 先创建
      const created = await handleWebAuthnCreate("https://example.com", {
        rp: { id: "example.com", name: "Example" },
        user: { id: new Uint8Array([1, 2, 3]), name: "user", displayName: "User" },
        challenge: new Uint8Array(16),
      });

      // 模拟 getCiphers 返回已创建的 cipher
      const stored = await StorageService.getCiphers();
      mockCiphers.length = 0;
      mockCiphers.push(...stored);

      const result = await handleWebAuthnGet("https://example.com", {
        rpId: "example.com",
        challenge: new Uint8Array(16),
        allowCredentials: [],
      });

      expect(result.id).toBe(created.id);
      expect(b64(result.response.authenticatorData)).toBeTruthy();
      expect(b64(result.response.signature)).toBeTruthy();
      expect(b64(result.response.clientDataJSON)).toBeTruthy();
      expect(b64(result.response.userHandle)).toBeTruthy();
    });

    it("allowCredentials 过滤不匹配时抛出错误", async () => {
      // 先创建
      await handleWebAuthnCreate("https://example.com", {
        rp: { id: "example.com", name: "Example" },
        user: { id: new Uint8Array([1, 2, 3]), name: "user", displayName: "User" },
        challenge: new Uint8Array(16),
      });

      const stored = await StorageService.getCiphers();
      mockCiphers.length = 0;
      mockCiphers.push(...stored);

      // 用错误的 credential id 请求
      await expect(
        handleWebAuthnGet("https://example.com", {
          rpId: "example.com",
          challenge: new Uint8Array(16),
          allowCredentials: [{ id: new Uint8Array(32) }],
        })
      ).rejects.toThrow("当前站点没有可用的 Passkey");
    });

    it("使用正确 allowCredentials 可匹配", async () => {
      const created = await handleWebAuthnCreate("https://example.com", {
        rp: { id: "example.com", name: "Example" },
        user: { id: new Uint8Array([1, 2, 3]), name: "user", displayName: "User" },
        challenge: new Uint8Array(16),
      });

      const stored = await StorageService.getCiphers();
      mockCiphers.length = 0;
      mockCiphers.push(...stored);

      // 用正确的 credential id（base64url decode 后重新 encode）
      const { base64UrlDecode } = await import("../platform/base64.js");
      const credentialIdBytes = base64UrlDecode(created.id);

      const result = await handleWebAuthnGet("https://example.com", {
        rpId: "example.com",
        challenge: new Uint8Array(16),
        allowCredentials: [{ id: credentialIdBytes }],
      });

      expect(result.id).toBe(created.id);
      expect(b64(result.response.signature)).toBeTruthy();
    });
  });
});
