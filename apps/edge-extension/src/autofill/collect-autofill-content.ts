// 表单检测服务 — DOM 遍历、语义分析、MutationObserver

export interface DetectedFormData {
  url: string;
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement | null;
  formElement: HTMLFormElement | null;
}

export class CollectAutofillContentService {
  private inputCount = 0;
  private readonly maxInputs = 500;

  constructor(private document: Document) {}

  scanPage(): DetectedFormData | null {
    this.inputCount = 0;
    const inputs = this.getVisibleInputs();

    if (inputs.length === 0) return null;
    if (inputs.length > this.maxInputs) {
      console.warn("[Password Book] 页面输入元素过多，跳过扫描");
      return null;
    }

    const passwordField = this.findPasswordField(inputs);
    if (!passwordField) return null;

    const usernameField = this.findUsernameField(inputs, passwordField);
    const formElement = passwordField.closest("form") as HTMLFormElement | null;

    return {
      url: this.document.location.href,
      usernameField,
      passwordField,
      formElement,
    };
  }

  private getVisibleInputs(): HTMLInputElement[] {
    const inputs = Array.from(this.document.querySelectorAll("input"));
    return inputs.filter((el) => {
      if (el.type === "hidden") return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  private findPasswordField(inputs: HTMLInputElement[]): HTMLInputElement | null {
    for (const input of inputs) {
      if (input.type === "password") return input;
      if (this.isPasswordLike(input)) return input;
    }
    return null;
  }

  private isPasswordLike(input: HTMLInputElement): boolean {
    const indicators = ["password", "pass", "pwd", "密碼", "密码"];
    const attrText = `${input.name} ${input.id} ${input.placeholder} ${input.autocomplete}`.toLowerCase();
    return indicators.some((i) => attrText.includes(i));
  }

  private findUsernameField(
    inputs: HTMLInputElement[],
    passwordField: HTMLInputElement
  ): HTMLInputElement | null {
    const candidates = inputs.filter(
      (el) =>
        el !== passwordField &&
        (el.type === "text" || el.type === "email" || el.type === "tel")
    );

    // 优先找在密码框之前的字段
    const passwordIndex = inputs.indexOf(passwordField);
    const beforePassword = candidates.filter(
      (el) => inputs.indexOf(el) < passwordIndex
    );

    const checkUsername = (el: HTMLInputElement): boolean => {
      const attrText = `${el.name} ${el.id} ${el.placeholder} ${el.autocomplete}`.toLowerCase();
      return (
        attrText.includes("user") ||
        attrText.includes("email") ||
        attrText.includes("login") ||
        attrText.includes("account") ||
        attrText.includes("用户名") ||
        attrText.includes("邮箱")
      );
    };

    // 先找语义匹配的
    let match = beforePassword.find(checkUsername);
    if (match) return match;
    match = candidates.find(checkUsername);
    if (match) return match;

    // 退而求其次：密码框前一个可见文本框
    if (beforePassword.length > 0) {
      return beforePassword[beforePassword.length - 1];
    }

    return candidates.length > 0 ? candidates[0] : null;
  }
}
