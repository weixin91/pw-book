import { WebSocketServer, type WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { verifyToken } from "../auth/jwt.js";

interface ClientConnection {
  socket: WebSocket;
  userId: string;
  deviceId?: string;
}

const clients = new Map<string, ClientConnection[]>();
let wss: WebSocketServer | null = null;

export function registerWebSocket(app: FastifyInstance): void {
  // 在 Fastify 服务器启动后挂载原生 WebSocket 服务器
  app.addHook("onReady", async () => {
    const server = app.server;
    wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (ws, _req) => {
      // 连接建立后等待首条认证消息
      ws.send(JSON.stringify({ type: "AUTH_REQUIRED" }));

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());

          // 处理认证消息
          if (msg.type === "AUTH" && msg.token) {
            verifyToken(msg.token)
              .then((payload) => {
                const userId = payload.sub;
                const clientConn: ClientConnection = {
                  socket: ws,
                  userId,
                  deviceId: payload.deviceId,
                };

                const userClients = clients.get(userId) || [];
                userClients.push(clientConn);
                clients.set(userId, userClients);

                ws.send(JSON.stringify({ type: "AUTH_SUCCESS" }));

                // 认证成功后，替换 message handler 处理后续消息
                ws.removeAllListeners("message");
                ws.on("message", (raw: Buffer) => {
                  try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.type === "PING") {
                      ws.send(JSON.stringify({ type: "PONG" }));
                    }
                  } catch {
                    // ignore invalid messages
                  }
                });

                ws.on("close", () => {
                  const list = clients.get(userId) || [];
                  const filtered = list.filter((c) => c.socket !== ws);
                  if (filtered.length === 0) {
                    clients.delete(userId);
                  } else {
                    clients.set(userId, filtered);
                  }
                });
              })
              .catch(() => {
                ws.send(JSON.stringify({ type: "AUTH_FAILED", error: "Token 无效或已过期" }));
                ws.close(1008, "Invalid token");
              });
            return;
          }

          // 未认证的其他消息
          if (msg.type !== "AUTH") {
            ws.send(JSON.stringify({ type: "AUTH_REQUIRED" }));
          }
        } catch {
          // ignore invalid JSON
        }
      });
    });
  });
}

export function broadcastSyncRequired(userId: string, excludeDeviceId?: string): void {
  const userClients = clients.get(userId) || [];
  const message = JSON.stringify({
    type: "SYNC_REQUIRED",
    timestamp: new Date().toISOString(),
  });

  for (const client of userClients) {
    if (excludeDeviceId && client.deviceId === excludeDeviceId) continue;
    if (client.socket.readyState === 1) {
      client.socket.send(message);
    }
  }
}

export function broadcastDeviceLogout(userId: string, targetDeviceId: string): void {
  const userClients = clients.get(userId) || [];
  const message = JSON.stringify({
    type: "DEVICE_LOGOUT",
    reason: "USER_REQUESTED",
  });

  for (const client of userClients) {
    if (client.deviceId === targetDeviceId && client.socket.readyState === 1) {
      client.socket.send(message);
    }
  }
}
