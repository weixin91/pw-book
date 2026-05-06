import { WebSocketServer, type WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { verifyToken } from "../auth/jwt.js";
import { prisma } from "../db/prisma.js";

interface ClientConnection {
  socket: WebSocket;
  userId: string;
  deviceId?: string;
  securityStamp: string;
}

// 限制单帧 JSON 体，防止恶意大消息引发内存压力
const MAX_PAYLOAD_BYTES = 64 * 1024;
// 连接建立后必须在该时间窗内完成 AUTH，否则强制关闭
const AUTH_TIMEOUT_MS = 5_000;
// 周期性重校验 securityStamp，撤销已被注销/恢复账号的旧连接
const SECURITY_STAMP_CHECK_INTERVAL_MS = 60_000;

const clients = new Map<string, ClientConnection[]>();
let wss: WebSocketServer | null = null;
let stampCheckTimer: NodeJS.Timeout | null = null;

function removeClient(userId: string, ws: WebSocket): void {
  const list = clients.get(userId);
  if (!list) return;
  const filtered = list.filter((c) => c.socket !== ws);
  if (filtered.length === 0) {
    clients.delete(userId);
  } else {
    clients.set(userId, filtered);
  }
}

async function reverifyAllSecurityStamps(): Promise<void> {
  if (clients.size === 0) return;
  const userIds = Array.from(clients.keys());
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, securityStamp: true },
  });
  const stampMap = new Map(rows.map((r) => [r.id, r.securityStamp]));
  for (const userId of userIds) {
    const currentStamp = stampMap.get(userId);
    const list = clients.get(userId);
    if (!list) continue;
    if (!currentStamp) {
      // 用户已不存在，全部踢下线
      for (const c of list) {
        try {
          c.socket.close(1008, "User no longer exists");
        } catch {
          /* ignore */
        }
      }
      clients.delete(userId);
      continue;
    }
    for (const c of list) {
      if (c.securityStamp !== currentStamp) {
        try {
          c.socket.send(JSON.stringify({ type: "AUTH_FAILED", error: "securityStamp 已变更" }));
        } catch {
          /* ignore */
        }
        try {
          c.socket.close(1008, "securityStamp changed");
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export function registerWebSocket(app: FastifyInstance): void {
  // 在 Fastify 服务器启动后挂载原生 WebSocket 服务器
  app.addHook("onReady", async () => {
    const server = app.server;
    wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_PAYLOAD_BYTES });

    wss.on("connection", (ws, _req) => {
      // 连接建立后等待首条认证消息
      ws.send(JSON.stringify({ type: "AUTH_REQUIRED" }));

      // AUTH 超时定时器：超过窗口仍未认证则强制断开
      const authTimeout = setTimeout(() => {
        try {
          ws.send(JSON.stringify({ type: "AUTH_FAILED", error: "AUTH 超时" }));
        } catch {
          /* ignore */
        }
        try {
          ws.close(1008, "AUTH timeout");
        } catch {
          /* ignore */
        }
      }, AUTH_TIMEOUT_MS);

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());

          // 处理认证消息
          if (msg.type === "AUTH" && msg.token) {
            verifyToken(msg.token)
              .then(async (payload) => {
                const userId = payload.sub;

                // 同步校验 DB 中的 securityStamp，防止 token 在签发后被作废
                const user = await prisma.user.findUnique({
                  where: { id: userId },
                  select: { securityStamp: true },
                });
                if (!user || user.securityStamp !== payload.securityStamp) {
                  ws.send(JSON.stringify({ type: "AUTH_FAILED", error: "Token 无效或已过期" }));
                  ws.close(1008, "Stale securityStamp");
                  return;
                }

                clearTimeout(authTimeout);

                const clientConn: ClientConnection = {
                  socket: ws,
                  userId,
                  deviceId: payload.deviceId,
                  securityStamp: user.securityStamp,
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
                  removeClient(userId, ws);
                });
              })
              .catch(() => {
                clearTimeout(authTimeout);
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

      ws.on("close", () => {
        clearTimeout(authTimeout);
      });
    });

    // 周期性重校验所有在线用户的 securityStamp
    if (stampCheckTimer === null) {
      stampCheckTimer = setInterval(() => {
        reverifyAllSecurityStamps().catch(() => {
          /* ignore */
        });
      }, SECURITY_STAMP_CHECK_INTERVAL_MS);
    }
  });

  app.addHook("onClose", async () => {
    if (stampCheckTimer !== null) {
      clearInterval(stampCheckTimer);
      stampCheckTimer = null;
    }
    wss?.close();
    wss = null;
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
      try {
        client.socket.close(1008, "Device logout");
      } catch {
        /* ignore */
      }
    }
  }
}

/** 当用户的 securityStamp 变更（recover/全局登出）时主动踢下线所有连接 */
export function kickUser(userId: string, reason = "securityStamp changed"): void {
  const userClients = clients.get(userId);
  if (!userClients) return;
  for (const c of userClients) {
    try {
      c.socket.send(JSON.stringify({ type: "AUTH_FAILED", error: reason }));
    } catch {
      /* ignore */
    }
    try {
      c.socket.close(1008, reason);
    } catch {
      /* ignore */
    }
  }
  clients.delete(userId);
}
