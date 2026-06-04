# Edge 商店上架指南

## 一、提交前检查清单

- [x] manifest.json 权限声明完整（`storage`、`activeTab`、`cookies`、`webNavigation`、`alarms`、`idle`）
- [x] 图标齐全（16/32/48/128px）
- [x] `options_ui` + `open_in_tab: true`
- [x] `minimum_edge_version: "102.0"`
- [x] 无远程代码加载、无 eval/Function
- [x] 版本号 1.0.0
- [ ] 隐私政策 URL 可访问
- [ ] 商店截图准备完毕

## 二、隐私政策部署

隐私政策已托管在 GitHub Pages，地址为：
`https://weixin91.github.io/pw-book/privacy-policy`

如需自行配置（参考）：
1. 仓库 Settings → Pages（左侧菜单 "Code and automation" 分组下）
2. Build and deployment → Source 选择 "Deploy from a branch"
3. Branch 选 `master`，目录选 `/docs`，Save
4. 等待几分钟后页面生效

## 三、商店描述文案

### 简短描述（132 字符 / 限制 ~150）

```
自托管端到端加密密码管理器。支持密码与 Passkey 管理、自动填充、跨设备同步。数据完全掌握在自己手中，服务端无法解密。
```

### 详细描述（中文）

```
Password Book 是一款自托管的端到端加密密码管理器，由浏览器扩展和自建后端服务组成。

核心特性：

安全架构
· 端到端加密：所有密码、Passkey 私钥、TOTP 种子在本地使用 AES-256-GCM 加密后才上传
· 零知识设计：服务端仅存储密文，无法解密任何数据
· 主密码派生：使用 PBKDF2（60 万次迭代）或 Argon2id 从主密码派生加密密钥

常用功能
· 密码自动填充：在登录页面自动检测表单并填入凭据
· Passkey 通行密钥：劫持 WebAuthn API，支持在任意网站使用 Passkey 登录
· TOTP 动态验证码：自动识别两步验证输入框，一键填入验证码
· 密码生成器：内置可定制的强密码生成器
· 保存提示：登录成功后自动弹出保存提示
· 手动模式：支持纯手动触发，不主动扫描页面

同步与备份
· 多设备实时同步：基于 WebSocket 的增量同步，设备间变更秒级送达
· 离线编辑队列：断网期间的修改自动暂存，恢复网络后自动推送
· 冲突解决：自动 last-write-wins 策略
· Cookie 同步：支持在浏览器间同步网站登录 Cookie

其他
· Bitwarden 导入：支持导入 Bitwarden 未加密 JSON 导出文件
· 账户恢复：通过恢复密钥在忘记主密码时重置账户
· 自动锁定：可配置空闲超时自动锁定保险库
· Android 互通：与 Password Book Android App 完全数据互通

使用前提：
你需要部署自己的后端服务（Docker 一键部署），或已有 Password Book 服务器地址和账户。
```

### 英文简短描述

```
Self-hosted, end-to-end encrypted password manager with Passkey support, autofill, and cross-device sync. Your data, your server — zero-knowledge architecture.
```

## 四、截图准备

需准备至少 1 张截图（建议 3-5 张，1280×800 或 640×400 PNG）：

推荐截图内容：
1. **解锁界面** — popup 展开后输入主密码的界面
2. **凭据列表** — 保险库中已保存的密码/Passkey 列表
3. **自动填充效果** — 在登录页面弹出行内凭据选择菜单的效果
4. **设置页面** — options 页面中配置服务器、自动锁定等
5. **密码生成器** — 弹窗中的随机密码生成器

注意：截图中的敏感信息（邮箱、URL 等）请打码处理。

## 五、权限用途说明

提交时 Edge 商店会要求对每个权限说明用途，可直接使用以下内容：

| 权限 | 用途说明 |
|------|----------|
| `storage` | 本地缓存加密后的保险库数据，支持离线访问 |
| `activeTab` | 检测当前活跃标签页的登录表单，实现自动填充 |
| `cookies` | 在用户授权的设备间同步浏览器 Cookie，支持跨设备持续登录 |
| `webNavigation` | 监听页面导航完成事件，在登录跳转后弹出凭据保存提示 |
| `alarms` | 实现保险库自动锁定计时器 |
| `idle` | 检测系统锁屏状态，在系统锁屏时立即锁定保险库 |
| `<all_urls>` | 作为密码管理器，需在所有网站注入内容脚本以检测登录表单、提供自动填充和 Passkey 支持 |

## 六、提交步骤

1. 访问 [Microsoft Partner Center](https://partner.microsoft.com/zh-cn/dashboard)
2. 登录或注册 Microsoft 账号（需一次性支付约 $5 注册费，终身上架权限）
3. 进入 "Extension" → "Create new extension"
4. 上传 `dist/` 目录打包的 `.zip` 文件（直接压缩 `dist/` 内所有文件为 zip，不要包含 `dist/` 文件夹本身）
5. 填写扩展信息（名称、描述、分类选 "Productivity"）
6. 上传截图和图标
7. 填写隐私政策 URL
8. 填写权限用途说明
9. 完成内容分级问卷
10. 提交审核

审核通常在 1-3 个工作日完成。通过后在 Edge 扩展商店公开可见。
