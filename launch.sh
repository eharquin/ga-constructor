#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

[ -d node_modules ] || npm install

LOG=$(mktemp)
npm run dev > "$LOG" 2>&1 &
PID=$!

trap 'kill $PID 2>/dev/null; rm -f "$LOG"' INT TERM EXIT

URL=""
for _ in $(seq 1 60); do
  URL=$(grep -Eo 'https?://[^ ]+' "$LOG" | head -n1 || true)
  [ -n "$URL" ] && break
  sleep 0.5
done

if [ -n "$URL" ]; then
  echo ""
  echo "  ➜ Local: $URL"
  echo ""
else
  echo "Server did not report a URL within 30s. Full log:"
  cat "$LOG"
fi

wait $PID
