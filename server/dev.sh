#!/usr/bin/env bash
# 本地开发用的 PocketBase 控制脚本。
#
# 为什么需要它：PocketBase 0.40 的 --dir / --migrationsDir / --hooksDir 默认值
# 是相对**可执行文件所在目录**解析的，不是当前工作目录。本项目把二进制放在
# .tools/pocketbase/ 而 schema 放在 server/，所以直接 `pocketbase serve` 会在
# .tools/pocketbase/ 下新建一个空的 pb_data，迁移一个都不会跑。必须显式传路径。
#
# 另外 --hooksWatch 在 Windows 上无效，改完 pb_hooks 必须 restart。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
PB_EXE="$REPO_ROOT/.tools/pocketbase/pocketbase.exe"
LOG="$SERVER_DIR/pb.log"
HTTP="${PB_HTTP:-127.0.0.1:8090}"

PB_ARGS=(
  --http="$HTTP"
  --dir="$SERVER_DIR/pb_data"
  --migrationsDir="$SERVER_DIR/pb_migrations"
  --hooksDir="$SERVER_DIR/pb_hooks"
)

is_running() {
  curl -s -o /dev/null --max-time 3 "http://$HTTP/api/health" 2>/dev/null
}

stop() {
  if is_running; then
    taskkill -F -IM pocketbase.exe >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do is_running || break; sleep 0.3; done
    echo "已停止"
  else
    echo "本来就没在运行"
  fi
}

start() {
  if is_running; then
    echo "已在运行：http://$HTTP"
    return 0
  fi
  if [[ ! -x "$PB_EXE" ]]; then
    echo "找不到 PocketBase：$PB_EXE" >&2
    echo "请先解压 .tools/pocketbase.zip（sha256 见 .tools/checksums.txt）" >&2
    exit 1
  fi
  rm -f "$LOG"
  # 后台启动，脱离当前 shell，脚本退出后进程继续存活
  ( cd "$SERVER_DIR" && "$PB_EXE" serve "${PB_ARGS[@]}" >"$LOG" 2>&1 & )
  for _ in $(seq 1 40); do
    if is_running; then
      echo "已启动：http://$HTTP"
      echo "  后台管理 http://$HTTP/_/"
      echo "  日志     $LOG"
      return 0
    fi
    sleep 0.5
  done
  echo "启动超时，日志如下：" >&2
  cat "$LOG" >&2
  exit 1
}

status() {
  if is_running; then
    echo "运行中：http://$HTTP"
    curl -s --max-time 5 "http://$HTTP/api/health" && echo
  else
    echo "未运行"
    [[ -f "$LOG" ]] && { echo "--- 最近日志 ---"; tail -20 "$LOG"; }
  fi
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  log)     tail -f "$LOG" ;;
  *)
    cat <<USAGE
用法: $(basename "$0") <start|stop|restart|status|log>

环境变量:
  PB_HTTP   监听地址，默认 127.0.0.1:8090

改完 server/pb_hooks 下的文件后要 restart（Windows 上 hooks 不热重载）。
改完 server/pb_migrations 也要 restart，新迁移会在启动时自动应用。
USAGE
    exit 1
    ;;
esac
