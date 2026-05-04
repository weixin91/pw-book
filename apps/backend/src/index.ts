import Fastify from "fastify";
import cors from "@fastify/cors";
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

dotenv.config();

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "warn" : "info",
  },
});

registerErrorHandler(app);

await app.register(cors, {
  origin: true,
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
  console.log(`[whitelist] 注册白名单已启用: ${Array.from(registrationWhitelist).join(", ")}`);
} else {
  console.log("[whitelist] 注册白名单未配置，允许所有人注册");
}

// 安全提示：生产环境应在前方部署反向代理（如 Nginx、Caddy、Traefik）以提供 HTTPS/TLS 1.3
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Server running at http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
