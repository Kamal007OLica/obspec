#!/bin/bash
# Obspec Bridge launcher for macOS — double-click to start.
# Keeps running while Figma uses the plugin; close this window to stop.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Obspec needs Node.js (18 or newer). Install it from https://nodejs.org and double-click again."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi
if [ ! -f bridge/dist/cli.js ]; then
  echo "First run — building the bridge…"; npm install --silent && npm run build --silent || { read -n 1 -s -r -p "Build failed. Press any key to close."; exit 1; }
fi
echo "Obspec Bridge — leave this window open while you use the plugin in Figma."
node bridge/dist/cli.js "$@"
