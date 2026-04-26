import React, { useEffect, useState } from "react";
import { ClipboardManager } from "../../platform/clipboard";
import {
  PasswordGeneratorSettingsService,
  type PasswordGeneratorSettings,
} from "../settings";

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
  const [minNumbers, setMinNumbers] = useState(1);
  const [minSpecial, setMinSpecial] = useState(1);
  const [password, setPassword] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    PasswordGeneratorSettingsService.load().then((s) => {
      setLength(s.length);
      setIncludeUppercase(s.includeUppercase);
      setIncludeLowercase(s.includeLowercase);
      setIncludeNumbers(s.includeNumbers);
      setIncludeSpecial(s.includeSpecial);
      setExcludeAmbiguous(s.excludeAmbiguous);
      setMinNumbers(s.minNumbers);
      setMinSpecial(s.minSpecial);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const settings: PasswordGeneratorSettings = {
      length,
      includeUppercase,
      includeLowercase,
      includeNumbers,
      includeSpecial,
      excludeAmbiguous,
      minNumbers,
      minSpecial,
    };
    PasswordGeneratorSettingsService.save(settings);
  }, [
    loaded,
    length,
    includeUppercase,
    includeLowercase,
    includeNumbers,
    includeSpecial,
    excludeAmbiguous,
    minNumbers,
    minSpecial,
  ]);

  function generate(): string {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "23456789"; // 排除易混淆字符后的数字
    const numbersAll = "0123456789";
    const special = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    const ambiguous = "0O1lI";

    let resultChars: string[] = [];

    // 1. 先填充最小数字数
    if (includeNumbers && minNumbers > 0) {
      const numPool = excludeAmbiguous ? numbers : numbersAll;
      for (let i = 0; i < minNumbers; i++) {
        resultChars.push(numPool[randomIndex(numPool.length)]);
      }
    }

    // 2. 再填充最小特殊字符数
    if (includeSpecial && minSpecial > 0) {
      for (let i = 0; i < minSpecial; i++) {
        resultChars.push(special[randomIndex(special.length)]);
      }
    }

    // 3. 构建剩余字符池
    let charset = "";
    if (includeLowercase) charset += lowercase;
    if (includeUppercase) charset += uppercase;
    if (includeNumbers) charset += excludeAmbiguous ? numbers : numbersAll;
    if (includeSpecial) charset += special;

    if (excludeAmbiguous) {
      for (const ch of ambiguous) {
        charset = charset.replaceAll(ch, "");
      }
    }

    if (charset.length === 0) return "";

    // 4. 填充剩余长度
    const remaining = Math.max(0, length - resultChars.length);
    for (let i = 0; i < remaining; i++) {
      resultChars.push(charset[randomIndex(charset.length)]);
    }

    // 5. Fisher-Yates 打乱
    for (let i = resultChars.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [resultChars[i], resultChars[j]] = [resultChars[j], resultChars[i]];
    }

    return resultChars.join("");
  }

  function randomIndex(max: number): number {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] % max;
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
      {renderNumberInput("最小数字数", minNumbers, setMinNumbers, 0, 9)}
      {renderNumberInput("最小特殊字符数", minSpecial, setMinSpecial, 0, 9)}

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

function renderNumberInput(
  label: string,
  value: number,
  onChange: (v: number) => void,
  min: number,
  max: number
) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <label style={{ fontSize: 13, flex: 1 }}>{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || 0)))}
        style={{
          width: 60,
          padding: "4px 8px",
          borderRadius: 4,
          border: "1px solid #ddd",
          fontSize: 13,
          textAlign: "center",
        }}
      />
    </div>
  );
}
