#!/bin/bash
# Linux: ./start.sh — installs on first run, opens the dashboard, runs all night.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Install Node.js 22+ first: https://nodejs.org"; exit 1; }
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "Node.js $(node -v) is too old — Grok Bot needs 22.13 or newer."; OLD=1
fi
[ -n "$OLD" ] && exit 1
[ -d node_modules ] || npm install --no-audit --no-fund || exit 1
(sleep 6; xdg-open "http://127.0.0.1:8787" >/dev/null 2>&1) &
exec npm run night
