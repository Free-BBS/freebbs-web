#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[ci] installing dependencies"
npm ci

echo "[ci] syntax check"
bash -n scripts/*.sh
node --check server.js
node --check backend/server.js
node --check public/app.js
node --check public/auth.js
node --check public/typography.js
node --check public/course-map.js
node --check public/knowledge.js
node --check public/markdown-editor.js

echo "[ci] course map tests"
npm run test:course-maps

echo "[ci] typography preferences tests"
npm run test:typography

echo "[ci] admin users page tests"
npm run test:admin-users

echo "[ci] discussion Markdown and LaTeX tests"
npm run test:discussion-markdown

echo "[ci] validating required files"
test -f .nvmrc
test -f public/index.html
test -f public/world.html
test -f public/course-map-editor.html
test -f public/markdown-editor.html
test -f public/discussion.html
test -f database/migrations/018_create_course_map_settings.sql
test -f database/migrations/024_add_rag_index_revision.sql
test -f backend/server.js

echo "[ci] checking database scripts for destructive statements"
bash scripts/assert-safe-sql.sh

echo "[ci] done"
