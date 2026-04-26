// 行内菜单 / 账号选择器

export interface InlineMenuOptions {
  anchor?: HTMLInputElement | null;
  onSelect?: (item: Record<string, unknown>) => void;
  subtitle?: string;
}

export class InlineMenu {
  private container: HTMLDivElement | null = null;

  constructor(
    private document: Document,
    private onSelect: (item: Record<string, unknown>) => void
  ) {}

  show(items: Array<Record<string, unknown>>, options: InlineMenuOptions = {}): void {
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

    const anchorField = options.anchor ?? this.findAnchorField();
    if (anchorField) {
      const rect = anchorField.getBoundingClientRect();
      // position: fixed 使用视口坐标，无需加 scrollX/scrollY
      container.style.top = `${rect.bottom + 4}px`;
      container.style.left = `${rect.left}px`;
    } else {
      container.style.top = "50%";
      container.style.left = "50%";
      container.style.transform = "translate(-50%, -50%)";
    }

    if (options.subtitle) {
      const header = this.document.createElement("div");
      header.style.cssText = `
        padding: 8px 12px;
        background: #f5f7fa;
        color: #666;
        font-size: 11px;
        border-bottom: 1px solid #eee;
      `;
      header.textContent = options.subtitle;
      container.appendChild(header);
    }

    const handler = options.onSelect ?? this.onSelect;

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
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        handler(item);
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

    // 点击外部关闭（带保护期，避免显示瞬间的 click 事件误关闭）
    const shownAt = Date.now();
    const closeHandler = (e: MouseEvent) => {
      if (Date.now() - shownAt < 200) return; // 显示后 200ms 内忽略外部点击
      if (container && !container.contains(e.target as Node)) {
        this.remove();
        this.document.removeEventListener("click", closeHandler);
      }
    };
    // 延迟 50ms 绑定，确保触发菜单显示的那次 click 事件已完成
    setTimeout(() => this.document.addEventListener("click", closeHandler), 50);
  }

  remove(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
  }

  private findAnchorField(): HTMLInputElement | null {
    const inputs = Array.from(this.document.querySelectorAll("input"));
    // 优先找可见的 type="password"
    for (const input of inputs) {
      if (input.type === "password" && this.isVisible(input)) return input;
    }
    // 回退：显示密码模式下 type="text" 但属性含密码关键词
    for (const input of inputs) {
      if (this.isPasswordLike(input) && this.isVisible(input)) return input;
    }
    // 最后回退到当前焦点元素
    const active = this.document.activeElement as HTMLInputElement | null;
    if (active && active.tagName === "INPUT" && this.isVisible(active)) return active;
    return null;
  }

  private isVisible(el: HTMLInputElement): boolean {
    if (el.type === "hidden") return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  private isPasswordLike(input: HTMLInputElement): boolean {
    const attrText = `${input.name} ${input.id} ${input.placeholder} ${input.autocomplete}`.toLowerCase();
    return /password|pass|pwd|密碼|密码/.test(attrText);
  }
}
