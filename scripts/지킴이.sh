#!/bin/bash
# 마을 cron 이 1분마다 부른다. 소크라테스가 대답하지 않으면 다시 켠다.
# 일부러 꺼 둘 때: touch ~/socrates-data/off   (다시 지킬 때: rm ~/socrates-data/off)
DATA="${SOCRATES_DATA:-$HOME/socrates-data}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$DATA/off" ] && exit 0
if ! curl -fsS -m 5 "http://127.0.0.1:${PORT:-7970}/api/health" > /dev/null 2>&1; then
  echo "$(date -Is) 대답 없음 → 다시 켠다" >> "$DATA/지킴이.log"
  "$HERE/scripts/마을.sh" restart >> "$DATA/지킴이.log" 2>&1
fi
