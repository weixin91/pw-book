// 剪贴板安全管理器 — 10 秒自动清空

let currentTimer: ReturnType<typeof setTimeout> | null = null;
let lastCopiedValue = "";

export const ClipboardManager = {
  async copy(text: string): Promise<void> {
    // 如果正在倒计时不同值，先清空旧值
    if (currentTimer && lastCopiedValue !== text) {
      await this.clear();
      if (currentTimer) clearTimeout(currentTimer);
    }

    await navigator.clipboard.writeText(text);
    lastCopiedValue = text;

    if (currentTimer) clearTimeout(currentTimer);
    currentTimer = setTimeout(() => {
      this.clear().catch(() => {});
    }, 10_000);
  },

  async clear(): Promise<void> {
    try {
      await navigator.clipboard.writeText("");
    } catch {
      // 剪贴板写入权限问题，静默处理
    }
    lastCopiedValue = "";
    currentTimer = null;
  },
} as const;
