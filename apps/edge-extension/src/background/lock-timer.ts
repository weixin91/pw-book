// 保险库自动锁定逻辑

import { StorageService } from "../platform/storage.js";

const DEFAULT_TIMEOUT_MIN = 15;
let lockTimer: ReturnType<typeof setTimeout> | null = null;

export function startLockTimer(timeoutMin = DEFAULT_TIMEOUT_MIN): void {
  stopLockTimer();
  lockTimer = setTimeout(() => {
    StorageService.clearUserKey().catch(() => {});
  }, timeoutMin * 60 * 1000);
}

export function stopLockTimer(): void {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
}

export function resetLockTimer(timeoutMin = DEFAULT_TIMEOUT_MIN): void {
  startLockTimer(timeoutMin);
}
