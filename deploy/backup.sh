#!/usr/bin/env bash
# 在 VPS 上跑的 PocketBase 备份脚本，配合 cron 使用：
#   0 4 * * * /opt/cs2-shezhi/deploy/backup.sh >> /var/log/cs2-backup.log 2>&1
#
# 用 SQLite 的 VACUUM INTO 做在线一致性快照，不需要停服务。
set -euo pipefail

PB_DATA="${PB_DATA:-/opt/cs2-shezhi/server/pb_data}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cs2-shezhi}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# 异地备份目标，留空则只保留本机备份
OFFSITE="${OFFSITE:-}"

command -v sqlite3 >/dev/null || {
  echo "错误：需要 sqlite3。Debian/Ubuntu: apt install sqlite3" >&2
  exit 1
}

[[ -f "${PB_DATA}/data.db" ]] || { echo "错误：找不到 ${PB_DATA}/data.db" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/pb-${STAMP}.db"

# VACUUM INTO 产生的是压缩后的完整副本，可单独作为 data.db 恢复
sqlite3 "${PB_DATA}/data.db" "VACUUM INTO '${OUT}'"

# pb_hooks 与 pb_migrations 也一起备份，否则恢复出来的库缺自定义逻辑
if [[ -d "${PB_DATA}/../pb_hooks" ]]; then
  tar -czf "${BACKUP_DIR}/hooks-${STAMP}.tar.gz" \
    -C "$(dirname "$PB_DATA")" pb_hooks pb_migrations 2>/dev/null || true
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "$(date -Is) 备份完成 ${OUT} (${SIZE})"

if [[ -n "$OFFSITE" ]]; then
  rsync -az --timeout=60 "$OUT" "$OFFSITE" && echo "$(date -Is) 已同步到 ${OFFSITE}"
fi

# 清理过期备份
find "$BACKUP_DIR" -name 'pb-*.db' -mtime "+${KEEP_DAYS}" -print -delete
find "$BACKUP_DIR" -name 'hooks-*.tar.gz' -mtime "+${KEEP_DAYS}" -print -delete

# 恢复方法（写在日志里备查）：
#   systemctl stop pocketbase
#   cp /var/backups/cs2-shezhi/pb-XXXX.db /opt/cs2-shezhi/server/pb_data/data.db
#   systemctl start pocketbase
