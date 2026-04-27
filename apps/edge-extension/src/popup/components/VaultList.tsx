import React, { useEffect, useState } from "react";
import { StorageService } from "../../platform/storage";
import { BrowserApi } from "../../platform/browser-api";
import { ClipboardManager } from "../../platform/clipboard";
import { PendingChangesQueue } from "../../sync/pending-changes";
import { parseOtpauthUri, generateTotpCode } from "../../crypto/totp";
import { parseUri, isUriMatch } from "../../autofill/domain-utils";
import type { Cipher, SyncStatus } from "@pwbook/shared-types";

interface VaultItem {
  cipher: Cipher;
  name: string;
  username: string;
  hasTotp: boolean;
  hasPasskey: boolean;
  uris: string[];
}

interface Props {
  onAdd: () => void;
  onEdit: (id: string) => void;
  onOpenGenerator: () => void;
  onOpenCookieSync: () => void;
}

export function VaultList({ onAdd, onEdit, onOpenGenerator, onOpenCookieSync }: Props): React.ReactElement {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [search, setSearch] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<VaultItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    loadItems();
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-copy-menu]")) {
        setOpenMenuId(null);
        setMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadItems() {
    const ciphers = await StorageService.getCiphers();
    const userKey = await StorageService.getUserKey();
    if (!userKey) return;

    const { decryptCipherData } = await import("../../crypto/crypto-service");
    const decrypted = await Promise.all(
      ciphers.map(async (cipher) => {
        try {
          const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
          const totpRaw = String(data.login?.totp ?? "").trim();
          const pk = data.passkey as { credentialId?: string } | undefined;
          const uris = ((data.login?.uris ?? []) as Array<{ uri?: string }>)
            .map((u) => u.uri ?? "")
            .filter((u) => u.length > 0);
          return {
            cipher,
            name: data.name || "未命名",
            username: data.login?.username || "",
            hasTotp: totpRaw.length > 0 && parseOtpauthUri(totpRaw) !== null,
            hasPasskey: !!pk?.credentialId,
            uris,
          };
        } catch (err) {
          console.error("[VaultList] 解密失败:", cipher.id, err);
          return { cipher, name: "解密失败", username: "", hasTotp: false, hasPasskey: false, uris: [] };
        }
      })
    );
    setItems(decrypted);
    await loadSuggestions(decrypted);
    const status = await StorageService.getSyncStatus();
    setSyncStatus(status);
  }

  async function loadSuggestions(allItems: VaultItem[]) {
    const tab = await BrowserApi.getActiveBrowserTab();
    if (!tab?.url) {
      setSuggestions([]);
      return;
    }
    const sourceId = parseUri(tab.url);
    if (!sourceId) {
      setSuggestions([]);
      return;
    }
    const matched = allItems.filter((item) => {
      return item.uris.some((uri) => {
        const targetId = parseUri(uri);
        if (!targetId) return false;
        return isUriMatch(sourceId, targetId);
      });
    });
    setSuggestions(matched);
  }

  async function toggleFavorite(cipherId: string) {
    const ciphers = await StorageService.getCiphers();
    const idx = ciphers.findIndex((c) => c.id === cipherId);
    if (idx < 0) return;
    ciphers[idx] = { ...ciphers[idx], favorite: !ciphers[idx].favorite };
    await StorageService.setCiphers(ciphers);
    await loadItems();

    const userKey = await StorageService.getUserKey();
    if (!userKey) return;
    try {
      const { decryptCipherData, encryptCipherData } = await import("../../crypto/crypto-service");
      const plainText = await decryptCipherData(ciphers[idx].data, userKey);
      const encryptedData = await encryptCipherData(plainText, userKey);
      const queue = new PendingChangesQueue();
      await queue.enqueue({
        cipherId,
        operation: "UPDATE",
        encryptedData,
        clientTimestamp: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  }

  const filtered = items
    .filter(
      (i) =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        i.username.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      // 收藏项排在前面
      if (a.cipher.favorite && !b.cipher.favorite) return -1;
      if (!a.cipher.favorite && b.cipher.favorite) return 1;
      return a.name.localeCompare(b.name);
    });

  async function handleCopy(cipher: Cipher, field: "username" | "password") {
    setOpenMenuId(null);
    setMenuPos(null);
    const userKey = await StorageService.getUserKey();
    if (!userKey) {
      setToast("保险库未解锁");
      return;
    }
    const { decryptCipherData } = await import("../../crypto/crypto-service");
    try {
      const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
      const value: string | undefined = data.login?.[field];
      if (!value) {
        setToast(field === "username" ? "用户名为空" : "密码为空");
        return;
      }
      await ClipboardManager.copy(value);
      setToast(field === "username" ? "用户名已复制" : "密码已复制");
    } catch {
      setToast("复制失败");
    }
  }

  async function handleFill(item: VaultItem) {
    const tab = await BrowserApi.getActiveBrowserTab();
    if (!tab?.id) {
      setToast("无法获取当前标签页");
      return;
    }
    const userKey = await StorageService.getUserKey();
    if (!userKey) {
      setToast("保险库未解锁");
      return;
    }
    const { decryptCipherData } = await import("../../crypto/crypto-service");
    try {
      const data = JSON.parse(await decryptCipherData(item.cipher.data, userKey));
      const username = data.login?.username ?? "";
      const password = data.login?.password ?? "";
      await BrowserApi.sendMessageToTab(tab.id, {
        type: "FILL_CREDENTIALS",
        items: [{ id: item.cipher.id, username, password }],
      });
      setToast("已填充凭据");
    } catch {
      setToast("填充失败");
    }
  }

  function handleOpenUrl(item: VaultItem) {
    const url = item.uris[0];
    if (!url) {
      setToast("无可用网址");
      return;
    }
    chrome.tabs.create({ url });
  }

  async function handleCopyTotp(cipher: Cipher) {
    setOpenMenuId(null);
    setMenuPos(null);
    const userKey = await StorageService.getUserKey();
    if (!userKey) {
      setToast("保险库未解锁");
      return;
    }
    const { decryptCipherData } = await import("../../crypto/crypto-service");
    try {
      const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
      const totpRaw = String(data.login?.totp ?? "").trim();
      if (!totpRaw) {
        setToast("未设置验证码");
        return;
      }
      const config = parseOtpauthUri(totpRaw);
      if (!config) {
        setToast("验证码配置无效");
        return;
      }
      const { code } = await generateTotpCode(config);
      await ClipboardManager.copy(code);
      setToast("验证码已复制");
    } catch {
      setToast("生成验证码失败");
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ddd",
            fontSize: 13,
          }}
        />
        <button
          onClick={onAdd}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "none",
            background: "#1a73e8",
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          新增
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={onOpenGenerator}
          style={{
            flex: 1,
            padding: "8px",
            borderRadius: 6,
            border: "1px solid #1a73e8",
            background: "#fff",
            color: "#1a73e8",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          密码生成器
        </button>
        <button
          onClick={onOpenCookieSync}
          style={{
            flex: 1,
            padding: "8px",
            borderRadius: 6,
            border: "1px solid #1a73e8",
            background: "#fff",
            color: "#1a73e8",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Cookie 同步
        </button>
      </div>
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#333" }}>自动填充建议</div>
            <div style={{ fontSize: 12, color: "#888" }}>{suggestions.length}</div>
          </div>
          {suggestions.map((item) => (
            <div
              key={`sugg-${item.cipher.id}`}
              style={{
                padding: "10px",
                borderRadius: 8,
                border: "1px solid #eee",
                marginBottom: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{item.name}</div>
                  {item.hasPasskey && (
                    <span style={{ fontSize: 12 }} title="包含通行密钥">🔐</span>
                  )}
                </div>
                <div style={{ color: "#888", fontSize: 12 }}>{item.username}</div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => handleFill(item)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 12,
                    border: "1px solid #1a73e8",
                    background: "#fff",
                    color: "#1a73e8",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  填充
                </button>
                <button
                  onClick={() => handleCopy(item.cipher, "password")}
                  title="复制密码"
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  复制
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openMenuId === `sugg-${item.cipher.id}`) {
                      setOpenMenuId(null);
                      setMenuPos(null);
                    } else {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenuPos({
                        top: rect.bottom + 4,
                        right: window.innerWidth - rect.right,
                      });
                      setOpenMenuId(`sugg-${item.cipher.id}`);
                    }
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ⋮
                </button>
                {openMenuId === `sugg-${item.cipher.id}` && menuPos && (
                  <div
                    style={{
                      position: "fixed",
                      top: menuPos.top,
                      right: menuPos.right,
                      background: "#fff",
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                      zIndex: 1000,
                      minWidth: 110,
                      overflow: "hidden",
                    }}
                  >
                    <button
                      onClick={() => handleCopy(item.cipher, "username")}
                      disabled={!item.username}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "none",
                        textAlign: "left",
                        fontSize: 12,
                        cursor: item.username ? "pointer" : "not-allowed",
                        color: item.username ? "#333" : "#bbb",
                      }}
                    >
                      复制用户名
                    </button>
                    <button
                      onClick={() => handleCopy(item.cipher, "password")}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "none",
                        textAlign: "left",
                        fontSize: 12,
                        cursor: "pointer",
                        color: "#333",
                        borderTop: "1px solid #f0f0f0",
                      }}
                    >
                      复制密码
                    </button>
                    {item.hasTotp && (
                      <button
                        onClick={() => handleCopyTotp(item.cipher)}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "8px 12px",
                          border: "none",
                          background: "none",
                          textAlign: "left",
                          fontSize: 12,
                          cursor: "pointer",
                          color: "#333",
                          borderTop: "1px solid #f0f0f0",
                        }}
                      >
                        复制验证码
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 500, color: "#333", marginBottom: 8 }}>所有项目</div>
      <div style={{ maxHeight: 340, overflowY: "auto" }}>
        {filtered.map((item) => (
          <div
            key={item.cipher.id}
            style={{
              padding: "10px",
              borderRadius: 8,
              border: "1px solid #eee",
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <button
              onClick={() => toggleFavorite(item.cipher.id)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 16,
                padding: 0,
                color: item.cipher.favorite ? "#f9a825" : "#ccc",
              }}
              title={item.cipher.favorite ? "取消收藏" : "收藏"}
            >
              {item.cipher.favorite ? "★" : "☆"}
            </button>
            <div
              style={{ cursor: "pointer", flex: 1 }}
              onClick={() => onEdit(item.cipher.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{item.name}</div>
                {item.hasPasskey && (
                  <span style={{ fontSize: 12 }} title="包含通行密钥">🔐</span>
                )}
              </div>
              <div style={{ color: "#888", fontSize: 12 }}>{item.username}</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {suggestions.some((s) => s.cipher.id === item.cipher.id) ? (
                <button
                  onClick={() => handleFill(item)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 12,
                    border: "1px solid #1a73e8",
                    background: "#fff",
                    color: "#1a73e8",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  填充
                </button>
              ) : item.uris.length > 0 ? (
                <button
                  onClick={() => handleOpenUrl(item)}
                  title={`前往 ${item.name} 的网站`}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ↗
                </button>
              ) : null}
              <div data-copy-menu>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openMenuId === item.cipher.id) {
                      setOpenMenuId(null);
                      setMenuPos(null);
                    } else {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenuPos({
                        top: rect.bottom + 4,
                        right: window.innerWidth - rect.right,
                      });
                      setOpenMenuId(item.cipher.id);
                    }
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  复制
                </button>
              {openMenuId === item.cipher.id && menuPos && (
                <div
                  style={{
                    position: "fixed",
                    top: menuPos.top,
                    right: menuPos.right,
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: 6,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                    zIndex: 1000,
                    minWidth: 110,
                    overflow: "hidden",
                  }}
                >
                  <button
                    onClick={() => handleCopy(item.cipher, "username")}
                    disabled={!item.username}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 12px",
                      border: "none",
                      background: "none",
                      textAlign: "left",
                      fontSize: 12,
                      cursor: item.username ? "pointer" : "not-allowed",
                      color: item.username ? "#333" : "#bbb",
                    }}
                  >
                    复制用户名
                  </button>
                  <button
                    onClick={() => handleCopy(item.cipher, "password")}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 12px",
                      border: "none",
                      background: "none",
                      textAlign: "left",
                      fontSize: 12,
                      cursor: "pointer",
                      color: "#333",
                      borderTop: "1px solid #f0f0f0",
                    }}
                  >
                    复制密码
                  </button>
                  {item.hasTotp && (
                    <button
                      onClick={() => handleCopyTotp(item.cipher)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "none",
                        textAlign: "left",
                        fontSize: 12,
                        cursor: "pointer",
                        color: "#333",
                        borderTop: "1px solid #f0f0f0",
                      }}
                    >
                      复制验证码
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#999", padding: 24, fontSize: 13 }}>
            暂无凭据
          </div>
        )}
      </div>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.82)",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: 16,
            fontSize: 12,
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          {toast}
        </div>
      )}
      {renderSyncFooter(syncStatus)}
    </div>
  );
}

function renderSyncFooter(status: SyncStatus | null): React.ReactElement {
  let text = "未同步";
  if (status) {
    if (status.state === "SYNCING") {
      text = "同步中...";
    } else if (status.state === "ERROR") {
      text = "同步失败";
    } else if (status.state === "OFFLINE") {
      text = "离线";
    } else if (status.lastSyncAt) {
      try {
        const d = new Date(status.lastSyncAt);
        text = `上次同步: ${d.toLocaleString("zh-CN", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      } catch {
        text = "同步时间未知";
      }
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "6px 12px",
        background: "#f8f9fa",
        borderTop: "1px solid #eee",
        fontSize: 11,
        color: "#888",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 50,
      }}
    >
      <span>
        {text}
        {status && status.pendingChanges > 0 && (
          <span style={{ marginLeft: 8, color: "#1a73e8" }}>
            待同步: {status.pendingChanges}
          </span>
        )}
      </span>
      <button
        onClick={() => chrome.runtime.openOptionsPage()}
        title="打开设置"
        style={{
          position: "absolute",
          right: 4,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 18,
          color: "#666",
          padding: "4px 10px",
        }}
      >
        &#9881;
      </button>
    </div>
  );
}
