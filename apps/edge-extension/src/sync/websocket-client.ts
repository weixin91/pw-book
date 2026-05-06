// WebSocket 客户端及轮询降级
// 使用首条消息认证，避免 Token 在 URL 中暴露

import { StorageService } from "../platform/storage.js";

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseDelay = 1000;
  private onSyncRequiredCallback: (() => void) | null = null;
  private onDeviceLogoutCallback: (() => void) | null = null;
  private authenticated = false;

  constructor(
    private onSyncRequired?: () => void,
    private onDeviceLogout?: () => void
  ) {
    this.onSyncRequiredCallback = onSyncRequired || null;
    this.onDeviceLogoutCallback = onDeviceLogout || null;
  }

  async connect(): Promise<void> {
    const profile = await StorageService.getProfile();
    if (!profile?.token) return;

    const baseUrl = await StorageService.getServerUrl();
    // 不在 URL 中传递 token，改为首条消息认证
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";

    try {
      this.ws = new WebSocket(wsUrl);
      this.authenticated = false;

      this.ws.onopen = () => {
        // 连接成功后发送认证消息
        this.ws?.send(JSON.stringify({ type: "AUTH", token: profile.token }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // 处理认证响应
          if (msg.type === "AUTH_SUCCESS") {
            this.authenticated = true;
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            return;
          }

          if (msg.type === "AUTH_FAILED" || msg.type === "AUTH_REQUIRED") {
            // 认证失败，重新连接
            this.disconnect();
            this.scheduleReconnect();
            return;
          }

          // 认证成功后处理业务消息
          if (this.authenticated) {
            if (msg.type === "PONG") {
              if (this.pongTimeoutTimer) {
                clearTimeout(this.pongTimeoutTimer);
                this.pongTimeoutTimer = null;
              }
              return;
            }
            if (msg.type === "SYNC_REQUIRED") {
              this.onSyncRequiredCallback?.();
            } else if (msg.type === "DEVICE_LOGOUT") {
              this.onDeviceLogoutCallback?.();
            }
          }
        } catch {
          // ignore invalid messages
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.authenticated = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.authenticated = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // 降级为轮询
      return;
    }
    const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pongTimeoutMs = 10000;

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
        this.ws.send(JSON.stringify({ type: "PING" }));
        // 启动 PONG 超时检测：10 秒内未收到 PONG 视为连接失效
        this.pongTimeoutTimer = setTimeout(() => {
          console.log("[WS] PONG 超时，关闭连接并触发重连");
          this.ws?.close();
        }, this.pongTimeoutMs);
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }
}
