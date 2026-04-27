/**
 * Edge 扩展端到端测试 — 自动填充核心逻辑
 * 测试不涉及 DOM 的纯逻辑组件
 */

import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { parseUri, isUriMatch, getBaseDomain } from "../../src/autofill/domain-utils.js";
import { parseOtpauthUri, generateTotpCode } from "../../src/crypto/totp.js";

// Node 环境下确保全局 crypto 可用
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
}

describe("Autofill Logic E2E", () => {
  it("should parse web URI and extract domain", () => {
    const result = parseUri("https://www.example.com/login");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("web");
    expect(result!.baseDomain).toBe("example.com");
  });

  it("should parse android app URI", () => {
    const result = parseUri("androidapp://com.example.app");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("android");
    expect(result!.packageName).toBe("com.example.app");
  });

  it("should match same base domain", () => {
    const a = parseUri("https://www.example.com");
    const b = parseUri("https://sub.example.com");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(isUriMatch(a!, b!, [])).toBe(true);
  });

  it("should not match different domains", () => {
    const a = parseUri("https://example.com");
    const b = parseUri("https://other.com");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(isUriMatch(a!, b!, [])).toBe(false);
  });

  it("should respect domain association rules", () => {
    const a = parseUri("https://a.com");
    const b = parseUri("https://b.com");
    const rules = [{ domains: ["a.com", "b.com"], packageNames: [] }];
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(isUriMatch(a!, b!, rules)).toBe(true);
  });

  it("should generate valid TOTP code", async () => {
    const config = parseOtpauthUri("otpauth://totp/Test:user?secret=JBSWY3DPEHPK3PXP&issuer=Test");
    expect(config).not.toBeNull();
    const { code } = await generateTotpCode(config!);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("should extract base domain correctly", () => {
    expect(getBaseDomain("example.com")).toBe("example.com");
    expect(getBaseDomain("www.example.com")).toBe("example.com");
    expect(getBaseDomain("sub.www.example.com")).toBe("example.com");
  });
});
