#!/bin/zsh
# 소크라테스 서버를 켠다. 열쇠는 ~/열쇠/열쇠.env 에서 읽고, 값은 찍지 않는다.
# 쓰는 법: ./켜기.sh            (http://127.0.0.1:7970)
#          PORT=7971 ./켜기.sh
cd "${0:A:h}"
export PATH="$HOME/.local/node/bin:$PATH"
if [[ -z "$ANTHROPIC_API_KEY" ]]; then
  ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' "$HOME/열쇠/열쇠.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"'")"
  export ANTHROPIC_API_KEY
fi
if [[ -z "$ANTHROPIC_API_KEY" ]]; then
  echo "열쇠(ANTHROPIC_API_KEY)를 찾지 못했다. ~/열쇠/열쇠.env 를 보라." >&2
  exit 1
fi
exec node server.mjs
