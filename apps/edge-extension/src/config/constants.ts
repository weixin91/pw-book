// 边缘扩展全局常量：统一存放时间、阈值、轮询等硬编码值，避免散落各文件

export const POLL_INTERVAL_MS = 2000;
export const MAX_POLL_COUNT = 30;
export const FORM_DATA_TTL_MS = 10_000;
export const FALLBACK_DELAY_MS = 5_000;
export const SYNC_INTERVAL_MS = 600_000; // 10 分钟
export const SAVE_PROMPT_AUTO_DISMISS_MS = 10_000;
export const SAVE_PROMPT_ANIMATION_MS = 800;
export const INLINE_MENU_DEBOUNCE_MS = 200;
export const PASSKEY_REJECT_DAYS = 30;
