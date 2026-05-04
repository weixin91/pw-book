# pw-book

自托管端到端加密密码管理器。支持 Edge 浏览器插件与 Android 应用，数据双向同步互通。

> 本项目由 AI 辅助生成代码，包含人工审查与调整。

## 特性

- **端到端加密**：所有密码数据在客户端加密后存储，服务端无法读取
- **自托管部署**：Docker 一键部署，数据完全自主掌控
- **跨平台同步**：Edge 插件与 Android App 数据实时双向同步
- **Passkey 支持**：Android 端支持作为 Passkey 凭证提供程序，也可供第三方 App 调用
- **账户恢复**：统一的恢复码机制，支持 Edge/Android 端账户恢复

## 技术栈

| 模块 | 技术 |
|------|------|
| 后端 | TypeScript 5.8、Fastify、Prisma、SQLite、WebSocket |
| Edge 插件 | TypeScript 5.8、React 18、Vite、WebExtension API |
| Android | Kotlin 2.1、Passkey Credential Provider |
| 共享层 | `@pwbook/shared-types` |

## 项目结构

```
pw-book/
├── apps/
│   ├── backend/          # Fastify 后端 API
│   ├── edge-extension/   # Edge 浏览器插件
│   └── android/          # Android App (Kotlin)
├── packages/
│   └── shared-types/     # 跨应用共享类型
├── specs/
│   └── 001-password-manager/  # 需求规格与设计文档
├── docker-compose.yml    # Docker 部署配置
└── pnpm-workspace.yaml   # Monorepo 工作区配置
```

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker（可选，用于容器化部署）

### 安装依赖

```bash
pnpm install
```

### 开发模式

启动后端服务：

```bash
pnpm dev:backend
```

启动 Edge 插件（开发模式）：

```bash
pnpm dev:edge
```

### 构建

```bash
pnpm build
```

### 测试

```bash
pnpm test
```

### 代码检查

```bash
pnpm lint
pnpm format
```

## 部署

### Docker Compose 部署（推荐）

1. 复制环境变量模板并修改：

```bash
cp .env.example .env
# 编辑 .env，设置 JWT_SECRET 等关键配置
```

2. 启动服务：

```bash
docker compose up -d
```

服务将在 `http://localhost:3000` 运行，数据库文件挂载到 `./data/pwbook.db`。

### Docker 镜像手动构建

如需自行构建镜像（例如修改代码后重新打包）：

```bash
# 从项目根目录构建后端镜像
docker build -f apps/backend/Dockerfile -t pwbook-backend:latest .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -e JWT_SECRET="your-secret-key" \
  -e DATABASE_URL="file:/data/pwbook.db" \
  -e ALLOWED_EMAILS="user1@example.com,user2@example.com" \
  -v ./data:/data \
  --name pwbook-api \
  --restart unless-stopped \
  pwbook-backend:latest
```

### 手动部署

进入 `apps/backend` 目录：

```bash
cd apps/backend
cp .env.example .env
# 配置环境变量
pnpm install
pnpm migrate:deploy
pnpm build
pnpm start
```

## 数据备份

后端使用 SQLite 单文件数据库（`./data/pwbook.db`），**目前无内置自动备份功能**，请自行做好备份。

### 备份数据库文件

SQLite 数据库可直接复制文件备份。建议先暂停写入以确保一致性：

```bash
# 方式一：直接复制（简单场景）
cp ./data/pwbook.db ./data/pwbook.db.backup.$(date +%Y%m%d)

# 方式二：使用 sqlite3 在线热备份（推荐）
sqlite3 ./data/pwbook.db ".backup ./data/pwbook.db.backup.$(date +%Y%m%d)"
```

### Docker 部署下的备份

```bash
# 从运行中的容器导出数据库
docker exec pwbook-api sh -c "sqlite3 /data/pwbook.db '.backup /data/pwbook.db.backup'"
docker cp pwbook-api:/data/pwbook.db.backup ./pwbook.db.backup
```

### 定时自动备份（cron 示例）

每天凌晨 3 点自动备份并保留最近 7 份：

```bash
0 3 * * * sqlite3 /data/pwbook.db ".backup /data/backups/pwbook_$(date +\%Y\%m\%d).db" && find /data/backups -name "pwbook_*.db" -mtime +7 -delete
```

**重要提示**：密码数据采用端到端加密，服务端数据库仅存储加密后的密文。备份文件同样安全，但务必妥善保管主密码和恢复码，丢失后将无法解密任何数据。

## 规格文档

详细的设计规格位于 [`specs/001-password-manager/`](specs/001-password-manager/) 目录：

- [`spec.md`](specs/001-password-manager/spec.md) — 功能规格
- [`plan.md`](specs/001-password-manager/plan.md) — 开发计划
- [`contracts/api.md`](specs/001-password-manager/contracts/api.md) — API 契约
- [`contracts/crypto.md`](specs/001-password-manager/contracts/crypto.md) — 加密协议
- [`contracts/sync-protocol.md`](specs/001-password-manager/contracts/sync-protocol.md) — 同步协议
- [`quickstart.md`](specs/001-password-manager/quickstart.md) — 快速上手指南

## 许可证

私有项目
