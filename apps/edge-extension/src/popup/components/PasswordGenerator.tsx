import React, { useState } from "react";
import { ClipboardManager } from "../../platform/clipboard";

interface Props {
  onBack: () => void;
}

export function PasswordGenerator({ onBack }: Props): React.ReactElement {
  const [length, setLength] = useState(16);
  const [includeUppercase, setIncludeUppercase] = useState(true);
  const [includeLowercase, setIncludeLowercase] = useState(true);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSpecial, setIncludeSpecial] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [password, setPassword] = useState("");

  function generate(): string {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const special = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    const ambiguous = "0O1lI";

    let charset = "";
    if (includeLowercase) charset += lowercase;
    if (includeUppercase) charset += uppercase;
    if (includeNumbers) charset += numbers;
    if (includeSpecial) charset += special;

    if (excludeAmbiguous) {
      for (const ch of ambiguous) {
        charset = charset.replace(ch, "");
      }
    }

    if (charset.length === 0) return "";

    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    let result = "";
    for (let i = 0; i < length; i++) {
      result += charset[array[i] % charset.length];
    }
    return result;
  }

  function handleGenerate() {
    setPassword(generate());
  }

  async function handleCopy() {
    if (password) {
      await ClipboardManager.copy(password);
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
          密码生成器
        </div>
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 8,
          border: "1px solid #ddd",
          background: "#f9f9f9",
          marginBottom: 12,
          fontFamily: "monospace",
          fontSize: 14,
          wordBreak: "break-all",
          minHeight: 24,
        }}
      >
        {password || "点击生成"}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "#666" }}>长度: {length}</label>
        <input
          type="range"
          min={5}
          max={128}
          value={length}
          onChange={(e) => setLength(parseInt(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {renderCheckbox("大写字母", includeUppercase, setIncludeUppercase)}
      {renderCheckbox("小写字母", includeLowercase, setIncludeLowercase)}
      {renderCheckbox("数字", includeNumbers, setIncludeNumbers)}
      {renderCheckbox("特殊字符", includeSpecial, setIncludeSpecial)}
      {renderCheckbox("排除易混淆字符", excludeAmbiguous, setExcludeAmbiguous)}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={handleGenerate}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            border: "none",
            background: "#1a73e8",
            color: "#fff",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          生成
        </button>
        <button
          onClick={handleCopy}
          disabled={!password}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            border: "1px solid #1a73e8",
            background: "#fff",
            color: "#1a73e8",
            fontSize: 14,
            cursor: password ? "pointer" : "not-allowed",
          }}
        >
          复制
        </button>
      </div>
    </div>
  );
}

function renderCheckbox(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void
) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        marginBottom: 8,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
