// 保存密码提示 UI — 行内浮层

import { StorageService } from "../platform/storage.js";
import { shouldPromptSave } from "./rejected-sites.js";
import { getBaseDomainFromAny } from "./domain-utils.js";

interface SavePromptData {
  username: string;
  password: string;
  url: string;
}

export class SavePrompt {
  private container: HTMLDivElement | null = null;

  constructor(private document: Document) {}

  async show(data: SavePromptData): Promise<void> {
    const domain = getBaseDomainFromAny(data.url);
    console.log("[PWBook SavePrompt] show() 被调用, domain:", domain, "username:", data.username, "password:", data.password ? "有" : "无");
    // 5 秒内检查拒绝记录
    if (!shouldPromptSave(domain, await StorageService.getRejectedSites())) {
      console.log("[PWBook SavePrompt] 域名在拒绝列表中，不显示提示:", domain);
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
      btnSave.disabled = true;
      btnSave.textContent = "保存中...";
      const result = await this.saveCipher(data);
      if (result.success) {
        btnSave.textContent = "已保存";
        btnSave.style.background = "#34a853";
        setTimeout(() => this.remove(), 800);
      } else {
        btnSave.disabled = false;
        btnSave.textContent = "保存";
        const errorText = this.document.createElement("div");
        errorText.textContent = result.error ?? "保存失败";
        errorText.style.cssText = "color: #d93025; font-size: 12px; margin-top: 8px;";
        if (!container.querySelector("[data-save-error]")) {
          errorText.setAttribute("data-save-error", "true");
          container.appendChild(errorText);
        }
      }
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

  private async saveCipher(data: SavePromptData): Promise<{ success: boolean; error?: string }> {
    const cipherData = {
      name: getBaseDomainFromAny(data.url),
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

    try {
      const response = (await chrome.runtime.sendMessage({
        type: "SAVE_CIPHER",
        data: cipherData,
      })) as { success: boolean; error?: string } | undefined;
      if (response?.success) {
        return { success: true };
      }
      return { success: false, error: response?.error ?? "保存失败" };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  private async rejectSite(domain: string): Promise<void> {
    const sites = await StorageService.getRejectedSites();
    const rejectedAt = new Date().toISOString();
    const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    sites.push({ domain, rejectedAt, expireAt });
    await StorageService.setRejectedSites(sites);
  }
}
