// 保险库自动锁定逻辑
// MV3 下 Service Worker 会在空闲约 30s 后被浏览器终止，setTimeout 不会保留；
// 改用 chrome.alarms 才能在 SW 重启后继续触发锁定。

import { StorageService } from "../platform/storage.js";

const DEFAULT_TIMEOUT_MIN = 15;
const LOCK_ALARM_NAME = "lockVault";

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
  await stopLockTimer();
  const settings = await LockSettingsService.load();
  const effectiveTimeout = timeoutMin ?? settings.timeoutMin;
  if (effectiveTimeout <= 0) return; // “从不”锁定，不创建 alarm
  await chrome.alarms.create(LOCK_ALARM_NAME, { delayInMinutes: effectiveTimeout });
}

export async function stopLockTimer(): Promise<void> {
  try {
    await chrome.alarms.clear(LOCK_ALARM_NAME);
  } catch {
    /* ignore */
  }
}

export async function resetLockTimer(timeoutMin?: number): Promise<void> {
  await startLockTimer(timeoutMin);
}

/** 立即锁定保险库 */
export async function lockVault(): Promise<void> {
  await stopLockTimer();
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

/**
 * 注册锁定 alarm 的触发回调。必须在 Service Worker 顶层调用，
 * 这样 SW 被终止后重启时仍能恢复对 alarm 事件的监听。
 */
export function initLockAlarmListener(): void {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LOCK_ALARM_NAME) {
      StorageService.clearUserKey().catch(() => {});
    }
  });
}
