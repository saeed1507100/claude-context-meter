#!/bin/sh
# Regenerate docs/demo-*.gif and docs/pane-*.png
set -e
cd "$(dirname "$0")"
npx -y tsx gen-bars.ts
D=$(mktemp -d); (cd "$D" && npm init -y >/dev/null && npm i playwright@1.55.0 >/dev/null)
ln -sfn "$D/node_modules" ./node_modules
node capture.mjs
rm -rf ./node_modules .frames
