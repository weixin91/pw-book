/**
 * Edge 扩展端到端测试 — 同步流程
 * 测试同步客户端核心逻辑
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PendingChangesQueue } from "../../src/sync/pending-changes.js";
import { clearMockStorage } from "../mocks/chrome-mock.js";

describe("Sync E2E", () => {
  beforeEach(() => {
    clearMockStorage();
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
