// 离线待处理变更队列 — chrome.storage.local、FIFO 处理

import { StorageService } from "../platform/storage.js";
import type { PendingChange } from "@pwbook/shared-types";

export class PendingChangesQueue {
  async enqueue(change: Omit<PendingChange, "id" | "retryCount">): Promise<void> {
    const changes = await StorageService.getPendingChanges();
    const newChange: PendingChange = {
      ...change,
      id: crypto.randomUUID(),
      retryCount: 0,
    };
    changes.push(newChange);
    await StorageService.setPendingChanges(changes);
    // 通知后台立即尝试同步
    try {
      chrome.runtime.sendMessage({ type: "TRIGGER_SYNC_NOW" });
    } catch {
      // ignore
    }
  }

  async dequeue(changeId: string): Promise<void> {
    await StorageService.removePendingChange(changeId);
  }

  async getAll(): Promise<PendingChange[]> {
    return StorageService.getPendingChanges();
  }

  async clear(): Promise<void> {
    await StorageService.setPendingChanges([]);
  }

  async incrementRetry(changeId: string): Promise<void> {
    const changes = await StorageService.getPendingChanges();
    const change = changes.find((c) => c.id === changeId);
    if (change) {
      change.retryCount += 1;
      await StorageService.setPendingChanges(changes);
    }
  }
}
