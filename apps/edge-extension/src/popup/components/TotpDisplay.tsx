import React, { useEffect, useState } from "react";
import { ClipboardManager } from "../../platform/clipboard";
import { generateTotpCode, parseOtpauthUri, type TotpCode } from "../../crypto/totp";

interface Props {
  totp: string; // otpauth:// URI 或裸 Base32 secret
  compact?: boolean;
}

export function TotpDisplay({ totp, compact = false }: Props): React.ReactElement | null {
  const [state, setState] = useState<TotpCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setError(null);
    const config = parseOtpauthUri(totp);
    if (!config) {
      setError("无效的 TOTP 密钥");
      setState(null);
      return;
    }

    let stopped = false;

    async function tick() {
      try {
        const result = await generateTotpCode(config!);
        if (!stopped) setState(result);
      } catch {
        if (!stopped) {
          setError("TOTP 计算失败");
          setState(null);
        }
      }
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [totp]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  if (error) {
    return (
      <div style={{ color: "#d32f2f", fontSize: 12 }}>{error}</div>
    );
  }

  if (!state) {
    return (
      <div style={{ color: "#999", fontSize: 12 }}>正在生成验证码…</div>
    );
  }

  const progress = state.remainingSeconds / state.period;
  const isCritical = state.remainingSeconds <= 5;
  const grouped = formatTotpCode(state.code);

  async function handleCopy() {
    try {
      await ClipboardManager.copy(state!.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          onClick={handleCopy}
          title="复制验证码"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 14,
            letterSpacing: 1.5,
            color: isCritical ? "#d32f2f" : "#1a73e8",
            cursor: "pointer",
          }}
        >
          {grouped}
        </span>
        <CountdownRing
          progress={progress}
          remaining={state.remainingSeconds}
          critical={isCritical}
          size={20}
        />
        {copied && <span style={{ fontSize: 11, color: "#2e7d32" }}>已复制</span>}
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: "10px 12px",
        background: "#fafafa",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#666",
          marginBottom: 4,
        }}
      >
        TOTP 验证码
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          onClick={handleCopy}
          title="复制验证码"
          style={{
            flex: 1,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: 3,
            color: isCritical ? "#d32f2f" : "#1a73e8",
            cursor: "pointer",
          }}
        >
          {grouped}
        </span>
        <CountdownRing
          progress={progress}
          remaining={state.remainingSeconds}
          critical={isCritical}
          size={32}
        />
      </div>
      <div
        style={{
          fontSize: 11,
          color: copied ? "#2e7d32" : "#888",
          marginTop: 6,
        }}
      >
        {copied ? "已复制到剪贴板（10 秒后自动清空）" : "点击数字复制；倒计时归零后自动刷新"}
      </div>
    </div>
  );
}

function formatTotpCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

function CountdownRing(props: {
  progress: number;
  remaining: number;
  critical: boolean;
  size: number;
}): React.ReactElement {
  const { progress, remaining, critical, size } = props;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - progress);
  const color = critical ? "#d32f2f" : "#1a73e8";
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e0e0e0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.max(9, Math.floor(size / 3)),
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {remaining}
      </span>
    </div>
  );
}
