// 同步调度器 — 网络恢复检测、队列刷新

import { StorageService } from "../platform/storage.js";
import { SyncClient } from "./sync-client.js";
import { PendingChangesQueue } from "./pending-changes.js";

export class SyncScheduler {
  private client: SyncClient;
  private queue: PendingChangesQueue;
  private isOnline = navigator.onLine;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.client = new SyncClient();
    this.queue = new PendingChangesQueue();
    this.setupNetworkListeners();
  }

  start(intervalMs = 30_000): void {
    this.stop();
    this.syncInterval = setInterval(() => {
      this.performSync();
    }, intervalMs);
    this.performSync();
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private setupNetworkListeners(): void {
    const target = typeof window !== "undefined" ? window : self;
    target.addEventListener("online", () => {
      this.isOnline = true;
      this.performSync();
    });
    target.addEventListener("offline", () => {
      this.isOnline = false;
    });
  }

  async performSync(): Promise<void> {
    if (!this.isOnline) {
      await StorageService.setSyncStatus({
        state: "OFFLINE",
        lastSyncAt: null,
        pendingChanges: (await this.queue.getAll()).length,
        error: null,
      });
      return;
    }

    await StorageService.setSyncStatus({
      state: "SYNCING",
      lastSyncAt: null,
      pendingChanges: (await this.queue.getAll()).length,
      error: null,
    });

    try {
      // 1. 先增量拉取
      await this.client.incrementalSync();

      // 2. 处理本地队列
      await this.flushPendingChanges();

      // 3. 最终增量同步
      await this.client.incrementalSync();

      const lastToken = await StorageService.getLastSyncToken();
      await StorageService.setSyncStatus({
        state: "IDLE",
        lastSyncAt: lastToken,
        pendingChanges: 0,
        error: null,
      });
    } catch (err) {
      await StorageService.setSyncStatus({
        state: "ERROR",
        lastSyncAt: await StorageService.getLastSyncToken(),
        pendingChanges: (await this.queue.getAll()).length,
        error: String(err),
      });
    }
  }

  private async flushPendingChanges(): Promise<void> {
    const changes = await this.queue.getAll();
    if (changes.length === 0) return;

    const lastSyncToken = (await StorageService.getLastSyncToken()) || "";
    const result = await this.client.pushChanges({
      changes: changes.map((c) => ({
        id: c.cipherId,
        type: c.operation,
        cipher: {
          id: c.cipherId,
          userId: c.userId,
          type: c.type,
          data: c.encryptedData,
          favorite: c.favorite,
          reprompt: c.reprompt,
          createdAt: c.createdAt,
          modifiedAt: c.modifiedAt,
        },
        clientTimestamp: c.clientTimestamp,
      })),
      lastSyncToken,
    });

    console.log(
      `[SyncScheduler] push result: accepted=${result.accepted.length}, rejected=${result.rejected.length}, conflicts=${result.conflicts.length}`
    );
    if (result.rejected.length > 0) {
      console.warn(`[SyncScheduler] rejected cipherIds:`, result.rejected);
    }

    for (const acceptedId of result.accepted) {
      const change = changes.find((c) => c.cipherId === acceptedId);
      if (change) {
        await this.queue.dequeue(change.id);
      }
    }

    for (const conflictId of result.conflicts) {
      const change = changes.find((c) => c.cipherId === conflictId);
      if (change && change.retryCount < 5) {
        await this.queue.incrementRetry(change.id);
      } else if (change) {
        await this.queue.dequeue(change.id);
      }
    }
  }
}
