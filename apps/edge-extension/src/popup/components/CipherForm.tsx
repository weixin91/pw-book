import React, { useEffect, useState } from "react";
import { StorageService } from "../../platform/storage";
import { BrowserApi } from "../../platform/browser-api";
import { PendingChangesQueue } from "../../sync/pending-changes";
import { parseUri } from "../../autofill/domain-utils";
import { TotpDisplay } from "./TotpDisplay";
import { parseOtpauthUri } from "../../crypto/totp";
import { CipherIndexService } from "../../crypto/cipher-index";
import { parseCipherData } from "../../crypto/cipher-data-parser";
import {
  PasswordGeneratorSettingsService,
  generatePassword,
} from "../settings";

interface Props {
  editId: string | null;
  onBack: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

interface UriEntry {
  uri: string;
}

interface PasskeyInfo {
  rpId: string;
  rpName?: string;
  createdAt: string;
}

export function CipherForm({ editId, onBack, onSaved, onDeleted }: Props): React.ReactElement {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [uris, setUris] = useState<UriEntry[]>([{ uri: "" }]);
  const [notes, setNotes] = useState("");
  const [totp, setTotp] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passkeyInfo, setPasskeyInfo] = useState<PasskeyInfo | null>(null);
  const [rawData, setRawData] = useState<Record<string, unknown> | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showTotp, setShowTotp] = useState(false);

  useEffect(() => {
    if (editId) {
      loadCipher(editId);
    } else {
      // 新建凭据：获取当前页面信息
      BrowserApi.getActiveBrowserTab().then(async (tab) => {
        if (tab?.url && !tab.url.startsWith("chrome-extension://") && !tab.url.startsWith("edge://")) {
          // 设置 URI
          setUris([{ uri: tab.url }]);
          // 提取基础域名+端口号作为默认名称
          try {
            const urlObj = new URL(tab.url);
            const id = parseUri(tab.url);
            if (id?.kind === "web" && id.baseDomain) {
              const defaultName = urlObj.port ? `${id.baseDomain}:${urlObj.port}` : id.baseDomain;
              setName(defaultName);
            }
          } catch {
            // URL 解析失败，忽略
          }
          // 尝试从页面提取用户名和密码
          if (tab.id) {
            try {
              const response = await BrowserApi.sendMessageToTab(tab.id, { type: "EXTRACT_FORM_DATA" }) as { username?: string; password?: string } | undefined;
              if (response?.username) setUsername(response.username);
              if (response?.password) setPassword(response.password);
            } catch {
              // 页面可能不支持消息，忽略
            }
          }
        }
      });
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
      setRawData(data);
      setName(data.name || "");
      setUsername(data.login?.username || "");
      setPassword(data.login?.password || "");
      const loaded = (data.login?.uris ?? []) as Array<{ uri?: string }>;
      const parsed = loaded
        .map((u) => ({ uri: u?.uri ?? "" }))
        .filter((u) => u.uri.length > 0);
      setUris(parsed.length > 0 ? parsed : [{ uri: "" }]);
      setNotes(data.notes || "");
      setTotp(data.login?.totp || "");
      setFavorite(cipher.favorite);

      const pk = data.passkey;
      if (pk?.credentialId) {
        setPasskeyInfo({
          rpId: pk.rpId,
          rpName: pk.rpName,
          createdAt: pk.createdAt,
        });
      } else {
        setPasskeyInfo(null);
      }
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

      const cipherData: Record<string, unknown> = {
        name: name || cleanUris[0]?.uri || "未命名",
        notes: notes || null,
        fields: [],
        lastUsedAt: null,
        login: {
          username: username || null,
          password: password || null,
          uris: cleanUris,
          totp: totp.trim() ? totp.trim() : null,
        },
      };

      // 保留原有的 passkey（如果存在）
      if (rawData?.passkey) {
        cipherData.passkey = rawData.passkey;
      }

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

      // 更新索引
      const targetId = editId || ciphers[ciphers.length - 1].id;
      const cipherDataParsed = parseCipherData(JSON.stringify(cipherData));
      await CipherIndexService.updateOne(targetId, cipherDataParsed);

      const queue = new PendingChangesQueue();
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
    await CipherIndexService.removeOne(editId);

    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: editId,
      operation: "DELETE",
      encryptedData: "",
      clientTimestamp: new Date().toISOString(),
    });

    onDeleted?.();
  }

  async function handleDeletePasskey() {
    if (!editId || !passkeyInfo || !rawData) return;
    if (!window.confirm("确定删除此通行密钥吗？此操作不可恢复。")) return;

    const userKey = await StorageService.getUserKey();
    if (!userKey) return;

    const { encryptCipherData } = await import("../../crypto/crypto-service");
    const { passkey: _, ...restData } = rawData;
    const encryptedData = await encryptCipherData(JSON.stringify(restData), userKey);

    const ciphers = await StorageService.getCiphers();
    const idx = ciphers.findIndex((c) => c.id === editId);
    if (idx >= 0) {
      ciphers[idx] = {
        ...ciphers[idx],
        data: encryptedData,
        modifiedAt: new Date().toISOString(),
      };
      await StorageService.setCiphers(ciphers);

      // 更新索引（passkey 已移除）
      await CipherIndexService.updateOne(editId, parseCipherData(JSON.stringify(restData)));

      const queue = new PendingChangesQueue();
      await queue.enqueue({
        cipherId: editId,
        operation: "UPDATE",
        encryptedData,
        clientTimestamp: new Date().toISOString(),
      });

      setPasskeyInfo(null);
      setRawData(restData);
    }
  }

  function formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  async function handleGeneratePassword() {
    const settings = await PasswordGeneratorSettingsService.load();
    const generated = generatePassword(settings);
    setPassword(generated);
  }

  function renderPasswordInput() {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>密码</label>
        <div style={{ position: "relative" }}>
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 72px 8px 10px",
              borderRadius: 6,
              border: "1px solid #ddd",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              gap: 2,
              alignItems: "center",
            }}
          >
            <button
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "隐藏密码" : "显示密码"}
              style={{
                border: "none",
                background: "transparent",
                width: 28,
                height: 28,
                cursor: "pointer",
                color: "#666",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
            <button
              onClick={handleGeneratePassword}
              title="生成随机密码"
              style={{
                border: "none",
                background: "transparent",
                width: 28,
                height: 28,
                cursor: "pointer",
                color: "#666",
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ⚡
            </button>
          </div>
        </div>
      </div>
    );
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
      {renderPasswordInput()}

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
          <button onClick={() => addUri("https://")} style={smallButtonStyle()}>
            + 网站
          </button>
          <button onClick={() => addUri("androidapp://")} style={smallButtonStyle()}>
            + APP
          </button>
        </div>
      </div>

      {renderInput("备注", notes, setNotes)}

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
          TOTP 密钥（otpauth:// URI 或 Base32 secret）
        </label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type={showTotp ? "text" : "password"}
            value={totp}
            placeholder="otpauth://totp/Issuer:account?secret=..."
            onChange={(e) => setTotp(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #ddd",
              fontSize: 13,
              boxSizing: "border-box",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          />
          <button
            onClick={() => setShowTotp((v) => !v)}
            title={showTotp ? "隐藏密钥" : "显示密钥"}
            style={{
              border: "1px solid #ddd",
              background: "#fff",
              borderRadius: 6,
              width: 32,
              height: 32,
              cursor: "pointer",
              color: "#666",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {showTotp ? "🙈" : "👁"}
          </button>
        </div>
        {totp.trim() && parseOtpauthUri(totp.trim()) && (
          <div style={{ marginTop: 8 }}>
            <TotpDisplay totp={totp.trim()} />
          </div>
        )}
      </div>

      {passkeyInfo && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #e3f2fd",
            background: "#f8fbff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 16 }}>🔐</span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>通行密钥</span>
          </div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
            站点：{passkeyInfo.rpName || passkeyInfo.rpId}
          </div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
            添加时间：{formatDate(passkeyInfo.createdAt)}
          </div>
          <button
            onClick={handleDeletePasskey}
            disabled={loading}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #d32f2f",
              background: "#fff",
              color: "#d32f2f",
              fontSize: 12,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            删除通行密钥
          </button>
        </div>
      )}

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
        <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
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

function renderInput(label: string, value: string, onChange: (v: string) => void, type = "text") {
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
