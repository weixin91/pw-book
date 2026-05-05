// 保险库自动锁定逻辑
// 支持可配置超时、后台锁定

import { StorageService } from "../platform/storage.js";

const DEFAULT_TIMEOUT_MIN = 15;
let lockTimer: ReturnType<typeof setTimeout> | null = null;

export interface LockSettings {
  timeoutMin: number;
  lockOnBackground: boolean;
}

export const LockSettingsService = {
  async load(): Promise<LockSettings> {
    const settings = await StorageService.getLockSettings();
    return settings ?? { timeoutMin: DEFAULT_TIMEOUT_MIN, lockOnBackground: false };
  },

  async save(settings: LockSettings): Promise<void> {
    await StorageService.setLockSettings(settings);
  },
};

export async function startLockTimer(timeoutMin?: number): Promise<void> {
  stopLockTimer();
  const settings = await LockSettingsService.load();
  const effectiveTimeout = timeoutMin ?? settings.timeoutMin;
  if (effectiveTimeout <= 0) return; // “从不”锁定，不启动定时器
  lockTimer = setTimeout(() => {
    StorageService.clearUserKey().catch(() => {});
  }, effectiveTimeout * 60 * 1000);
}

export function stopLockTimer(): void {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
}

export async function resetLockTimer(timeoutMin?: number): Promise<void> {
  await startLockTimer(timeoutMin);
}

/** 立即锁定保险库 */
export async function lockVault(): Promise<void> {
  stopLockTimer();
  await StorageService.clearUserKey();
}

/** 监听浏览器 idle 状态，后台锁定时立即锁定 */
export function initIdleListener(): void {
  if (typeof chrome !== "undefined" && chrome.idle) {
    chrome.idle.onStateChanged.addListener(async (state) => {
      const settings = await LockSettingsService.load();
      if (settings.lockOnBackground && state === "locked") {
        await lockVault();
      }
    });
  }
}
