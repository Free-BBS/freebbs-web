#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[ci] installing dependencies"
npm ci

echo "[ci] syntax check"
node --check server.js
node --check backend/server.js
node --check public/app.js
node --check public/auth.js

echo "[ci] validating required files"
test -f public/index.html
test -f public/world.html
test -f public/discussion.html
test -f backend/server.js

echo "[ci] checking database scripts for destructive statements"
bash scripts/assert-safe-sql.sh

echo "[ci] done"
