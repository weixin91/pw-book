// 登录成功检测引擎
// 拦截表单提交、AJAX/fetch，配合 background 的 webNavigation 监听

export class LoginDetectionEngine {
  // 追踪输入框的最新值（防止提交时被框架清空）
  private inputValues = new WeakMap<HTMLInputElement, string>();
  // 点击登录按钮时暂存的凭据（submit 时若密码框已被清空则使用此值）
  private lastClickCredentials: { username: string; password: string; timestamp: number } = { username: "", password: "", timestamp: 0 };

  constructor(
    private document: Document,
    private onFormSubmit: (username: string, password: string) => void,
    private onAjaxSuccess: (username: string, password: string) => void
  ) {
    this.trackInputValues();
    this.captureOnLoginClick();
    this.interceptFormSubmit();
    this.interceptFetch();
    this.interceptXHR();
  }

  private trackInputValues(): void {
    const self = this;
    // 1. 原生 input 事件兜底
    this.document.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (target.tagName !== "INPUT") return;
      if (target.type === "password" || target.type === "text" || target.type === "email") {
        self.inputValues.set(target, target.value);
      }
    }, true);

    // 2. 拦截 value setter（React/Vue 等框架直接赋值也能捕获）
    try {
      const proto = HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        const originalSet = descriptor.set;
        Object.defineProperty(proto, "value", {
          get() { return descriptor.get!.call(this); },
          set(newValue) {
            originalSet.call(this, newValue);
            const el = this as HTMLInputElement;
            if (el.type === "password" || el.type === "text" || el.type === "email") {
              self.inputValues.set(el, String(newValue));
            }
          },
        });
      }
    } catch {
      // 拦截失败则依赖 input 事件兜底
    }
  }

  private getTrackedValue(input: HTMLInputElement | null): string {
    if (!input) return "";
    return this.inputValues.get(input) ?? input.value ?? "";
  }

  private captureOnLoginClick(): void {
    const self = this;
    this.document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const text = (target.textContent ?? "").toLowerCase();
      const aria = (target.getAttribute("aria-label") ?? "").toLowerCase();
      const title = (target.getAttribute("title") ?? "").toLowerCase();
      const cls = (target.className ?? "").toLowerCase();
      const isLoginTrigger =
        text.includes("登录") || text.includes("login") || text.includes("sign in") || text.includes("signin") ||
        aria.includes("登录") || aria.includes("login") ||
        title.includes("登录") || title.includes("login") ||
        cls.includes("login") || cls.includes("signin") || cls.includes("auth") ||
        target.closest("button[type='submit']") !== null ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type === "submit");
      if (!isLoginTrigger) return;

      const form = target.closest("form") as HTMLFormElement | null;
      if (!form) return;

      const passwordInputs = Array.from(form.querySelectorAll('input[type="password"]'));
      const passwordInput = passwordInputs.find((p) => (p as HTMLInputElement).value) as HTMLInputElement | null ?? (passwordInputs[0] as HTMLInputElement | null);
      if (!passwordInput) return;

      const usernameInput = this.findUsernameInput(form, passwordInput);
      const username = self.getTrackedValue(usernameInput);
      const password = self.getTrackedValue(passwordInput);
      self.lastClickCredentials = { username, password, timestamp: Date.now() };
      console.log("[PWBook] 点击登录按钮，暂存凭据, username:", username, "password:", password ? "有" : "无");
    }, true);
  }

  private interceptFormSubmit(): void {
    const self = this;
    this.document.addEventListener(
      "submit",
      (event) => {
        const form = event.target as HTMLFormElement;
        const passwordInputs = Array.from(form.querySelectorAll('input[type="password"]'));
        const passwordInput = passwordInputs.find((p) => (p as HTMLInputElement).value) as HTMLInputElement | null ?? (passwordInputs[0] as HTMLInputElement | null);
        if (!passwordInput) return;

        const usernameInput = this.findUsernameInput(form, passwordInput);
        let username = self.getTrackedValue(usernameInput);
        let password = self.getTrackedValue(passwordInput);

        // 若 submit 时密码框已被清空，且 2 秒内有点击登录按钮的记录，使用点击时捕获的值
        const clickAge = Date.now() - self.lastClickCredentials.timestamp;
        if (!password && self.lastClickCredentials.password && clickAge < 2000) {
          username = self.lastClickCredentials.username;
          password = self.lastClickCredentials.password;
          console.log("[PWBook] submit 时使用 click 暂存的凭据");
        }

        console.log("[PWBook] 检测到表单提交, username:", username, "password:", password ? "有" : "无");
        // 发送给 background script 暂存，等待页面导航判定登录成功
        this.onFormSubmit(username, password);
      },
      true
    );
  }

  private interceptFetch(): void {
    const originalFetch = window.fetch;
    const self = this;
    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const response = await originalFetch.call(this, input, init);
      if (response.ok && init?.method?.toUpperCase() === "POST") {
        self.analyzeRequestBody(init.body, self.onAjaxSuccess);
      }
      return response;
    };
  }

  private interceptXHR(): void {
    const OriginalXHR = window.XMLHttpRequest;
    const self = this;

    class InterceptedXHR extends OriginalXHR {
      private _method = "";
      private _url = "";

      open(method: string, url: string | URL, async = true, username?: string, password?: string): void {
        this._method = method;
        this._url = String(url);
        super.open(method, url, async, username, password);
      }

      send(body?: Document | XMLHttpRequestBodyInit | null): void {
        super.addEventListener("load", () => {
          if (this.status >= 200 && this.status < 300 && this._method.toUpperCase() === "POST") {
            self.analyzeRequestBody(body, self.onAjaxSuccess);
          }
        });
        super.send(body);
      }
    }

    window.XMLHttpRequest = InterceptedXHR as unknown as typeof XMLHttpRequest;
  }

  private analyzeRequestBody(body: unknown, callback: (username: string, password: string) => void): void {
    if (!body) return;
    let text = "";
    if (typeof body === "string") {
      text = body;
    } else if (body instanceof URLSearchParams) {
      text = body.toString();
    } else if (body instanceof FormData) {
      // FormData 无法直接读取，跳过
      return;
    }
    if (!text) return;

    // 简单启发式：请求体中包含 password 字段
    if (text.includes("password=") || text.includes("passwd=")) {
      const params = new URLSearchParams(text);
      const username =
        params.get("username") ||
        params.get("email") ||
        params.get("login") ||
        params.get("user") ||
        "";
      const password =
        params.get("password") || params.get("passwd") || "";
      if (password) {
        callback(username, password);
      }
    }
  }

  private findUsernameInput(form: HTMLFormElement, passwordInput: HTMLInputElement): HTMLInputElement | null {
    const inputs = Array.from(form.querySelectorAll("input"));
    const passwordIndex = inputs.indexOf(passwordInput);
    const candidates = inputs.filter((el, idx) =>
      el !== passwordInput &&
      idx < passwordIndex &&
      (el.type === "text" || el.type === "email")
    );
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }
}
