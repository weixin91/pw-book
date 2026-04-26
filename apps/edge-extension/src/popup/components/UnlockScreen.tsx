import React, { useState } from "react";
import { StorageService } from "../../platform/storage";
import {
  deriveMasterKey,
  deriveStretchedMasterKey,
  decryptUserKey,
} from "../../crypto/crypto-service";

interface Props {
  onUnlocked: () => void;
}

export function UnlockScreen({ onUnlocked }: Props): React.ReactElement {
  const [masterPassword, setMasterPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUnlock() {
    setError("");
    setLoading(true);
    try {
      const profile = await StorageService.getProfile();
      if (!profile) {
        setError("未登录，请先在选项页配置账户");
        setLoading(false);
        return;
      }

      const masterKey = await deriveMasterKey(masterPassword, profile.email, {
        kdfType: profile.kdfType as "PBKDF2_SHA256" | "ARGON2ID",
        kdfIterations: profile.kdfIterations,
        kdfMemory: profile.kdfMemory,
        kdfParallelism: profile.kdfParallelism,
      });
      const stretched = await deriveStretchedMasterKey(masterKey);
      const protectedKey = await StorageService.getEncryptedKey();
      if (!protectedKey) {
        setError("未找到加密密钥");
        setLoading(false);
        return;
      }
      const userKey = await decryptUserKey(protectedKey, stretched);
      await StorageService.setUserKey(userKey);
      chrome.runtime.sendMessage({ type: "VAULT_UNLOCKED" });
      onUnlocked();
    } catch {
      setError("主密码错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Password Book</h2>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
        输入主密码解锁保险库
      </p>
      <input
        type="password"
        placeholder="主密码"
        value={masterPassword}
        onChange={(e) => setMasterPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #ddd",
          fontSize: 14,
          boxSizing: "border-box",
          marginBottom: 12,
        }}
      />
      {error && (
        <div style={{ color: "#d32f2f", fontSize: 12, marginBottom: 12 }}>
          {error === "未登录，请先在选项页配置账户" ? (
            <span>
              未登录，请先在
              <button
                onClick={() => chrome.runtime.openOptionsPage()}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "#d32f2f",
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                选项页
              </button>
              配置账户
            </span>
          ) : (
            error
          )}
        </div>
      )}
      <button
        onClick={handleUnlock}
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
        {loading ? "解锁中..." : "解锁"}
      </button>
    </div>
  );
}
