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

  // 判断给定输入框是否是 TOTP / 一次性验证码字段
  isTotpField(input: HTMLInputElement): boolean {
    if (!input || input.tagName !== "INPUT") return false;
    if (input.type === "password" || input.type === "hidden") return false;
    const acceptableTypes = ["text", "number", "tel", ""];
    if (!acceptableTypes.includes(input.type)) return false;

    const autocomplete = (input.autocomplete || "").toLowerCase();
    if (autocomplete.includes("one-time-code")) return true;

    const attrText = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") ?? ""} ${input.title ?? ""}`.toLowerCase();
    const totpKeywords = [
      "one-time",
      "onetime",
      "otp",
      "totp",
      "2fa",
      "mfa",
      "two-factor",
      "two factor",
      "verification",
      "verifycode",
      "verify-code",
      "security code",
      "auth code",
      "authcode",
      "authenticator",
      "token",
      "验证码",
      "动态码",
      "动态密码",
      "安全码",
      "校验码",
      "校验",
      "短信验证",
    ];
    if (totpKeywords.some((k) => attrText.includes(k))) {
      // 排除明显的非 TOTP 用途："email" / "phone" / "captcha"
      if (/captcha|图形/.test(attrText)) return false;
      return true;
    }

    // maxLength 6~8 + 数字输入模式 + name 含 code 视作 TOTP
    const maxLen = input.maxLength;
    if (maxLen >= 4 && maxLen <= 10) {
      const inputMode = (input.inputMode || "").toLowerCase();
      if (inputMode === "numeric" || input.type === "number" || input.type === "tel") {
        if (/code/.test(attrText)) return true;
      }
    }

    return false;
  }
}
