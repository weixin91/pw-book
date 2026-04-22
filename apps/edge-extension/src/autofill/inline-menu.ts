// 行内菜单 / 账号选择器

export class InlineMenu {
  private container: HTMLDivElement | null = null;

  constructor(
    private document: Document,
    private onSelect: (item: Record<string, unknown>) => void
  ) {}

  show(items: Array<Record<string, unknown>>): void {
    this.remove();

    const container = this.document.createElement("div");
    container.id = "pwbook-inline-menu";
    container.style.cssText = `
      position: fixed;
      z-index: 2147483646;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      width: 240px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      overflow: hidden;
    `;

    const passwordField = this.document.querySelector('input[type="password"]') as HTMLInputElement | null;
    if (passwordField) {
      const rect = passwordField.getBoundingClientRect();
      container.style.top = `${rect.bottom + window.scrollY + 4}px`;
      container.style.left = `${rect.left + window.scrollX}px`;
    } else {
      container.style.top = "50%";
      container.style.left = "50%";
      container.style.transform = "translate(-50%, -50%)";
    }

    for (const item of items) {
      const row = this.document.createElement("div");
      row.style.cssText = `
        padding: 10px 12px;
        cursor: pointer;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      row.addEventListener("mouseenter", () => {
        row.style.background = "#f5f5f5";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", () => {
        this.onSelect(item);
        this.remove();
      });

      const name = this.document.createElement("div");
      name.style.cssText = "font-weight: 500; color: #333;";
      name.textContent = String(item.name ?? item.username ?? "账号");

      const username = this.document.createElement("div");
      username.style.cssText = "color: #888; font-size: 11px;";
      username.textContent = String(item.username ?? "");

      const info = this.document.createElement("div");
      info.appendChild(name);
      info.appendChild(username);
      row.appendChild(info);
      container.appendChild(row);
    }

    this.document.body.appendChild(container);
    this.container = container;

    // 点击外部关闭
    const closeHandler = (e: MouseEvent) => {
      if (container && !container.contains(e.target as Node)) {
        this.remove();
        this.document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => this.document.addEventListener("click", closeHandler), 0);
  }

  remove(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
  }
}
