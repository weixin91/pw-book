---
name: pwbook-start-backend
description: 启动 pw-book 后端开发服务（apps/backend）
user-invocable: true
---

# 启动 Backend 开发服务

启动 pw-book 后端开发服务，自动处理环境检查和数据库初始化。

## 启动流程

1. **环境检查**
   - 检查 `.env` 文件是否存在
   - 检查 `JWT_SECRET` 是否配置且长度 ≥ 32 字符

2. **数据库初始化（如需要）**
   - 检查 `data/pwbook.db` 是否存在
   - 如不存在，执行 `pnpm migrate:dev` 创建数据库并应用迁移

3. **启动服务**
   ```bash
   cd apps/backend && pnpm dev
   ```

## 行为

- 服务运行在 `tsx watch` 模式，代码修改自动热重载
- 默认监听 `http://localhost:3000`
- 启动后汇报服务状态和监听地址
- 如果启动失败，输出错误信息并协助排查

## 依赖

- 需先执行 `pnpm install` 安装依赖
- 需 `.env` 文件配置 `DATABASE_URL` 和 `JWT_SECRET`
