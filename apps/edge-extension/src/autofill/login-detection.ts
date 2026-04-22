// 登录成功检测引擎
// 拦截表单提交、AJAX/fetch，配合 background 的 webNavigation 监听

export class LoginDetectionEngine {
  private capturedUsername = "";
  private capturedPassword = "";
  private hasSubmitted = false;

  constructor(
    private document: Document,
    private onLoginDetected: (username: string, password: string) => void
  ) {
    this.interceptFormSubmit();
    this.interceptFetch();
    this.interceptXHR();
  }

  private interceptFormSubmit(): void {
    this.document.addEventListener(
      "submit",
      (event) => {
        const form = event.target as HTMLFormElement;
        const passwordInput = form.querySelector('input[type="password"]') as HTMLInputElement | null;
        if (!passwordInput) return;

        const usernameInput = this.findUsernameInput(form, passwordInput);
        this.capturedUsername = usernameInput?.value ?? "";
        this.capturedPassword = passwordInput.value;
        this.hasSubmitted = true;

        // 发送给 background script 暂存
        this.onLoginDetected(this.capturedUsername, this.capturedPassword);
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
        self.analyzeRequestBody(init.body);
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
            self.analyzeRequestBody(body);
          }
        });
        super.send(body);
      }
    }

    window.XMLHttpRequest = InterceptedXHR as unknown as typeof XMLHttpRequest;
  }

  private analyzeRequestBody(body: unknown): void {
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
        this.onLoginDetected(username, password);
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
