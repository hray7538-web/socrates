#!/bin/bash
# 마을 서버(앞문 캐디 뒤)에서 소크라테스를 켜고 끈다. 열쇠는 ~/금고 에서 읽고, 값은 찍지 않는다.
# 쓰는 법: scripts/마을.sh start | stop | restart | status | logs
#   금고: socrates_anthropic_api_key (꼭), socrates_admin_password (원장님 화면. 없으면 원장님 화면이 닫힌다)
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${SOCRATES_DATA:-$HOME/socrates-data}"
VAULT="${SOCRATES_VAULT:-$HOME/금고}"
PIDFILE="$DATA/server.pid"
LOG="$DATA/server.log"
mkdir -p "$DATA"

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

start() {
  if running; then echo "이미 돈다 (pid $(cat "$PIDFILE"))"; return 0; fi
  [ -s "$VAULT/socrates_anthropic_api_key" ] || { echo "금고에 socrates_anthropic_api_key 가 없다" >&2; exit 1; }
  cd "$HERE"
  ANTHROPIC_API_KEY="$(cat "$VAULT/socrates_anthropic_api_key")" \
  SOCRATES_ADMIN_PASSWORD="$(cat "$VAULT/socrates_admin_password" 2>/dev/null)" \
  PORT="${PORT:-7970}" HOST=127.0.0.1 SOCRATES_TRUST_PROXY=1 SOCRATES_DATA="$DATA" \
  SOCRATES_DAILY_PER_PERSON="${SOCRATES_DAILY_PER_PERSON:-100}" \
  SOCRATES_DAILY_TOTAL="${SOCRATES_DAILY_TOTAL:-500}" \
  nohup node server.mjs >> "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 1
  if running; then echo "켰다 (pid $(cat "$PIDFILE"))"; else echo "켜지 못했다. $LOG 를 보라" >&2; tail -5 "$LOG"; exit 1; fi
}

stop() {
  if running; then kill "$(cat "$PIDFILE")"; rm -f "$PIDFILE"; echo "껐다"; else echo "돌지 않는다"; fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) if running; then echo "돈다 (pid $(cat "$PIDFILE"))"; else echo "멈춰 있다"; fi ;;
  logs) tail -n 50 "$LOG" ;;
  *) echo "쓰는 법: $0 start|stop|restart|status|logs" ;;
esac
