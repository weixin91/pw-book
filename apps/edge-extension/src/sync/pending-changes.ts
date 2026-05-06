// 离线待处理变更队列 — chrome.storage.local、FIFO 处理

import { StorageService } from "../platform/storage.js";
import type { PendingChange } from "@pwbook/shared-types";

export class PendingChangesQueue {
  async enqueue(
    change: Omit<PendingChange, "id" | "retryCount" | "userId" | "type" | "favorite" | "reprompt" | "createdAt" | "modifiedAt"> & Partial<Pick<PendingChange, "userId" | "type" | "favorite" | "reprompt" | "createdAt" | "modifiedAt">>,
    triggerSync = true
  ): Promise<void> {
    const changes = await StorageService.getPendingChanges();
    const wasEmpty = changes.length === 0;
    const now = new Date().toISOString();
    const newChange: PendingChange = {
      ...change,
      userId: change.userId ?? "",
      type: change.type ?? 1,
      favorite: change.favorite ?? false,
      reprompt: change.reprompt ?? 0,
      createdAt: change.createdAt ?? now,
      modifiedAt: change.modifiedAt ?? now,
      id: crypto.randomUUID(),
      retryCount: 0,
    } as PendingChange;
    changes.push(newChange);
    await StorageService.setPendingChanges(changes);
    // 只有首次入队时才触发同步，避免批量入队时重复发送同步请求
    if (triggerSync && wasEmpty) {
      try {
        chrome.runtime.sendMessage({ type: "TRIGGER_SYNC_NOW" });
      } catch {
        // ignore
      }
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
