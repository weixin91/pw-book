---
name: pwbook-build-edge
description: 构建 pw-book Edge 扩展（apps/edge-extension）
user-invocable: true
disable-model-invocation: true
---

# 构建 Edge Extension

构建 pw-book Edge 浏览器扩展。

## 构建命令

```bash
cd apps/edge-extension && pnpm build
```

如果 pnpm 不可用，回退到：

```bash
cd apps/edge-extension && npm run build
```

## 行为

- 执行 Vite + esbuild 打包
- 输出到 `apps/edge-extension/dist/`
- 成功或失败均汇报结果
