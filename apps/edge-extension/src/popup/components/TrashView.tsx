import React, { useEffect, useState } from "react";
import { StorageService } from "../../platform/storage";
import { TrashClient } from "../../sync/trash-client";
import type { Cipher } from "@pwbook/shared-types";

interface TrashItem {
  cipher: Cipher;
  name: string;
  username: string;
  decryptFailed: boolean;
  deletedAt: string;
}

interface Props {
  onBack: () => void;
}

export function TrashView({ onBack }: Props): React.ReactElement {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadTrash();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadTrash() {
    setLoading(true);
    setError(null);
    try {
      const client = new TrashClient();
      const list = await client.list();
      const userKey = await StorageService.getUserKey();
      if (!userKey) {
        setError("会话已过期,请重新登录");
        setItems([]);
        return;
      }

      const { decryptCipherData } = await import("../../crypto/crypto-service");
      const decrypted = await Promise.all(
        list.map(async (cipher) => {
          try {
            const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
            return {
              cipher,
              name: data.name || "未命名",
              username: data.login?.username || "",
              decryptFailed: false,
              deletedAt: cipher.deletedAt ?? "",
            } as TrashItem;
          } catch {
            return {
              cipher,
              name: `解密失败 (${cipher.id.slice(0, 8)})`,
              username: "",
              decryptFailed: true,
              deletedAt: cipher.deletedAt ?? "",
            } as TrashItem;
          }
        })
      );
      setItems(decrypted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(id: string) {
    try {
      const client = new TrashClient();
      await client.restore(id);
      setItems((prev) => prev.filter((it) => it.cipher.id !== id));
      setToast("已恢复");
      try {
        await chrome.runtime.sendMessage({ type: "TRIGGER_SYNC_NOW" });
      } catch {
        // 即使发不出 sync 通知也不阻塞,本设备无该 cipher 等下次 sync 拉回
      }
    } catch {
      setToast("恢复失败");
    }
  }

  async function handlePermanentDelete(id: string, name: string) {
    const ok = window.confirm(`确定永久删除 "${name}" 吗?此操作不可恢复。`);
    if (!ok) return;
    try {
      const client = new TrashClient();
      await client.permanentDelete(id);
      setItems((prev) => prev.filter((it) => it.cipher.id !== id));
      setToast("已永久删除");
    } catch {
      setToast("永久删除失败");
    }
  }

  function formatDeletedAt(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <button
          onClick={onBack}
          style={{
            padding: "4px 8px",
            fontSize: 13,
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          ← 返回
        </button>
        <div style={{ marginLeft: 8, fontWeight: 500, fontSize: 14 }}>
          回收站{items.length > 0 ? `(${items.length})` : ""}
        </div>
      </div>

      {loading && <div style={{ color: "#888", fontSize: 13 }}>加载中...</div>}

      {!loading && error && (
        <div>
          <div style={{ color: "#c62828", fontSize: 13, marginBottom: 8 }}>
            加载失败: {error}
          </div>
          <button onClick={loadTrash} style={{ padding: "4px 12px", fontSize: 13, cursor: "pointer" }}>
            重试
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ color: "#888", fontSize: 13, marginTop: 24, textAlign: "center" }}>
          回收站为空
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div>
          {items.map((item) => (
            <div
              key={item.cipher.id}
              style={{
                padding: "10px 8px",
                borderBottom: "1px solid #f0f0f0",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 14,
                    color: item.decryptFailed ? "#c62828" : "#333",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.name}
                </div>
                <div style={{ color: "#888", fontSize: 12 }}>{item.username}</div>
                <div style={{ color: "#aaa", fontSize: 11 }}>
                  删除于 {formatDeletedAt(item.deletedAt)}
                </div>
              </div>
              <button
                onClick={() => handleRestore(item.cipher.id)}
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  border: "1px solid #1a73e8",
                  background: "#fff",
                  color: "#1a73e8",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                恢复
              </button>
              <button
                onClick={() => handlePermanentDelete(item.cipher.id, item.name)}
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  border: "1px solid #c62828",
                  background: "#fff",
                  color: "#c62828",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                永久删除
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
