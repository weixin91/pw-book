// WebAuthn 拦截桥接（FR-008）
//
// 工作机制：
// 1. installWebAuthnBridge() 在内容脚本中调用，向页面主世界注入一段 IIFE 脚本，
//    重写 navigator.credentials.create / get，使得调用经过 window.postMessage 桥接到内容脚本。
// 2. 内容脚本接收主世界 postMessage，转发给后台（chrome.runtime.sendMessage）。
// 3. 后台在解锁的保险库内查找匹配 rpId 的 Passkey，构造 attestation/assertion，加密保存新建凭据。
// 4. 内容脚本把结果通过 postMessage 返回给主世界包装层，再转回页面 Promise。
//
// 已知限制：
// - 部分严格 CSP 站点会拦截行内脚本注入；该情况下静默回退到原生 WebAuthn 流程。
// - 主世界包装实现仅提供常用字段（PublicKeyCredential 风格），未覆盖扩展属性如 attestation: enterprise。

const REQUEST_KIND = "PWBOOK_WEBAUTHN_REQUEST";
const RESPONSE_KIND = "PWBOOK_WEBAUTHN_RESPONSE";

interface BridgeRequest {
  kind: typeof REQUEST_KIND;
  id: string;
  op: "create" | "get";
  origin: string;
  publicKey: unknown;
}

interface BridgeResponse {
  kind: typeof RESPONSE_KIND;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function installWebAuthnBridge(doc: Document): void {
  if ((window as unknown as Record<string, boolean>).__PWBOOK_WEBAUTHN_BRIDGE__) return;
  (window as unknown as Record<string, boolean>).__PWBOOK_WEBAUTHN_BRIDGE__ = true;

  // 仅注入到顶层文档；跨域 iframe 由各自 content script 注入。
  injectPageWorldScript(doc);

  window.addEventListener("message", async (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as Partial<BridgeRequest> | undefined;
    if (!data || data.kind !== REQUEST_KIND) return;
    if (typeof data.id !== "string" || (data.op !== "create" && data.op !== "get")) return;

    try {
      const response = await sendToBackground(data as BridgeRequest);
      postResponse({
        kind: RESPONSE_KIND,
        id: data.id,
        ok: true,
        result: response,
      });
    } catch (err) {
      postResponse({
        kind: RESPONSE_KIND,
        id: data.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function postResponse(resp: BridgeResponse): void {
  window.postMessage(resp, window.location.origin);
}

function sendToBackground(req: BridgeRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: req.op === "create" ? "WEBAUTHN_CREATE" : "WEBAUTHN_GET",
          origin: req.origin,
          publicKey: req.publicKey,
        },
        (response: { ok?: boolean; result?: unknown; error?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error("WebAuthn 桥接无响应"));
            return;
          }
          if (response.ok) {
            resolve(response.result);
          } else {
            reject(new Error(response.error ?? "WebAuthn 操作失败"));
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

function injectPageWorldScript(doc: Document): void {
  const code = buildPageWorldSource();
  const script = doc.createElement("script");
  script.textContent = code;
  // 注入完成后立即移除 <script> 元素，保持 DOM 清洁
  (doc.documentElement || doc.head || doc.body)?.appendChild(script);
  script.remove();
}

// 构造主世界 IIFE 源码，使用模板字符串以避免依赖打包。
function buildPageWorldSource(): string {
  return `
(() => {
  if (window.__PWBOOK_WEBAUTHN_PAGE__) return;
  window.__PWBOOK_WEBAUTHN_PAGE__ = true;

  const REQUEST_KIND = ${JSON.stringify(REQUEST_KIND)};
  const RESPONSE_KIND = ${JSON.stringify(RESPONSE_KIND)};

  if (!window.navigator.credentials) return;
  const originalCreate = navigator.credentials.create?.bind(navigator.credentials);
  const originalGet = navigator.credentials.get?.bind(navigator.credentials);
  if (!originalCreate || !originalGet) return;

  function nextId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function bufToB64Url(buf) {
    const arr = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf?.buffer ?? buf ?? []);
    let str = "";
    for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
    return btoa(str).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }

  function b64UrlToBuf(b64) {
    const padded = (b64 || "").replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + "=".repeat(padLen));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
  }

  function serializePublicKey(options) {
    if (!options) return options;
    const clone = JSON.parse(JSON.stringify(options, (_key, value) => {
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return { __pwbookBytes: bufToB64Url(value) };
      }
      return value;
    }));
    return clone;
  }

  function deserializeBuffers(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(deserializeBuffers);
    if (typeof value.__pwbookBytes === "string" && Object.keys(value).length === 1) {
      return b64UrlToBuf(value.__pwbookBytes);
    }
    const out = {};
    for (const k in value) out[k] = deserializeBuffers(value[k]);
    return out;
  }

  function send(op, publicKey) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      function listener(ev) {
        if (ev.source !== window) return;
        const data = ev.data;
        if (!data || data.kind !== RESPONSE_KIND || data.id !== id) return;
        window.removeEventListener("message", listener);
        if (data.ok) {
          resolve(data.result);
        } else {
          reject(new DOMException(data.error || "WebAuthn 操作失败", "NotAllowedError"));
        }
      }
      window.addEventListener("message", listener);
      window.postMessage({
        kind: REQUEST_KIND,
        id,
        op,
        origin: window.location.origin,
        publicKey: serializePublicKey(publicKey),
      }, window.location.origin);
    });
  }

  function buildPublicKeyCredential(envelope) {
    const data = deserializeBuffers(envelope);
    const idBuf = data.rawId;
    const response = data.response || {};

    return {
      id: data.id,
      type: "public-key",
      authenticatorAttachment: "platform",
      rawId: idBuf,
      response,
      getClientExtensionResults() { return {}; },
      toJSON() { return data; },
    };
  }

  navigator.credentials.create = async function patchedCreate(options) {
    if (!options || !options.publicKey) {
      return originalCreate(options);
    }
    try {
      const envelope = await send("create", options.publicKey);
      if (!envelope) return originalCreate(options);
      return buildPublicKeyCredential(envelope);
    } catch (err) {
      // 桥接失败时回退到原生实现
      try { return await originalCreate(options); } catch { throw err; }
    }
  };

  navigator.credentials.get = async function patchedGet(options) {
    if (!options || !options.publicKey) {
      return originalGet(options);
    }
    try {
      const envelope = await send("get", options.publicKey);
      if (!envelope) return originalGet(options);
      return buildPublicKeyCredential(envelope);
    } catch (err) {
      try { return await originalGet(options); } catch { throw err; }
    }
  };
})();
`;
}
