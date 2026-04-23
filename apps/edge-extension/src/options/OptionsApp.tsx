import React, { useState, useEffect } from "react";
import { StorageService } from "../platform/storage";
import {
  deriveMasterKey,
  deriveStretchedMasterKey,
  deriveMasterPasswordHash,
  generateUserKey,
  encryptUserKey,
  decryptUserKey,
  generateRsaKeyPair,
  exportPublicKeySpki,
  exportPrivateKeyPkcs8,
  encryptWithKey,
  generateRecoveryKey,
  deriveRecoveryKeyHash,
  deriveRecoveryMasterKey,
} from "../crypto/crypto-service";

type Tab = "register" | "login";

const DEFAULT_KDF = {
  kdfType: "PBKDF2_SHA256" as const,
  kdfIterations: 600_000,
  kdfMemory: undefined as number | undefined,
  kdfParallelism: undefined as number | undefined,
};

export function OptionsApp(): React.ReactElement {
  const [serverUrl, setServerUrl] = useState("http://localhost:3000");
  const [autofillMode, setAutofillMode] = useState<"auto" | "manual">("auto");
  const [tab, setTab] = useState<Tab>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    StorageService.getServerUrl().then((url) => setServerUrl(url));
    StorageService.getAutofillMode().then((mode) => setAutofillMode(mode));
  }, []);

  async function handleSaveServerUrl() {
    await StorageService.setServerUrl(serverUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSaveAutofillMode(mode: "auto" | "manual") {
    await StorageService.setAutofillMode(mode);
    setAutofillMode(mode);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function resetForm() {
    setError("");
    setRecoveryKey("");
  }

  async function handleRegister() {
    resetForm();
    if (!email || !password) {
      setError("请填写邮箱和主密码");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的主密码不一致");
      return;
    }
    if (password.length < 8) {
      setError("主密码长度至少为 8 位");
      return;
    }

    setLoading(true);
    try {
      const masterKey = await deriveMasterKey(password, email, DEFAULT_KDF);
      const stretched = await deriveStretchedMasterKey(masterKey);
      const userKey = await generateUserKey();
      const protectedKey = await encryptUserKey(userKey, stretched);
      const masterPasswordHash = await deriveMasterPasswordHash(masterKey, password);
      const keyPair = await generateRsaKeyPair();
      const publicKey = await exportPublicKeySpki(keyPair.publicKey);
      const privateKeyPkcs8 = await exportPrivateKeyPkcs8(keyPair.privateKey);
      const encryptedPrivateKey = await encryptWithKey(privateKeyPkcs8, userKey);
      const recKey = await generateRecoveryKey();
      const recoveryKeyHash = await deriveRecoveryKeyHash(recKey, email);
      const recoveryMasterKey = await deriveRecoveryMasterKey(recKey, email);
      const encryptedRecoveryKey = await encryptWithKey(userKey, recoveryMasterKey);

      const res = await fetch(`${serverUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          masterPasswordHash: arrayBufferToBase64(masterPasswordHash),
          protectedKey,
          publicKey,
          encryptedPrivateKey,
          ...DEFAULT_KDF,
          recoveryKeyHash,
          encryptedRecoveryKey,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `注册失败 (${res.status})`);
      }

      const data = await res.json();
      await StorageService.setProfile({
        id: data.id,
        email: data.email,
        ...DEFAULT_KDF,
        publicKey,
        securityStamp: data.securityStamp || "",
        token: data.token,
        refreshToken: data.refreshToken,
      });
      await StorageService.setEncryptedKey(protectedKey);
      await StorageService.setUserKey(userKey);

      setRecoveryKey(recKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    resetForm();
    if (!email || !password) {
      setError("请填写邮箱和主密码");
      return;
    }

    setLoading(true);
    try {
      const preloginRes = await fetch(`${serverUrl}/api/auth/prelogin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!preloginRes.ok) {
        const data = await preloginRes.json().catch(() => ({}));
        throw new Error(data.message || "邮箱或主密码错误");
      }
      const kdfParams = await preloginRes.json();

      const masterKey = await deriveMasterKey(password, email, {
        kdfType: kdfParams.kdfType,
        kdfIterations: kdfParams.kdfIterations,
        kdfMemory: kdfParams.kdfMemory,
        kdfParallelism: kdfParams.kdfParallelism,
      });
      const masterPasswordHash = await deriveMasterPasswordHash(masterKey, password);
      const deviceId = crypto.randomUUID();

      const res = await fetch(`${serverUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          masterPasswordHash: arrayBufferToBase64(masterPasswordHash),
          deviceId,
          deviceType: "BROWSER",
          deviceName: navigator.userAgent.slice(0, 50) || "Edge Browser",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "邮箱或主密码错误");
      }

      const data = await res.json();
      const stretched = await deriveStretchedMasterKey(masterKey);
      const userKey = await decryptUserKey(data.protectedKey, stretched);

      await StorageService.setProfile({
        id: data.id || "",
        email,
        kdfType: kdfParams.kdfType,
        kdfIterations: kdfParams.kdfIterations,
        kdfMemory: kdfParams.kdfMemory,
        kdfParallelism: kdfParams.kdfParallelism,
        publicKey: "",
        securityStamp: data.securityStamp || "",
        token: data.token,
        refreshToken: data.refreshToken,
      });
      await StorageService.setEncryptedKey(data.protectedKey);
      await StorageService.setUserKey(userKey);

      setError("");
      alert("登录成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Password Book 设置</h1>

      <div style={{ marginBottom: 24, padding: 16, borderRadius: 8, border: "1px solid #eee", background: "#fafafa" }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 6, fontWeight: 500 }}>服务器地址</label>
        <input
          type="text"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }}
        />
        <div style={{ marginTop: 8 }}>
          <button
            onClick={handleSaveServerUrl}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "#1a73e8",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            保存
          </button>
          {saved && <span style={{ marginLeft: 12, color: "#2e7d32", fontSize: 14 }}>已保存</span>}
        </div>
      </div>

      <div style={{ marginBottom: 24, padding: 16, borderRadius: 8, border: "1px solid #eee", background: "#fafafa" }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 6, fontWeight: 500 }}>自动填充模式</label>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
            <input
              type="radio"
              name="autofillMode"
              checked={autofillMode === "auto"}
              onChange={() => handleSaveAutofillMode("auto")}
            />
            自动填充（单个凭据时自动填入）
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
            <input
              type="radio"
              name="autofillMode"
              checked={autofillMode === "manual"}
              onChange={() => handleSaveAutofillMode("manual")}
            />
            手动填充（始终弹出列表选择）
          </label>
        </div>
      </div>

      {recoveryKey ? (
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #2e7d32", background: "#e8f5e9" }}>
          <h3 style={{ margin: "0 0 12px", color: "#2e7d32" }}>注册成功</h3>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            请妥善保存以下恢复密钥，它是您忘记主密码时唯一的恢复方式。
          </p>
          <div
            style={{
              padding: 12,
              borderRadius: 6,
              background: "#fff",
              fontFamily: "monospace",
              fontSize: 16,
              letterSpacing: 1,
              wordBreak: "break-all",
              marginBottom: 12,
            }}
          >
            {recoveryKey}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(recoveryKey);
            }}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #2e7d32",
              background: "#fff",
              color: "#2e7d32",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            复制恢复密钥
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", borderBottom: "1px solid #ddd", marginBottom: 16 }}>
            <button
              onClick={() => { setTab("register"); resetForm(); }}
              style={{
                padding: "10px 20px",
                border: "none",
                background: "transparent",
                fontSize: 14,
                cursor: "pointer",
                borderBottom: tab === "register" ? "2px solid #1a73e8" : "2px solid transparent",
                color: tab === "register" ? "#1a73e8" : "#666",
                fontWeight: tab === "register" ? 500 : 400,
              }}
            >
              注册
            </button>
            <button
              onClick={() => { setTab("login"); resetForm(); }}
              style={{
                padding: "10px 20px",
                border: "none",
                background: "transparent",
                fontSize: 14,
                cursor: "pointer",
                borderBottom: tab === "login" ? "2px solid #1a73e8" : "2px solid transparent",
                color: tab === "login" ? "#1a73e8" : "#666",
                fontWeight: tab === "login" ? 500 : 400,
              }}
            >
              登录
            </button>
          </div>

          {error && (
            <div style={{ color: "#d32f2f", fontSize: 13, marginBottom: 12, padding: 8, borderRadius: 4, background: "#ffebee" }}>
              {error}
            </div>
          )}

          {tab === "register" && (
            <div>
              {renderInput("邮箱", email, setEmail, "email")}
              {renderInput("主密码", password, setPassword, "password")}
              {renderInput("确认主密码", confirmPassword, setConfirmPassword, "password")}
              <button
                onClick={handleRegister}
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
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? "注册中..." : "注册"}
              </button>
            </div>
          )}

          {tab === "login" && (
            <div>
              {renderInput("邮箱", email, setEmail, "email")}
              {renderInput("主密码", password, setPassword, "password")}
              <button
                onClick={handleLogin}
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
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? "登录中..." : "登录"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function renderInput(label: string, value: string, onChange: (v: string) => void, type = "text") {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 6,
          border: "1px solid #ddd",
          fontSize: 14,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}
