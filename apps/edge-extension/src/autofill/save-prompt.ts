// 保存密码提示 UI — 行内浮层

import { StorageService } from "../platform/storage.js";
import { shouldPromptSave } from "./rejected-sites.js";

interface SavePromptData {
  username: string;
  password: string;
  url: string;
}

export class SavePrompt {
  private container: HTMLDivElement | null = null;

  constructor(private document: Document) {}

  async show(data: SavePromptData): Promise<void> {
    // 5 秒内检查拒绝记录
    const domain = getBaseDomain(data.url);
    if (!shouldPromptSave(domain, await StorageService.getRejectedSites())) {
      return;
    }

    this.remove();

    const container = this.document.createElement("div");
    container.id = "pwbook-save-prompt";
    container.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      padding: 16px;
      width: 320px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      color: #333;
    `;

    const title = this.document.createElement("div");
    title.textContent = "保存密码到 Password Book？";
    title.style.cssText = "font-weight: 600; margin-bottom: 8px;";

    const info = this.document.createElement("div");
    info.textContent = `网站: ${domain}`;
    info.style.cssText = "color: #666; margin-bottom: 12px; font-size: 12px;";

    const actions = this.document.createElement("div");
    actions.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

    const btnSave = this.document.createElement("button");
    btnSave.textContent = "保存";
    btnSave.style.cssText = `
      background: #1a73e8; color: #fff; border: none;
      border-radius: 6px; padding: 6px 16px; cursor: pointer;
      font-size: 13px;
    `;

    const btnReject = this.document.createElement("button");
    btnReject.textContent = "拒绝";
    btnReject.style.cssText = `
      background: transparent; color: #666; border: 1px solid #ddd;
      border-radius: 6px; padding: 6px 16px; cursor: pointer;
      font-size: 13px;
    `;

    btnSave.addEventListener("click", async () => {
      await this.saveCipher(data);
      this.remove();
    });

    btnReject.addEventListener("click", async () => {
      await this.rejectSite(domain);
      this.remove();
    });

    actions.appendChild(btnReject);
    actions.appendChild(btnSave);
    container.appendChild(title);
    container.appendChild(info);
    container.appendChild(actions);

    this.document.body.appendChild(container);
    this.container = container;

    // 10 秒后自动消失
    setTimeout(() => this.remove(), 10_000);
  }

  remove(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
  }

  private async saveCipher(data: SavePromptData): Promise<void> {
    const cipherData = {
      name: getBaseDomain(data.url),
      notes: null,
      fields: [],
      lastUsedAt: new Date().toISOString(),
      login: {
        username: data.username,
        password: data.password,
        uris: [{ uri: data.url, match: null }],
        totp: null,
      },
    };

    await chrome.runtime.sendMessage({
      type: "SAVE_CIPHER",
      data: cipherData,
    });
  }

  private async rejectSite(domain: string): Promise<void> {
    const sites = await StorageService.getRejectedSites();
    const rejectedAt = new Date().toISOString();
    const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    sites.push({ domain, rejectedAt, expireAt });
    await StorageService.setRejectedSites(sites);
  }
}

function getBaseDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join(".");
  } catch {
    return url;
  }
}
