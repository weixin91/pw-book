// Edge E2E 测试共用 chrome API mock
// 在 vitest.config.ts 中通过 setupFiles 注入，避免每个测试文件重复定义

import { vi } from "vitest";

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
      remove: vi.fn((keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const key of keyArray) {
          delete mockStorage[key];
        }
        return Promise.resolve();
      }),
    },
    session: {
      get: vi.fn((keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of keyArray) {
          result[key] = mockStorage[`session_${key}`] ?? undefined;
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          mockStorage[`session_${key}`] = value;
        }
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const key of keyArray) {
          delete mockStorage[`session_${key}`];
        }
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve()),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    sendMessage: vi.fn(() => Promise.resolve()),
    query: vi.fn(() => Promise.resolve([])),
  },
  alarms: {
    create: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve(true)),
    onAlarm: {
      addListener: vi.fn(),
    },
  },
  idle: {
    onStateChanged: {
      addListener: vi.fn(),
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

export function clearMockStorage(): void {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
}

export { mockStorage };
