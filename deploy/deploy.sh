#!/usr/bin/env bash
# 本地构建 Astro 静态站并上传到 VPS。
# 不在服务器上构建：2GB 内存跑 Astro build 会 OOM。
#
# 用法：cp deploy/.env.example deploy/.env && 填好，然后 ./deploy/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/deploy/.env"

[[ -f "$ENV_FILE" ]] || { echo "缺少 ${ENV_FILE}，先 cp deploy/.env.example deploy/.env 并填写"; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${VPS_HOST:?VPS_HOST 未设置}"
: "${VPS_USER:?VPS_USER 未设置}"
: "${VPS_SITE_DIR:?VPS_SITE_DIR 未设置}"
SSH_TARGET="${VPS_USER}@${VPS_HOST}"

echo "==> 1/4 拉取 PocketBase 数据"
cd "${ROOT}/site"
npm run fetch-data

echo "==> 2/4 构建静态站"
npm run build
[[ -d dist ]] || { echo "构建产物 dist/ 不存在，中止"; exit 1; }

echo "==> 3/4 打包"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARBALL="${ROOT}/site/dist-${STAMP}.tar.gz"
tar -czf "$TARBALL" -C dist .
echo "    $(du -h "$TARBALL" | cut -f1) -> $(basename "$TARBALL")"

echo "==> 4/4 上传并原子切换 (${SSH_TARGET})"
scp -q "$TARBALL" "${SSH_TARGET}:/tmp/"
ssh "$SSH_TARGET" VPS_SITE_DIR="$VPS_SITE_DIR" STAMP="$STAMP" 'bash -s' <<'REMOTE'
set -euo pipefail
TARGET="${VPS_SITE_DIR}"
NEW="${TARGET}.new-${STAMP}"
OLD="${TARGET}.old-${STAMP}"

mkdir -p "$(dirname "$TARGET")" "$NEW"
tar -xzf "/tmp/dist-${STAMP}.tar.gz" -C "$NEW"

# 原子切换：先把旧的挪开，再把新的挪进来，失败可手动回滚
[[ -d "$TARGET" ]] && mv "$TARGET" "$OLD"
mv "$NEW" "$TARGET"
[[ -d "$OLD" ]] && rm -rf "$OLD"
rm -f "/tmp/dist-${STAMP}.tar.gz"

echo "    已部署 ${STAMP}，文件数：$(find "$TARGET" -type f | wc -l)"
REMOTE

rm -f "$TARBALL"
echo "==> 完成。Caddy 直出静态文件，无需 reload。"
