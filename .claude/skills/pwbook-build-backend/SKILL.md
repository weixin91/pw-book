---
name: pwbook-build-backend
description: 构建 pw-book 后端（apps/backend）
user-invocable: true
disable-model-invocation: true
---

# 构建 Backend

构建 pw-book 后端服务。

## 构建命令

```bash
cd apps/backend && pnpm build
```

如果 pnpm 不可用，回退到：

```bash
cd apps/backend && npm run build
```

## 行为

- 执行 TypeScript 编译（`tsc`）
- 编译成功后汇报结果
- 失败时停止并输出错误信息
