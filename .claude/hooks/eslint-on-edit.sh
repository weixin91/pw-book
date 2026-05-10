#!/usr/bin/env bash
# Claude Code PostToolUse hook：编辑 .ts/.tsx/.js/.mjs 后自动跑 eslint --fix
# exit 0 = 静默通过；exit 2 = 把 stderr 反馈给 Claude

# 从 stdin 读 hook payload，用 node 解析（jq 在 Windows Git Bash 上未必装）
file=$(node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  process.stdout.write(j.tool_response?.filePath || j.tool_input?.file_path || '');
")

# 空路径或非 JS/TS 文件直接跳过
[ -z "$file" ] && exit 0
case "$file" in
  *.ts|*.tsx|*.js|*.mjs) ;;
  *) exit 0 ;;
esac

# 跑 ESLint --fix，捕获输出
output=$(pnpm exec eslint --fix "$file" 2>&1)
exit_code=$?

# eslint 退出码：0 = 没错误（warning 也算 0）；非 0 = 有 error
[ "$exit_code" -eq 0 ] && exit 0

# 有 error：写到 stderr，exit 2 喂给 Claude
printf '%s\n' "$output" >&2
exit 2
