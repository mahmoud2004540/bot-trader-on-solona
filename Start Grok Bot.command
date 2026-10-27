#!/bin/bash
# macOS: double-click to start. Installs what it needs the first time, opens the dashboard,
# keeps the bot running all night (auto-restart).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Opening the download page — install the LTS version, then double-click this again."
  open "https://nodejs.org/en/download"; read -r -p "Press Enter to close"; exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "Node.js $(node -v) is too old — Grok Bot needs 22.13 or newer."; OLD=1
fi
[ -n "$OLD" ] && { open "https://nodejs.org/en/download"; read -r -p "Press Enter to close"; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund || { read -r -p "npm install failed. Press Enter"; exit 1; }
(sleep 6; open "http://127.0.0.1:8787") &
npm run night
