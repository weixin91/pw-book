// Content Script — localStorage 桥接
// 消息接口：GET_LOCAL_STORAGE / SET_LOCAL_STORAGE

export interface LocalStorageItem {
  key: string;
  value: string;
}

function handleGetLocalStorage(): { items: LocalStorageItem[] } {
  const items: LocalStorageItem[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      items.push({ key, value: localStorage.getItem(key) ?? "" });
    }
  } catch (err) {
    console.warn("[PWBook] localStorage 读取失败:", err);
  }
  return { items };
}

function handleSetLocalStorage(items: LocalStorageItem[]): void {
  try {
    for (const item of items) {
      localStorage.setItem(item.key, item.value);
    }
  } catch (err) {
    console.warn("[PWBook] localStorage 写入失败:", err);
  }
}

/** 初始化 localStorage 桥接消息监听 */
export function initLocalStorageBridge(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return false;
    const msg = message as Record<string, unknown>;

    if (msg.type === "GET_LOCAL_STORAGE") {
      sendResponse(handleGetLocalStorage());
      return false;
    }

    if (msg.type === "SET_LOCAL_STORAGE") {
      const items = (msg.items as LocalStorageItem[]) ?? [];
      handleSetLocalStorage(items);
      sendResponse({ success: true });
      return false;
    }

    return false;
  });
}
