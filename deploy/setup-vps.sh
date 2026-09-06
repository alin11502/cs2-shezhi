#!/usr/bin/env bash
# 在 VPS 上跑的一次性初始化脚本（Debian/Ubuntu 系）。
#
#   sudo bash deploy/setup-vps.sh
#
# 做四件事：建目录与 pocketbase 用户、下载并校验 PocketBase、装 systemd unit、
# 装 Caddy 并放好 Caddyfile。站点静态产物由本机 deploy.sh 上传，不在这里做。
#
# 幂等：重复跑不会破坏已有数据（已存在的文件/用户跳过）。
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "请用 root 或 sudo 运行" >&2; exit 1; }

APP_DIR=/opt/cs2-shezhi
SITE_DIR=/var/www/cs2-shezhi/site
BACKUP_DIR=/var/backups/cs2-shezhi
PB_VERSION=0.40.2
# 与 .tools/checksums.txt 中 pocketbase_0.40.2_linux_amd64.zip 一致
PB_SHA256=dd86b424a07f2bb5ac2b8ba8cdf013a37400a9cf56bd1f92e560981f7dd24244
PB_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 1/4 目录与用户"
mkdir -p "$APP_DIR/server/pb_data" "$APP_DIR/server/pb_hooks" "$APP_DIR/server/pb_migrations" \
         "$APP_DIR/deploy" "$SITE_DIR" "$BACKUP_DIR" /var/log/caddy
if ! id pocketbase >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR/server" --shell /usr/sbin/nologin pocketbase
  echo "    已创建 pocketbase 用户"
else
  echo "    pocketbase 用户已存在，跳过"
fi

echo "==> 2/4 同步代码目录（server/ 与 deploy/）"
# 本机 deploy.sh 会把 server/ 与 deploy/ rsync/scp 上来；这里只确保结构存在。
# 若你是第一次部署，先在本机跑 deploy/deploy.sh 上传代码与静态产物。
cp -f "$SCRIPT_DIR/pocketbase.service" "$APP_DIR/deploy/pocketbase.service"
cp -f "$SCRIPT_DIR/backup.sh" "$APP_DIR/deploy/backup.sh"
cp -f "$SCRIPT_DIR/Caddyfile" "$APP_DIR/deploy/Caddyfile"

echo "==> 3/4 PocketBase"
if [[ -x "$APP_DIR/server/pocketbase" ]]; then
  echo "    已存在，跳过下载"
else
  TMP="$(mktemp -d)"
  curl -fsSL --retry 3 -o "$TMP/pb.zip" "$PB_URL"
  ACTUAL="$(sha256sum "$TMP/pb.zip" | cut -d' ' -f1)"
  [[ "$ACTUAL" == "$PB_SHA256" ]] || { echo "校验和不匹配: $ACTUAL" >&2; exit 1; }
  echo "    校验和通过"
  command -v unzip >/dev/null || apt-get install -y unzip
  unzip -q -o "$TMP/pb.zip" -d "$TMP/x"
  install -m 0755 "$TMP/x/pocketbase" "$APP_DIR/server/pocketbase"
  rm -rf "$TMP"
fi

# 代码目录（hooks/migrations）由本机上传后属于 root；pb_data 归 pocketbase
chown -R pocketbase:pocketbase "$APP_DIR/server/pb_data"
chmod 700 "$APP_DIR/server/pb_data"

if [[ ! -f /etc/systemd/system/pocketbase.service ]] || ! cmp -s "$APP_DIR/deploy/pocketbase.service" /etc/systemd/system/pocketbase.service; then
  cp -f "$APP_DIR/deploy/pocketbase.service" /etc/systemd/system/pocketbase.service
  systemctl daemon-reload
  echo "    systemd unit 已更新"
fi
systemctl enable pocketbase >/dev/null 2>&1 || true

echo "==> 4/4 Caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi
install -d -o caddy -g caddy /var/log/caddy
if [[ ! -f /etc/caddy/Caddyfile ]] || ! cmp -s "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile; then
  cp -f "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
  echo "    Caddyfile 已更新"
fi

# Caddyfile 里的 {$SITE_DOMAIN} / {$ACME_EMAIL} 取自 caddy 进程的环境变量。
# 不依赖发行版 unit 是否带 EnvironmentFile，直接写 systemd drop-in 最稳。
DOMAIN="${DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
if [[ -n "$DOMAIN" ]]; then
  install -d -m 755 /etc/systemd/system/caddy.service.d
  cat > /etc/systemd/system/caddy.service.d/10-site.conf <<EOF
[Service]
Environment="SITE_DOMAIN=$DOMAIN"
Environment="ACME_EMAIL=${ACME_EMAIL:-admin@example.com}"
EOF
  systemctl daemon-reload
  echo "    已注入 SITE_DOMAIN=$DOMAIN（ACME_EMAIL=${ACME_EMAIL:-admin@example.com}）"
else
  echo "    ! 未提供 DOMAIN 环境变量，Caddy 将退回示例域名 example.com（证书申请会失败）。"
  echo "      用法：sudo DOMAIN=你的域名 ACME_EMAIL=你的邮箱 bash deploy/setup-vps.sh"
fi
systemctl enable caddy >/dev/null 2>&1 || true

cat <<'NEXT'

初始化完成。接下来：
  1. 本机跑 deploy/deploy.sh 上传静态产物与 server/ 代码
     （构建前设 SITE_URL=https://你的域名，否则不输出 sitemap/canonical）
  2. VPS 上: systemctl restart pocketbase && systemctl reload caddy
  3. 确认域名 DNS 的 A/AAAA 记录已指向本机的公网 IP，否则 Let's Encrypt 证书申请会失败
  4. 首次访问 https://<你的域名>/_/ 创建 PocketBase 超级用户
  5. 备份 cron: 0 4 * * * /opt/cs2-shezhi/deploy/backup.sh >> /var/log/cs2-backup.log 2>&1
NEXT
