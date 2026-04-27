import React, { useEffect, useState } from "react";
import { BrowserApi } from "../../platform/browser-api";
import { getBaseDomainFromAny } from "../../autofill/domain-utils";
import {
  getSyncConfig,
  setSyncConfig,
  removeSyncConfig,
  pullConfigsFromServer,
  pushConfigToServer,
} from "../../cookie/sync-config-storage";
import { manualPushCookie } from "../../background/cookie-auto-push";
import { manualPullCookie } from "../../background/cookie-auto-pull";

export function CookieSyncPanel(): React.ReactElement {
  const [currentDomain, setCurrentDomain] = useState<string>("");
  const [includeLocalStorage, setIncludeLocalStorage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    loadCurrentDomain();
  }, []);

  async function loadCurrentDomain() {
    const tab = await BrowserApi.getActiveTab();
    if (tab?.url) {
      const domain = getBaseDomainFromAny(tab.url);
      setCurrentDomain(domain);
      if (domain) {
        const config = await getSyncConfig(domain);
        if (config) {
          setIncludeLocalStorage(config.includeLocalStorage);
        }
      }
    }
  }

  async function handleSaveConfig() {
    if (!currentDomain) return;
    const config = { autoPush: false, autoPull: false, includeLocalStorage };
    await setSyncConfig(currentDomain, config);
    await pushConfigToServer(currentDomain, config);
    setMessage("配置已保存");
    setTimeout(() => setMessage(""), 2000);
  }

  async function handleRemoveConfig() {
    if (!currentDomain) return;
    await removeSyncConfig(currentDomain);
    setIncludeLocalStorage(false);
    setMessage("配置已清除");
    setTimeout(() => setMessage(""), 2000);
  }

  async function handlePush() {
    if (!currentDomain) return;
    setLoading(true);
    setMessage("正在推送...");
    try {
      await manualPushCookie(currentDomain, includeLocalStorage);
      setMessage("推送成功");
      setTimeout(() => window.close(), 1200);
    } catch (err) {
      setMessage(`推送失败: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
      setTimeout(() => setMessage(""), 3000);
    }
  }

  async function handlePull() {
    if (!currentDomain) return;
    const tab = await BrowserApi.getActiveTab();
    if (!tab?.id) {
      setMessage("无法获取当前标签页");
      return;
    }
    setLoading(true);
    setMessage("正在拉取...");
    try {
      await manualPullCookie(currentDomain, tab.id);
      setMessage("拉取成功，页面即将刷新");
      // 延迟关闭弹窗，让用户看到成功提示
      setTimeout(() => window.close(), 1200);
    } catch (err) {
      setMessage(`拉取失败: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
      setTimeout(() => setMessage(""), 3000);
    }
  }

  async function handleSyncConfigs() {
    setMessage("正在同步规则...");
    await pullConfigsFromServer();
    await loadCurrentDomain();
    setMessage("规则同步完成");
    setTimeout(() => setMessage(""), 2000);
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Cookie 同步</h3>
      <div style={{ marginBottom: 12, fontSize: 13, color: "#555" }}>
        当前域名: <strong>{currentDomain || "—"}</strong>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={includeLocalStorage}
            onChange={(e) => setIncludeLocalStorage(e.target.checked)}
          />
          同步 localStorage（实验性功能）
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={handleSaveConfig} disabled={loading || !currentDomain} style={btnStyle}>
          保存配置
        </button>
        <button onClick={handleRemoveConfig} disabled={loading || !currentDomain} style={btnStyleSecondary}>
          清除配置
        </button>
        <button onClick={handleSyncConfigs} disabled={loading} style={btnStyleSecondary}>
          同步规则
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={handlePush} disabled={loading || !currentDomain} style={btnStyle}>
          手动推送 ↑
        </button>
        <button onClick={handlePull} disabled={loading || !currentDomain} style={btnStyle}>
          手动拉取 ↓
        </button>
      </div>

      {message && (
        <div style={{ fontSize: 12, color: message.includes("失败") ? "#c00" : "#080", marginTop: 8 }}>
          {message}
        </div>
      )}

      <p style={{ fontSize: 11, color: "#888", marginTop: 12 }}>
        提示：Cookie 同步受浏览器安全策略限制，不保证 100% 跨设备可用。
      </p>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "#fff",
};

const btnStyleSecondary: React.CSSProperties = {
  ...btnStyle,
  background: "#f5f5f5",
};
