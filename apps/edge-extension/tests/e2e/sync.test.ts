/**
 * Edge 扩展端到端测试 — 同步流程
 * 测试同步客户端核心逻辑
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PendingChangesQueue } from "../../src/sync/pending-changes.js";

// 模拟 chrome.storage.local
const mockStorage: Record<string, unknown> = {};
(globalThis as unknown as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: vi.fn((keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of keyArray) {
          result[key] = mockStorage[key] ?? [];
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
    },
  },
};

// 确保 crypto.randomUUID 可用（Node <20 兼容性）
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...(globalThis.crypto || {}),
      randomUUID: () => `mock-uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    writable: true,
    configurable: true,
  });
}

describe("Sync E2E", () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  });

  it("should enqueue and dequeue pending changes", async () => {
    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: "cipher-1",
      operation: "CREATE",
      encryptedData: "data-1",
      clientTimestamp: new Date().toISOString(),
    });

    const pending = await queue.getAll();
    expect(pending.length).toBe(1);
    expect(pending[0].cipherId).toBe("cipher-1");
    expect(pending[0].operation).toBe("CREATE");
  });

  it("should maintain FIFO order", async () => {
    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: "cipher-1",
      operation: "CREATE",
      encryptedData: "data-1",
      clientTimestamp: new Date().toISOString(),
    });
    await queue.enqueue({
      cipherId: "cipher-2",
      operation: "UPDATE",
      encryptedData: "data-2",
      clientTimestamp: new Date().toISOString(),
    });

    const pending = await queue.getAll();
    expect(pending.length).toBe(2);
    expect(pending[0].cipherId).toBe("cipher-1");
    expect(pending[1].cipherId).toBe("cipher-2");
  });

  it("should remove processed items", async () => {
    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: "cipher-1",
      operation: "CREATE",
      encryptedData: "data-1",
      clientTimestamp: new Date().toISOString(),
    });

    const pending = await queue.getAll();
    expect(pending.length).toBe(1);

    await queue.dequeue(pending[0].id);
    const afterRemove = await queue.getAll();
    expect(afterRemove.length).toBe(0);
  });
});
