// WebAuthn 桥接（FR-008）— 内容脚本侧
//
// 工作机制：
// 1. 由 manifest 的 world:"MAIN" content_script 自动加载 webauthn-page.js 到页面主世界，
//    重写 navigator.credentials.create / get，使其通过 window.postMessage 发往内容脚本。
// 2. 本模块在隔离世界监听 window.postMessage，收到请求后转发给 background。
//    对于 create：先查询候选 LOGIN 凭据并弹窗让用户选择保存目标（现有或新建）。
//    对于 get：先查询匹配的 passkey，多匹配时弹窗让用户选择。
// 3. 后台在解锁的保险库内查找匹配 rpId 的 Passkey，构造 attestation/assertion，加密保存凭据。
// 4. 把后台返回结果通过 window.postMessage 发回主世界包装层，再转回页面 Promise。

import { showPasskeySavePrompt, showPasskeyGetPrompt } from "./passkey-prompt.js";

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

export function installWebAuthnBridge(_doc: Document): void {
  if ((window as unknown as Record<string, boolean>).__PWBOOK_WEBAUTHN_BRIDGE__) return;
  (window as unknown as Record<string, boolean>).__PWBOOK_WEBAUTHN_BRIDGE__ = true;

  window.addEventListener("message", async (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as Partial<BridgeRequest> | undefined;
    if (!data || data.kind !== REQUEST_KIND) return;
    if (typeof data.id !== "string" || (data.op !== "create" && data.op !== "get")) return;

    try {
      const result = await routeRequest(data as BridgeRequest);
      postResponse({
        kind: RESPONSE_KIND,
        id: data.id,
        ok: true,
        result,
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

async function routeRequest(req: BridgeRequest): Promise<unknown> {
  if (req.op === "create") {
    return handleCreate(req);
  }
  return handleGet(req);
}

// ── create：查询候选 → 弹窗选择 → 发送给 background ──

async function handleCreate(req: BridgeRequest): Promise<unknown> {
  const candidates = await querySaveCandidates(req.origin);
  const choice = await showPasskeySavePrompt(candidates, req.origin);

  return new Promise((resolve, reject) => {
    const payload: Record<string, unknown> = {
      type: "WEBAUTHN_CREATE",
      origin: req.origin,
      publicKey: req.publicKey,
    };
    if (choice.action === "existing") {
      payload.targetCipherId = choice.cipherId;
    }

    chrome.runtime.sendMessage(
      payload,
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
  });
}

function querySaveCandidates(origin: string): Promise<Array<{ id: string; name: string; username: string; uri: string }>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "QUERY_PASSKEY_SAVE_CANDIDATES" },
      (response: { ok?: boolean; candidates?: Array<{ id: string; name: string; username: string; uri: string }>; error?: string } | undefined) => {
        if (chrome.runtime.lastError || !response?.ok) {
          resolve([]);
        } else {
          resolve(response.candidates ?? []);
        }
      }
    );
  });
}

// ── get：查询匹配 → 多匹配弹窗 → 发送给 background ──

async function handleGet(req: BridgeRequest): Promise<unknown> {
  const matches = await queryGetMatches(req.origin, req.publicKey);

  let selectedCredentialId: string | undefined;
  if (matches.length === 1) {
    selectedCredentialId = matches[0].credentialId;
  } else if (matches.length > 1) {
    selectedCredentialId = await showPasskeyGetPrompt(matches);
  }

  return new Promise((resolve, reject) => {
    const payload: Record<string, unknown> = {
      type: "WEBAUTHN_GET",
      origin: req.origin,
      publicKey: req.publicKey,
    };
    if (selectedCredentialId) {
      payload.selectedCredentialId = selectedCredentialId;
    }

    chrome.runtime.sendMessage(
      payload,
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
  });
}

function queryGetMatches(
  origin: string,
  publicKey: unknown
): Promise<Array<{ id: string; name: string; rpId: string; credentialId: string }>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "QUERY_PASSKEY_GET_MATCHES", origin, publicKey },
      (response: { ok?: boolean; matches?: Array<{ id: string; name: string; rpId: string; credentialId: string }>; error?: string } | undefined) => {
        if (chrome.runtime.lastError || !response?.ok) {
          resolve([]);
        } else {
          resolve(response.matches ?? []);
        }
      }
    );
  });
}
