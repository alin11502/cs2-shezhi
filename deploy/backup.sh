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

# pb_hooks 与 pb_migrations 也一起备份，否则恢复出来的库缺自定义逻辑。
# 注意：两个目录都必须存在。早先只检查 pb_hooks 就把两个一起 tar，
# 并用 2>/dev/null || true 吞掉错误 —— pb_migrations 缺失时 tar 非零退出，
# 归档一个字节都不生成却报告"备份完成"，属于静默失败。
SERVER_DIR="$(dirname "$PB_DATA")"
for d in pb_hooks pb_migrations; do
  [[ -d "${SERVER_DIR}/${d}" ]] || { echo "错误：找不到 ${SERVER_DIR}/${d}" >&2; exit 1; }
done
tar -czf "${BACKUP_DIR}/hooks-${STAMP}.tar.gz" -C "$SERVER_DIR" pb_hooks pb_migrations

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
#   # 必须删掉旧 WAL/SHM：只覆盖 data.db 而留下它们，重启时 SQLite
#   # 会把旧 WAL 回放到新库上，可能直接损坏数据库
#   rm -f /opt/cs2-shezhi/server/pb_data/data.db-wal /opt/cs2-shezhi/server/pb_data/data.db-shm
#   systemctl start pocketbase
