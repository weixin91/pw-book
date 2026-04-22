# Implementation Plan: 密码管理应用

**Branch**: `001-password-manager` | **Date**: 2026/04/22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-password-manager/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

自托管端到端加密密码管理器，包含 Edge 浏览器插件和 Android 原生应用。核心功能包括：登录表单自动检测与填充、高强度密码生成、多端实时同步、Passkey/TOTP 支持、Cookie 同步。参考 Bitwarden 技术架构，采用零知识加密模型，服务端仅存储加密数据。

技术方案：Edge 插件使用 TypeScript + Web Extension API (MV3)；Android 应用使用 Kotlin + Jetpack Compose 原生开发；后端使用 Node.js + Fastify + SQLite 轻量自托管方案。两端共享加密协议规范，独立实现以确保原生体验。

## Technical Context

**Language/Version**: TypeScript 5.8 (Edge/Backend), Kotlin 2.1 (Android), Node.js 20+  
**Primary Dependencies**:
- **Edge 插件**: Web Extension API (Manifest V3), Vite, Web Crypto API
- **Android**: Jetpack Compose, Hilt, Room, Ktor Client, AndroidX Biometrics/Autofill/Credentials
- **Backend**: Fastify, Prisma, SQLite, `jose` (JWT), `ws` (WebSocket)  
**Storage**: SQLite (服务端), IndexedDB + chrome.storage (Edge), Room/SQLite (Android)  
**Testing**: Vitest (Edge/Backend), JUnit + Espresso (Android)  
**Target Platform**: Edge 浏览器 (Chromium), Android 10+  
**Project Type**: 浏览器扩展 + 移动应用 + 自托管后端服务  
**Performance Goals**:
- 自动填充响应时间 < 200ms
- 同步延迟 < 30 秒（正常网络条件下）
- 密码保存提示在 5 秒内弹出（95%+ 成功率）  
**Constraints**:
- 端到端加密，服务端无法解密用户数据
- 支持完全离线编辑和自动同步
- MV3 Service Worker 生命周期限制
- 剪贴板密码 10 秒后自动清空
- 自托管部署需单 Docker Compose 文件完成
- Edge 插件自动填充不得造成页面卡顿（MutationObserver 节流、元素扫描上限 500、requestIdleCallback 延迟非关键任务）
- 登录成功后页面刷新/重定向不得中断保存提示流程（background script 表单数据暂存 + webNavigation 监听）  
**Scale/Scope**: 个人使用，SQLite 单文件存储，零配置部署

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 文件仍为模板状态（`.specify/memory/constitution.md`），尚未正式定义项目约束。基于 Spec 和 Research，当前设计满足以下隐含原则：

- [x] **零知识架构**: 服务端仅存储加密数据，不掌握解密密钥
- [x] **标准算法**: 使用 Argon2id/PBKDF2 + AES-256-GCM，不自行实现加密原语
- [x] **离线优先**: 支持离线编辑，本地变更队列 + 恢复在线后自动同步
- [x] **原生体验**: Android 使用 Kotlin + Jetpack Compose，不采用跨平台框架
- [x] **自托管友好**: 后端 Node.js + Docker Compose，一键部署

## Project Structure

### Documentation (this feature)

```text
specs/001-password-manager/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── api.md
│   ├── crypto.md
│   └── sync-protocol.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
apps/
├── backend/              # 自托管同步后端
│   ├── src/
│   │   ├── auth/         # 注册、登录、恢复密钥
│   │   ├── sync/         # 同步 API、增量同步
│   │   ├── ciphers/      # 凭据 CRUD
│   │   ├── domain-assoc/ # 域名关联
│   │   ├── cookies/      # Cookie 同步（仅 Edge 端）
│   │   ├── devices/      # 设备管理
│   │   ├── websocket/    # 实时同步推送
│   │   ├── prisma/       # Schema + 迁移
│   │   └── index.ts      # Fastify 入口
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── edge-extension/       # Edge 浏览器插件
│   ├── src/
│   │   ├── background/   # Service Worker（核心业务逻辑）
│   │   ├── content/      # Content Scripts（自动填充、表单检测）
│   │   ├── popup/        # 扩展弹窗 UI
│   │   ├── options/      # 设置页面
│   │   ├── crypto/       # Web Crypto 加密实现
│   │   ├── sync/         # 同步客户端
│   │   ├── autofill/     # 自动填充引擎
│   │   ├── platform/     # 浏览器 API 抽象层
│   │   └── manifest.json
│   ├── tests/
│   └── vite.config.ts
│
└── android/              # Android 应用
    ├── app/src/main/java/com/pwbook/
    │   ├── data/         # Repository、DAO、Room Entity
    │   ├── domain/       # UseCase、Model、加密核心
    │   ├── ui/           # Compose UI、ViewModel、导航
    │   ├── service/      # AutofillService、CredentialProvider
    │   ├── crypto/       # 加密实现（与 Edge 端协议兼容）
    │   ├── sync/         # 同步客户端（离线队列）
    │   └── di/           # Hilt 模块
    ├── core/             # 可共享核心模块
    └── tests/

packages/
└── shared-types/         # 共享 TypeScript 类型（可选，用于前后端类型一致）
    └── src/
        ├── cipher.ts
        ├── sync.ts
        └── api.ts
```

**Structure Decision**: 采用 `apps/` 目录下的三端分离结构。Edge 插件和 Android 应用独立实现 UI 和平台层，通过 JSON Schema + 加密协议契约确保数据层兼容。后端提供轻量级 REST API + 可选 WebSocket。`packages/shared-types` 可选用于前后端类型复用，但加密核心保持两端独立实现以适配平台 API（Web Crypto vs Android Security）。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

当前设计无需要特别说明的复杂度违规。三端分离（Edge + Android + Backend）是功能需求（FR-005, FR-012, FR-016）所要求的，无法进一步简化。
