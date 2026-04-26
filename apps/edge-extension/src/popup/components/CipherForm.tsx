import React, { useEffect, useState } from "react";
import { StorageService } from "../../platform/storage";
import { PendingChangesQueue } from "../../sync/pending-changes";
import { parseUri } from "../../autofill/domain-utils";

interface Props {
  editId: string | null;
  onBack: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

interface UriEntry {
  uri: string;
}

export function CipherForm({ editId, onBack, onSaved, onDeleted }: Props): React.ReactElement {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [uris, setUris] = useState<UriEntry[]>([{ uri: "" }]);
  const [notes, setNotes] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editId) {
      loadCipher(editId);
    }
  }, [editId]);

  async function loadCipher(id: string) {
    const ciphers = await StorageService.getCiphers();
    const cipher = ciphers.find((c) => c.id === id);
    if (!cipher) return;
    const userKey = await StorageService.getUserKey();
    if (!userKey) return;
    const { decryptCipherData } = await import("../../crypto/crypto-service");
    try {
      const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
      setName(data.name || "");
      setUsername(data.login?.username || "");
      setPassword(data.login?.password || "");
      const loaded = (data.login?.uris ?? []) as Array<{ uri?: string }>;
      const parsed = loaded
        .map((u) => ({ uri: u?.uri ?? "" }))
        .filter((u) => u.uri.length > 0);
      setUris(parsed.length > 0 ? parsed : [{ uri: "" }]);
      setNotes(data.notes || "");
      setFavorite(cipher.favorite);
    } catch {
      // ignore
    }
  }

  function updateUri(index: number, value: string) {
    setUris((prev) => prev.map((u, i) => (i === index ? { uri: value } : u)));
  }

  function addUri(prefix?: string) {
    setUris((prev) => [...prev, { uri: prefix ?? "" }]);
  }

  function removeUri(index: number) {
    setUris((prev) => {
      if (prev.length <= 1) return [{ uri: "" }];
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSave() {
    setLoading(true);
    try {
      const userKey = await StorageService.getUserKey();
      if (!userKey) return;

      const { encryptCipherData } = await import("../../crypto/crypto-service");

      // 过滤空 URI 并去重
      const cleanUris = uris
        .map((u) => u.uri.trim())
        .filter((u) => u.length > 0)
        .filter((u, i, arr) => arr.indexOf(u) === i)
        .map((u) => ({ uri: u, match: null }));

      const cipherData = {
        name: name || cleanUris[0]?.uri || "未命名",
        notes: notes || null,
        fields: [],
        lastUsedAt: null,
        login: {
          username: username || null,
          password: password || null,
          uris: cleanUris,
          totp: null,
        },
      };

      const encryptedData = await encryptCipherData(JSON.stringify(cipherData), userKey);
      const ciphers = await StorageService.getCiphers();

      if (editId) {
        const idx = ciphers.findIndex((c) => c.id === editId);
        if (idx >= 0) {
          ciphers[idx] = {
            ...ciphers[idx],
            data: encryptedData,
            favorite,
            modifiedAt: new Date().toISOString(),
          };
        }
      } else {
        ciphers.push({
          id: crypto.randomUUID(),
          userId: "",
          type: 1,
          data: encryptedData,
          favorite,
          reprompt: 0,
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        });
      }

      await StorageService.setCiphers(ciphers);

      const queue = new PendingChangesQueue();
      const targetId = editId || ciphers[ciphers.length - 1].id;
      await queue.enqueue({
        cipherId: targetId,
        operation: editId ? "UPDATE" : "CREATE",
        encryptedData,
        clientTimestamp: new Date().toISOString(),
      });

      onSaved();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!editId) return;
    if (!window.confirm("确定删除此凭据吗？此操作不可恢复。")) return;

    const ciphers = await StorageService.getCiphers();
    const filtered = ciphers.filter((c) => c.id !== editId);
    await StorageService.setCiphers(filtered);

    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: editId,
      operation: "DELETE",
      encryptedData: "",
      clientTimestamp: new Date().toISOString(),
    });

    onDeleted?.();
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{
            border: "none",
            background: "transparent",
            fontSize: 14,
            cursor: "pointer",
            color: "#1a73e8",
          }}
        >
          返回
        </button>
        <div style={{ flex: 1, textAlign: "center", fontWeight: 500 }}>
          {editId ? "编辑凭据" : "新增凭据"}
        </div>
      </div>
      {renderInput("名称", name, setName)}
      {renderInput("用户名", username, setUsername)}
      {renderInput("密码", password, setPassword, "password")}

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 12,
            color: "#666",
            marginBottom: 6,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>自动填充选项（网站或 APP）</span>
        </div>
        {uris.map((entry, index) => {
          const id = parseUri(entry.uri);
          const kindLabel = id?.kind === "android" ? "APP" : id?.kind === "web" ? "网站" : "URI";
          return (
            <div
              key={index}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "#888",
                  minWidth: 32,
                }}
              >
                {kindLabel}
              </span>
              <input
                type="text"
                value={entry.uri}
                placeholder="https://example.com 或 androidapp://com.example"
                onChange={(e) => updateUri(index, e.target.value)}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #ddd",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={() => removeUri(index)}
                title="删除"
                style={{
                  border: "1px solid #ddd",
                  background: "#fff",
                  borderRadius: 6,
                  width: 28,
                  height: 28,
                  cursor: "pointer",
                  color: "#666",
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            onClick={() => addUri("https://")}
            style={smallButtonStyle()}
          >
            + 网站
          </button>
          <button
            onClick={() => addUri("androidapp://")}
            style={smallButtonStyle()}
          >
            + APP
          </button>
        </div>
      </div>

      {renderInput("备注", notes, setNotes)}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          marginBottom: 12,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={favorite}
          onChange={(e) => setFavorite(e.target.checked)}
        />
        收藏此凭据
      </label>
      <button
        onClick={handleSave}
        disabled={loading}
        style={{
          width: "100%",
          padding: "10px",
          borderRadius: 8,
          border: "none",
          background: "#1a73e8",
          color: "#fff",
          fontSize: 14,
          cursor: loading ? "not-allowed" : "pointer",
          marginTop: 8,
        }}
      >
        {loading ? "保存中..." : "保存"}
      </button>
      {editId && (
        <button
          onClick={handleDelete}
          disabled={loading}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 8,
            border: "1px solid #d32f2f",
            background: "#fff",
            color: "#d32f2f",
            fontSize: 14,
            cursor: loading ? "not-allowed" : "pointer",
            marginTop: 12,
          }}
        >
          删除凭据
        </button>
      )}
    </div>
  );
}

function smallButtonStyle(): React.CSSProperties {
  return {
    border: "1px solid #1a73e8",
    background: "#fff",
    color: "#1a73e8",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  };
}

function renderInput(
  label: string,
  value: string,
  onChange: (v: string) => void,
  type = "text"
) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid #ddd",
          fontSize: 13,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
