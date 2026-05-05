import React, { useState, useRef } from "react";
import { StorageService } from "../../platform/storage";
import { CipherIndexService } from "../../crypto/cipher-index";
import { decryptCipherData } from "../../crypto/crypto-service";
import { PendingChangesQueue } from "../../sync/pending-changes";
import {
  parseBitwardenExport,
  convertBitwardenItems,
  type ParseResult,
} from "../../import/bitwarden-importer";

export function ImportPanel(): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; skipped: number } | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    resetState();
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || "");
      setFileContent(text);
      try {
        const result = parseBitwardenExport(text);
        setParseResult(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "解析失败");
        setParseResult(null);
      }
    };
    reader.onerror = () => {
      setError("文件读取失败");
    };
    reader.readAsText(file);
  }

  function resetState() {
    setFileContent(null);
    setParseResult(null);
    setError(null);
    setImportResult(null);
  }

  async function handleImport() {
    if (!fileContent || !parseResult) return;
    setError(null);
    setImportResult(null);

    const userKey = await StorageService.getUserKey();
    if (!userKey) {
      setError("保险库未解锁，请先登录");
      return;
    }

    const profile = await StorageService.getProfile();
    if (!profile) {
      setError("未登录，请先注册或登录");
      return;
    }

    setImporting(true);
    try {
      const existingCiphers = await StorageService.getCiphers();
      const { ciphers, skipped } = await convertBitwardenItems(
        parseResult.export.items,
        userKey,
        existingCiphers,
        profile.id
      );

      if (ciphers.length > 0) {
        const merged = [...existingCiphers, ...ciphers];
        await StorageService.setCiphers(merged);

        // 导入后重建索引
        await CipherIndexService.rebuild(merged, (data) => decryptCipherData(data, userKey));

        const queue = new PendingChangesQueue();
        for (const cipher of ciphers) {
          await queue.enqueue(
            {
              cipherId: cipher.id,
              operation: "CREATE",
              encryptedData: cipher.data,
              clientTimestamp: new Date().toISOString(),
            },
            false // 批量入队时不触发同步，全部入队后统一触发
          );
        }
        // 全部入队后统一触发一次同步
        try {
          chrome.runtime.sendMessage({ type: "TRIGGER_SYNC_NOW" });
        } catch {
          // ignore
        }
      }

      setImportResult({ success: ciphers.length, skipped });
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function handleClearVault() {
    if (!window.confirm("确定清空本地保险库吗？所有凭据将被删除且不可恢复。")) return;
    await StorageService.setCiphers([]);
    await CipherIndexService.clear();
    await StorageService.setPendingChanges([]);
    await StorageService.setLastSyncToken("");
    setError(null);
    setImportResult(null);
    alert("本地保险库已清空");
  }

  function handleClear() {
    setFileName(null);
    setFileContent(null);
    setParseResult(null);
    setError(null);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 8, fontWeight: 500 }}>
          选择 Bitwarden 导出文件
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ fontSize: 14 }}
        />
        {fileName && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
            已选择：{fileName}
            <button
              onClick={handleClear}
              style={{
                marginLeft: 12,
                fontSize: 12,
                color: "#d32f2f",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              清除
            </button>
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "#ffebee",
            color: "#d32f2f",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {parseResult && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: "1px solid #e3f2fd",
            background: "#f8fbff",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>解析预览</div>
          <div style={{ fontSize: 13, color: "#444", lineHeight: 1.8 }}>
            <div>总条目数：{parseResult.export.items.length}</div>
            <div>LOGIN 凭据：{parseResult.loginCount}</div>
            <div>含 Passkey：{parseResult.passkeyCount}</div>
          </div>
        </div>
      )}

      {parseResult && parseResult.loginCount > 0 && !importResult && (
        <button
          onClick={handleImport}
          disabled={importing}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 8,
            border: "none",
            background: "#1a73e8",
            color: "#fff",
            fontSize: 14,
            cursor: importing ? "not-allowed" : "pointer",
            opacity: importing ? 0.7 : 1,
          }}
        >
          {importing ? "导入中..." : `导入 ${parseResult.loginCount} 条凭据`}
        </button>
      )}

      <button
        onClick={handleClearVault}
        style={{
          width: "100%",
          padding: "10px",
          borderRadius: 8,
          border: "1px solid #d32f2f",
          background: "#fff",
          color: "#d32f2f",
          fontSize: 14,
          cursor: "pointer",
          marginTop: 16,
        }}
      >
        清空本地保险库
      </button>

      {importResult && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: "1px solid #2e7d32",
            background: "#e8f5e9",
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500, color: "#2e7d32", marginBottom: 8 }}>
            导入完成
          </div>
          <div style={{ fontSize: 13, color: "#444", lineHeight: 1.8 }}>
            <div>成功导入：{importResult.success} 条</div>
            {importResult.skipped > 0 && <div>跳过重复：{importResult.skipped} 条</div>}
          </div>
        </div>
      )}
    </div>
  );
}
