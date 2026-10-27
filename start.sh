#!/usr/bin/env bash
# Linux or Android (Termux): bash start.sh — installs on first run, opens the dashboard, runs all night.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  if [ -n "$TERMUX_VERSION" ]; then pkg install -y nodejs-lts || exit 1
  else echo "Install Node.js 22+ first: https://nodejs.org"; exit 1; fi
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "Node.js $(node -v) is too old — Grok Bot needs 22.13 or newer."; OLD=1
fi
[ -n "$OLD" ] && exit 1
[ -d node_modules ] || npm install --no-audit --no-fund || exit 1
if [ -n "$TERMUX_VERSION" ]; then
  (sleep 8; termux-open-url "http://127.0.0.1:8787") &
else
  (sleep 6; xdg-open "http://127.0.0.1:8787" >/dev/null 2>&1) &
fi
exec npm run night
