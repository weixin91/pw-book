import React from "react";

interface Props {
  onSelect: (type: "login" | "note") => void;
  onCancel: () => void;
}

export function TypeSelector({ onSelect, onCancel }: Props): React.ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 20,
          width: 260,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 16, textAlign: "center" }}>
          选择类型
        </div>
        <button
          onClick={() => onSelect("login")}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            marginBottom: 10,
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>🔐</span> 密码凭据
        </button>
        <button
          onClick={() => onSelect("note")}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>📝</span> 安全笔记
        </button>
        <button
          onClick={onCancel}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "10px",
            borderRadius: 8,
            border: "none",
            background: "#f5f5f5",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
