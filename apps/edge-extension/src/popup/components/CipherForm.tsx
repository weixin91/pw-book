import React, { useEffect, useState } from "react";
import { StorageService } from "../../platform/storage";

interface Props {
  editId: string | null;
  onBack: () => void;
  onSaved: () => void;
}

export function CipherForm({ editId, onBack, onSaved }: Props): React.ReactElement {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState("");
  const [notes, setNotes] = useState("");
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
      setUri(data.login?.uris?.[0]?.uri || "");
      setNotes(data.notes || "");
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    setLoading(true);
    try {
      const userKey = await StorageService.getUserKey();
      if (!userKey) return;

      const { encryptCipherData } = await import("../../crypto/crypto-service");
      const cipherData = {
        name: name || uri || "未命名",
        notes: notes || null,
        fields: [],
        lastUsedAt: null,
        login: {
          username: username || null,
          password: password || null,
          uris: uri ? [{ uri, match: null }] : [],
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
            modifiedAt: new Date().toISOString(),
          };
        }
      } else {
        ciphers.push({
          id: crypto.randomUUID(),
          userId: "",
          type: 1,
          data: encryptedData,
          favorite: false,
          reprompt: 0,
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        });
      }

      await StorageService.setCiphers(ciphers);
      onSaved();
    } finally {
      setLoading(false);
    }
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
      {renderInput("网站", uri, setUri)}
      {renderInput("备注", notes, setNotes)}
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
    </div>
  );
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
