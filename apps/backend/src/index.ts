import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import dotenv from "dotenv";
import { registerErrorHandler } from "./errors/handler.js";
import { authRoutes } from "./auth/routes.js";
import { recoverRoutes } from "./auth/recover.js";
import { syncRoutes } from "./sync/routes.js";
import { cipherRoutes } from "./ciphers/routes.js";
import { deviceRoutes } from "./devices/routes.js";
import { domainAssocRoutes } from "./domain-assoc/routes.js";
import { cookieRoutes } from "./cookies/routes.js";
import { cookieConfigRoutes } from "./cookies/config-routes.js";
import { registerWebSocket } from "./websocket/server.js";
import { registrationWhitelist } from "./auth/whitelist.js";
import { startBackupScheduler } from "./backup/scheduler.js";

dotenv.config();

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "warn" : "info",
  },
});

registerErrorHandler(app);

// 安全响应头：CSP、HSTS、frameguard、noSniff、referrerPolicy
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // API 服务，限制严格
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    // 仅在生产环境启用 preload
    preload: process.env.NODE_ENV === "production",
  },
  frameguard: {
    action: "deny",
  },
  noSniff: true,
  referrerPolicy: {
    policy: "no-referrer",
  },
});

// CORS 白名单配置
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["chrome-extension://*", "http://localhost:*", "http://10.0.2.2:*"];

await app.register(cors, {
  origin: (origin, callback) => {
    // origin 可能是 undefined（同源请求），此时允许
    if (!origin) {
      callback(null, true);
      return;
    }
    // 允许 chrome-extension 协议和配置的白名单
    if (origin.startsWith("chrome-extension://") || allowedOrigins.some((o) => new RegExp(o.replace("*", ".*")).test(origin))) {
      callback(null, true);
    } else {
      callback(new Error("不允许的 CORS origin"), false);
    }
  },
  credentials: true,
});

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(recoverRoutes, { prefix: "/api/auth" });
await app.register(syncRoutes, { prefix: "/api/sync" });
await app.register(cipherRoutes, { prefix: "/api/ciphers" });
await app.register(deviceRoutes, { prefix: "/api/devices" });
await app.register(domainAssocRoutes, { prefix: "/api/domain-associations" });
await app.register(cookieRoutes, { prefix: "/api/cookies" });
await app.register(cookieConfigRoutes, { prefix: "/api/cookie-sync-config" });
registerWebSocket(app);

app.get("/health", async () => ({ status: "ok" }));

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

if (registrationWhitelist) {
  app.log.warn(`[whitelist] 注册白名单已启用: ${Array.from(registrationWhitelist).join(", ")}`);
} else {
  app.log.warn("[whitelist] 注册白名单未配置，允许所有人注册");
}

startBackupScheduler(app);

// 安全提示：生产环境应在前方部署反向代理（如 Nginx、Caddy、Traefik）以提供 HTTPS/TLS 1.3
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Server running at http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
