#!/bin/sh
# Start Mission Control on macOS or Linux: ./start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (version 18 or newer), then run this again."
  exit 1
fi
PORT="${PORT:-4000}"
( sleep 1; URL="http://localhost:$PORT"
  if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi ) &
PORT="$PORT" exec node server.js
