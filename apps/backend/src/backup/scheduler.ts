import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const execAsync = promisify(exec);

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) throw new Error("BACKUP: DATABASE_URL 必须是 file: 协议");
  return url.slice(5);
}

async function backup(app: FastifyInstance) {
  const db = resolveDbPath();
  const dir = process.env.BACKUP_DIR ?? "./backups";
  const keepDays = parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7", 10);
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const out = join(dir, `pwbook_${ts}.db`);

  await mkdir(dir, { recursive: true });
  await execAsync(`sqlite3 "${db}" ".backup '${out}'"`);
  app.log.info(`[backup] 已备份: ${out}`);

  const cutoff = Date.now() - keepDays * 86400000;
  for (const f of await readdir(dir)) {
    if (!f.startsWith("pwbook_") || !f.endsWith(".db")) continue;
    const s = await stat(join(dir, f));
    if (s.mtimeMs < cutoff) {
      await unlink(join(dir, f));
      app.log.info(`[backup] 已删除过期备份: ${f}`);
    }
  }
}

function nextDelayMs(hour: number): number {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.getTime() - now.getTime();
}

export function startBackupScheduler(app: FastifyInstance) {
  if (process.env.BACKUP_ENABLED !== "true") {
    app.log.info("[backup] 自动备份未启用");
    return;
  }
  const hour = parseInt(process.env.BACKUP_HOUR ?? "3", 10);
  const delay = nextDelayMs(hour);
  app.log.info(
    `[backup] 已启用，每天 ${String(hour).padStart(2, "0")}:00 备份，首次在 ${(delay / 3600000).toFixed(1)} 小时后`
  );
  setTimeout(() => {
    backup(app).catch((err) => app.log.error(err));
    setInterval(() => backup(app).catch((err) => app.log.error(err)), 86400000);
  }, delay);
}
