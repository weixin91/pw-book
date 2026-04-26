// 浏览器 API 抽象层，封装所有原生 API 调用

export interface Tab {
  id?: number;
  url?: string;
}

export const BrowserApi = {
  async getActiveTab(): Promise<Tab | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  },

  async getActiveBrowserTab(): Promise<Tab | null> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ?? null;
  },

  async sendMessageToTab(tabId: number, message: unknown): Promise<unknown> {
    return chrome.tabs.sendMessage(tabId, message);
  },

  async sendMessageToRuntime(message: unknown): Promise<unknown> {
    return chrome.runtime.sendMessage(message);
  },

  onMessage(callback: (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => void | boolean): void {
    chrome.runtime.onMessage.addListener(callback);
  },

  onWebNavigationCompleted(callback: (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void): void {
    chrome.webNavigation.onCompleted.addListener(callback);
  },

  async getCookies(details: chrome.cookies.GetAllDetails): Promise<chrome.cookies.Cookie[]> {
    return chrome.cookies.getAll(details);
  },

  async createAlarm(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void> {
    return chrome.alarms.create(name, alarmInfo);
  },

  onAlarm(callback: (alarm: chrome.alarms.Alarm) => void): void {
    chrome.alarms.onAlarm.addListener(callback);
  },

  async setBadgeText(details: chrome.action.BadgeTextDetails): Promise<void> {
    return chrome.action.setBadgeText(details);
  },

  async openPopup(): Promise<void> {
    return chrome.action.openPopup?.() ?? Promise.resolve();
  },
} as const;
