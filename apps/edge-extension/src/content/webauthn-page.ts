// WebAuthn 页面主世界脚本（独立文件，通过 manifest world: "MAIN" 注入）
//
// 由 Chrome 原生加载到页面主世界，因此不会触发 CSP 'unsafe-inline' 检查。
// 重写 navigator.credentials.create / get，并通过 window.postMessage 与
// 内容脚本（隔离世界）中的桥接监听器通信。

(() => {
  type Buffers = ArrayBuffer | ArrayBufferView;

  interface PageRequest {
    kind: "PWBOOK_WEBAUTHN_REQUEST";
    id: string;
    op: "create" | "get";
    origin: string;
    publicKey: unknown;
  }

  interface PageResponse {
    kind: "PWBOOK_WEBAUTHN_RESPONSE";
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }

  const w = window as unknown as Record<string, boolean>;
  if (w.__PWBOOK_WEBAUTHN_PAGE__) return;
  w.__PWBOOK_WEBAUTHN_PAGE__ = true;

  const REQUEST_KIND = "PWBOOK_WEBAUTHN_REQUEST";
  const RESPONSE_KIND = "PWBOOK_WEBAUTHN_RESPONSE";

  if (!navigator.credentials) return;
  const credentials = navigator.credentials;
  const originalCreate = credentials.create?.bind(credentials);
  const originalGet = credentials.get?.bind(credentials);
  if (!originalCreate || !originalGet) return;

  function nextId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function bufToB64Url(buf: Buffers): string {
    const arr =
      buf instanceof ArrayBuffer
        ? new Uint8Array(buf)
        : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let str = "";
    for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64UrlToBuf(b64: string): ArrayBuffer {
    const padded = (b64 || "").replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + "=".repeat(padLen));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
  }

  function serializePublicKey(options: unknown): unknown {
    if (!options) return options;
    return JSON.parse(
      JSON.stringify(options, (_key, value) => {
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          return { __pwbookBytes: bufToB64Url(value as Buffers) };
        }
        return value;
      })
    );
  }

  function deserializeBuffers(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(deserializeBuffers);
    const v = value as Record<string, unknown>;
    if (typeof v.__pwbookBytes === "string" && Object.keys(v).length === 1) {
      return b64UrlToBuf(v.__pwbookBytes);
    }
    const out: Record<string, unknown> = {};
    for (const k in v) out[k] = deserializeBuffers(v[k]);
    return out;
  }

  function send(op: "create" | "get", publicKey: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId();
      function listener(ev: MessageEvent) {
        if (ev.source !== window) return;
        const data = ev.data as PageResponse | undefined;
        if (!data || data.kind !== RESPONSE_KIND || data.id !== id) return;
        window.removeEventListener("message", listener);
        if (data.ok) {
          resolve(data.result);
        } else {
          reject(new DOMException(data.error || "WebAuthn 操作失败", "NotAllowedError"));
        }
      }
      window.addEventListener("message", listener);
      const request: PageRequest = {
        kind: REQUEST_KIND,
        id,
        op,
        origin: window.location.origin,
        publicKey: serializePublicKey(publicKey),
      };
      window.postMessage(request, window.location.origin);
    });
  }

  function buildPublicKeyCredential(envelope: unknown): unknown {
    const data = deserializeBuffers(envelope) as Record<string, unknown>;
    const idBuf = data.rawId;
    const response = (data.response as Record<string, unknown>) || {};
    return {
      id: data.id,
      type: "public-key",
      authenticatorAttachment: "platform",
      rawId: idBuf,
      response,
      getClientExtensionResults() {
        return {};
      },
      toJSON() {
        return data;
      },
    };
  }

  credentials.create = async function patchedCreate(
    options?: CredentialCreationOptions
  ): Promise<Credential | null> {
    if (!options || !options.publicKey) {
      return originalCreate(options);
    }
    try {
      const envelope = await send("create", options.publicKey);
      if (!envelope) return originalCreate(options);
      return buildPublicKeyCredential(envelope) as Credential;
    } catch (err) {
      try {
        return await originalCreate(options);
      } catch {
        throw err;
      }
    }
  };

  credentials.get = async function patchedGet(
    options?: CredentialRequestOptions
  ): Promise<Credential | null> {
    if (!options || !options.publicKey) {
      return originalGet(options);
    }
    try {
      const envelope = await send("get", options.publicKey);
      if (!envelope) return originalGet(options);
      return buildPublicKeyCredential(envelope) as Credential;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 无匹配或用户取消时，不 fallback 到系统 authenticator（避免弹出 Windows Hello 等）
      if (msg.includes("没有可用的通行密钥") || msg.includes("用户取消了")) {
        throw err;
      }
      try {
        return await originalGet(options);
      } catch {
        throw err;
      }
    }
  };
})();
