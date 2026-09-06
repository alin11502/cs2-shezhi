#!/usr/bin/env bash
# 构建产物静态断言的入口。
#
# 为什么是 bash 包一层：package.json 与 deploy 流程里约定的是 `npm run check-dist`
# → `bash scripts/check-dist.sh`，而实际的断言逻辑用 node 写更合适（要解析 HTML、
# 正则提取 title / JSON-LD / 内链，bash 做这些既脆弱又难维护）。
#
# 这里只负责把 node 加进 PATH 并转发退出码。
set -euo pipefail

SITE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${SITE_ROOT}/.." && pwd)"

# 本机的 node 是绿色解压在 .tools/node/，不在系统 PATH 上。
# ROOT 由 pwd 得来，在 Git Bash 下是 Unix 风格（/d/...），可直接拼进 PATH；
# 用 Windows 风格的 D:/... 则不生效。
if [[ -d "${ROOT}/.tools/node" ]]; then
  export PATH="${ROOT}/.tools/node:${PATH}"
fi

command -v node >/dev/null 2>&1 || {
  echo "找不到 node。请把 Node 解压到 ${ROOT}/.tools/node/，或自行确保 node 在 PATH 上" >&2
  exit 127
}

[[ -d "${SITE_ROOT}/dist" ]] || {
  echo "dist/ 不存在，请先运行: npm run build" >&2
  exit 2
}

exec node "${SITE_ROOT}/scripts/check-dist.mjs" "$@"
