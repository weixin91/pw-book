// 自动填充引擎 — 字段匹配、数据注入

export class InsertAutofillContentService {
  constructor(private document: Document) {}

  fill(item: Record<string, unknown>): void {
    const username = String(item.username ?? "");
    const password = String(item.password ?? "");

    const inputs = Array.from(this.document.querySelectorAll("input"));
    const passwordField = this.findPasswordField(inputs);
    if (!passwordField) return;

    const usernameField = this.findUsernameField(inputs, passwordField);

    if (usernameField && username) {
      this.setInputValue(usernameField, username);
      usernameField.dispatchEvent(new Event("input", { bubbles: true }));
      usernameField.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (password) {
      this.setInputValue(passwordField, password);
      passwordField.dispatchEvent(new Event("input", { bubbles: true }));
      passwordField.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  private setInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  private findPasswordField(inputs: HTMLInputElement[]): HTMLInputElement | null {
    for (const input of inputs) {
      if (input.type === "password") return input;
    }
    return null;
  }

  private findUsernameField(
    inputs: HTMLInputElement[],
    passwordField: HTMLInputElement
  ): HTMLInputElement | null {
    const passwordIndex = inputs.indexOf(passwordField);
    const candidates = inputs.filter(
      (el, idx) =>
        el !== passwordField &&
        idx < passwordIndex &&
        (el.type === "text" || el.type === "email")
    );
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }
}
