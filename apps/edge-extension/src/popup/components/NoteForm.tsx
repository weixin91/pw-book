import React, { useState, useEffect } from "react";
import { StorageService } from "../../platform/storage";
import { PendingChangesQueue } from "../../sync/pending-changes";
import { CipherIndexService } from "../../crypto/cipher-index";
import { parseCipherData } from "../../crypto/cipher-data-parser";
import type { Cipher } from "@pwbook/shared-types";

interface Props {
  editId: string | null;
  onBack: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

export function NoteForm({ editId, onBack, onSaved, onDeleted }: Props): React.ReactElement {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editId) {
      loadNote(editId);
    }
  }, [editId]);

  async function loadNote(id: string) {
    const ciphers = await StorageService.getCiphers();
    const cipher = ciphers.find((c) => c.id === id);
    if (!cipher) return;
    const userKey = await StorageService.getUserKey();
    if (!userKey) return;
    const { decryptCipherData } = await import("../../crypto/crypto-service");
    try {
      const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
      setName(data.name || "");
      setNotes(data.notes || "");
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const userKey = await StorageService.getUserKey();
      if (!userKey) return;
      const { encryptCipherData } = await import("../../crypto/crypto-service");

      const cipherData = {
        name: name.trim(),
        notes: notes.trim() || null,
        fields: [],
        lastUsedAt: null,
        secureNote: { type: 0 },
      };

      const encryptedData = await encryptCipherData(JSON.stringify(cipherData), userKey);
      const ciphers = await StorageService.getCiphers();
      const profile = await StorageService.getProfile();
      const now = new Date().toISOString();

      let targetId: string;
      if (editId) {
        const idx = ciphers.findIndex((c) => c.id === editId);
        if (idx >= 0) {
          ciphers[idx] = { ...ciphers[idx], data: encryptedData, modifiedAt: now };
          targetId = editId;
        } else {
          return;
        }
      } else {
        targetId = crypto.randomUUID();
        ciphers.push({
          id: targetId,
          userId: profile?.id ?? "",
          type: 4,
          data: encryptedData,
          favorite: false,
          reprompt: 0,
          createdAt: now,
          modifiedAt: now,
        } as Cipher);
      }

      await StorageService.setCiphers(ciphers);
      await CipherIndexService.updateOne(targetId, parseCipherData(JSON.stringify(cipherData)));

      const queue = new PendingChangesQueue();
      const cipher = ciphers.find((c) => c.id === targetId)!;
      await queue.enqueue({
        cipherId: targetId,
        operation: editId ? "UPDATE" : "CREATE",
        encryptedData,
        clientTimestamp: now,
        userId: cipher.userId,
        type: cipher.type,
        favorite: cipher.favorite,
        reprompt: cipher.reprompt,
        createdAt: cipher.createdAt,
        modifiedAt: cipher.modifiedAt,
      });

      onSaved();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!editId) return;
    if (!confirm("确定要删除这条笔记吗？")) return;
    const ciphers = await StorageService.getCiphers();
    const filtered = ciphers.filter((c) => c.id !== editId);
    await StorageService.setCiphers(filtered);
    await CipherIndexService.removeOne(editId);

    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: editId,
      operation: "DELETE",
      encryptedData: "",
      clientTimestamp: new Date().toISOString(),
      userId: "",
      type: 4,
      favorite: false,
      reprompt: 0,
      createdAt: "",
      modifiedAt: "",
    });

    onDeleted?.();
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ padding: "4px 8px", fontSize: 13 }}>
          ← 返回
        </button>
        <span style={{ fontWeight: 500, fontSize: 15 }}>
          {editId ? "编辑笔记" : "新建笔记"}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#555" }}>
          标题
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入笔记标题"
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ddd",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#555" }}>
          内容
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="输入笔记内容..."
          rows={8}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ddd",
            fontSize: 14,
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={!name.trim() || loading}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 6,
            border: "none",
            background: name.trim() ? "#1a73e8" : "#ccc",
            color: "#fff",
            fontSize: 14,
            cursor: name.trim() ? "pointer" : "not-allowed",
          }}
        >
          {loading ? "保存中..." : "保存"}
        </button>
        <button
          onClick={onBack}
          style={{
            padding: "10px 16px",
            borderRadius: 6,
            border: "1px solid #ddd",
            background: "#fff",
            fontSize: 14,
          }}
        >
          取消
        </button>
      </div>

      {editId && (
        <button
          onClick={handleDelete}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "10px",
            borderRadius: 6,
            border: "1px solid #d93025",
            background: "#fff",
            color: "#d93025",
            fontSize: 14,
          }}
        >
          删除笔记
        </button>
      )}
    </div>
  );
}
