import React, { useEffect, useState } from "react";
import { StorageService } from "../../platform/storage";
import { ClipboardManager } from "../../platform/clipboard";
import { PendingChangesQueue } from "../../sync/pending-changes";
import type { Cipher } from "@pwbook/shared-types";

interface VaultItem {
  cipher: Cipher;
  name: string;
  username: string;
}

interface Props {
  onAdd: () => void;
  onEdit: (id: string) => void;
  onOpenGenerator: () => void;
}

export function VaultList({ onAdd, onEdit, onOpenGenerator }: Props): React.ReactElement {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    const ciphers = await StorageService.getCiphers();
    const userKey = await StorageService.getUserKey();
    if (!userKey) return;

    const { decryptCipherData } = await import("../../crypto/crypto-service");
    const decrypted = await Promise.all(
      ciphers.map(async (cipher) => {
        try {
          const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
          return {
            cipher,
            name: data.name || "未命名",
            username: data.login?.username || "",
          };
        } catch (err) {
          console.error("[VaultList] 解密失败:", cipher.id, err);
          return { cipher, name: "解密失败", username: "" };
        }
      })
    );
    setItems(decrypted);
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

  async function handleCopyPassword(cipher: Cipher) {
    const userKey = await StorageService.getUserKey();
    if (!userKey) return;
    const { decryptCipherData } = await import("../../crypto/crypto-service");
    try {
      const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
      const password = data.login?.password;
      if (password) {
        await ClipboardManager.copy(password);
      }
    } catch {
      // ignore
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
      <button
        onClick={onOpenGenerator}
        style={{
          width: "100%",
          padding: "8px",
          borderRadius: 6,
          border: "1px solid #1a73e8",
          background: "#fff",
          color: "#1a73e8",
          fontSize: 13,
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        密码生成器
      </button>
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
              <div style={{ fontWeight: 500, fontSize: 14 }}>{item.name}</div>
              <div style={{ color: "#888", fontSize: 12 }}>{item.username}</div>
            </div>
            <button
              onClick={() => handleCopyPassword(item.cipher)}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #ddd",
                background: "#fff",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              复制密码
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#999", padding: 24, fontSize: 13 }}>
            暂无凭据
          </div>
        )}
      </div>
    </div>
  );
}
