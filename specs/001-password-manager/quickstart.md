# 快速开始指南

**Feature**: 密码管理应用  
**Date**: 2026/04/22

---

## 1. 开发环境准备

### 1.1 必备工具

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 20 | 后端和 Edge 插件运行环境 |
| pnpm | >= 9 | 包管理器（Monorepo） |
| Docker | >= 24 | 自托管部署 |
| Android Studio | 最新 | Android 应用开发 |
| JDK | 17+ | Android 构建 |
| Edge 浏览器 | 最新 | 插件调试 |

### 1.2 克隆与安装

```bash
# 克隆仓库
git clone <repo-url> pw-book
cd pw-book

# 安装依赖
pnpm install

# 运行数据库迁移（SQLite 会自动创建数据库文件）
pnpm --filter backend migrate:dev

# 生成 Prisma Client
pnpm --filter backend generate
```

---

## 2. 后端服务启动

### 2.1 开发模式

```bash
# 启动后端服务（带热重载）
pnpm --filter backend dev

# 服务运行在 http://localhost:3000
```

### 2.2 环境变量

创建 `apps/backend/.env`：

```env
# 数据库（SQLite 单文件，自动创建）
DATABASE_URL="file:./data/pwbook.db"

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRES_IN="7d"

# 加密（服务端仅用于传输层，不用于数据解密）
# 留空，服务端不解密用户数据

# 服务器配置
PORT=3000
NODE_ENV=development
```

### 2.3 API 测试

```bash
# 注册用户
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "masterPasswordHash": "<kdf-hash>",
    "protectedKey": "<encrypted-user-key>",
    "publicKey": "<rsa-public-key>",
    "encryptedPrivateKey": "<encrypted-rsa-private-key>",
    "kdfType": "ARGON2ID",
    "kdfIterations": 3,
    "kdfMemory": 65536,
    "kdfParallelism": 4
  }'

# 登录
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "masterPasswordHash": "<kdf-hash>"
  }'
```

---

## 3. Edge 浏览器插件开发

### 3.1 构建与加载

```bash
# 开发构建（带热重载）
pnpm --filter edge-extension dev

# 生产构建
pnpm --filter edge-extension build
```

### 3.2 加载到 Edge

1. 打开 Edge，访问 `edge://extensions/`
2. 开启「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `apps/edge-extension/dist/` 目录

### 3.3 调试

| 组件 | 调试方式 |
|------|---------|
| Popup | 点击扩展图标 → 右键 → 检查 |
| Background Service Worker | `edge://extensions/` → 找到扩展 → 点击「Service Worker」 |
| Content Script | 在网页上按 F12 → 选择「内容脚本」标签 |

### 3.4 测试自动填充

1. 安装插件后，访问测试页面 `https://httpbin.org/forms/post`
2. 手动输入用户名/密码并提交
3. 验证是否弹出保存密码提示
4. 刷新页面，验证是否自动填充

---

## 4. Android 应用开发

### 4.1 项目结构

```
apps/android/
├── app/                    # 主应用模块
│   ├── src/main/
│   │   ├── java/com/pwbook/
│   │   │   ├── data/       # Repository、DAO
│   │   │   ├── domain/     # UseCase、Model
│   │   │   ├── ui/         # Compose UI、ViewModel
│   │   │   ├── service/    # AutofillService
│   │   │   └── crypto/     # 加密实现
│   │   └── res/            # 资源文件
│   └── build.gradle.kts
├── core/                   # 共享核心模块（加密、网络）
└── build.gradle.kts
```

### 4.2 构建与运行

```bash
# 进入 Android 项目
cd apps/android

# 调试构建
./gradlew :app:assembleDebug

# 安装到连接的设备
./gradlew :app:installDebug

# 运行测试
./gradlew :app:test
```

### 4.3 配置自动填充服务

1. 在 Android 设置中搜索「自动填充服务」
2. 选择「Password Book」
3. 在任意登录页面长按输入框，选择自动填充

### 4.4 配置生物识别

1. 首次解锁后，进入设置 → 安全
2. 开启「使用生物识别快捷解锁」
3. 验证指纹/面部识别

---

## 5. 端到端测试

### 5.1 多设备同步测试

```bash
# 1. 启动后端
pnpm --filter backend dev

# 2. 在 Edge 插件中注册账户并保存密码
# 3. 在 Android 应用中登录同一账户
# 4. 验证密码在 30 秒内同步到 Android

# 5. 在 Android 中修改密码
# 6. 在 Edge 插件中验证更新
```

### 5.2 离线模式测试

```bash
# 1. 在两设备上登录并同步数据
# 2. 断开 Android 设备的网络
# 3. 在 Android 上添加/编辑密码
# 4. 恢复网络，验证数据自动同步到云端和 Edge
```

### 5.3 恢复密钥测试

```bash
# 1. 注册新账户，保存恢复密钥
# 2. 退出登录
# 3. 尝试用错误主密码登录（应失败）
# 4. 使用恢复密钥重置主密码
# 5. 用新主密码登录，验证数据可访问
```

---

## 6. 自托管部署

### 6.1 Docker Compose 一键部署

```bash
# 克隆仓库
git clone <repo-url> pw-book
cd pw-book

# 复制环境配置
cp .env.example .env
# 编辑 .env，修改 JWT_SECRET

# 启动服务
docker-compose up -d

# 服务地址：
# - API: http://localhost:3000
```

### 6.2 docker-compose.yml 示例

```yaml
version: '3.8'
services:
  api:
    build: ./apps/backend
    environment:
      DATABASE_URL: file:/data/pwbook.db
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
```

---

## 7. 常见问题

### Q: Edge 插件的 Service Worker 频繁终止，如何保持登录状态？

A: MV3 限制下，Service Worker 会在空闲时终止。解决方案：
1. 将解密后的 User Key 存储在 `chrome.storage.session`（Service Worker 存活期间可用）
2. Service Worker 重启后，要求用户重新输入主密码解锁
3. 使用 Offscreen Document 维持持久化上下文（Chrome 108+ 支持）

### Q: Android 自动填充服务在哪些应用中可用？

A: Android 自动填充服务在以下场景工作：
- 系统浏览器（Chrome、Edge）
- 原生应用中的标准输入框
- 部分 WebView 应用
限制：某些银行应用会禁用自动填充服务。

### Q: 如何测试 Passkey 功能？

A: 使用测试站点：
- `https://webauthn.io/` — 在线 WebAuthn 测试（支持注册/登录流程）
- `https://demo.yubico.com/webauthn-technical/` — Yubico 技术演示

**测试步骤**：
1. 确保保险库中已存在目标站点的 LOGIN 凭据（用户名/密码）
2. 在站点上选择注册 Passkey，验证是否弹出「保存通行密钥」弹窗，提供「保存到现有凭据」或「新建」选项
3. 完成注册后，在保险库编辑页查看该凭据，应显示 Passkey 的添加时间和 RP 信息
4. 退出登录后再次访问站点，选择 Passkey 登录，验证是否能正确完成认证
5. 若为同一站点保存了多个 Passkey，验证登录时是否弹出选择列表

### Q: 服务端是否存储任何明文数据？

A: 否。服务端仅存储：
- 用户账户元数据（邮箱、KDF 参数）
- 加密的保险库数据（无法解密）
- 同步记录（设备信息、时间戳）
所有敏感数据均在客户端加密后上传。
