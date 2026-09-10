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
node --check public/auth-challenge.js
node --check public/wien-oscillator-model.js
node --check backend/registration-guard.js
node --check public/typography.js
node --check public/course-map.js
node --check public/knowledge.js
node --check public/markdown-editor.js
node --check public/world.js
node --check backend/circuits.js
node --check backend/circuit-assistant.js
node --check backend/circuit-examples.js
node --check public/circuit-default-examples.js
node --check public/circuit-discussion.js
node --check public/circuit-engine.js
node --check public/circuit-worker.js
node --check public/circuit-renderer.js
node --check public/circuit-wiring.js
node --check public/circuit.js
node --check public/circuit-ai-actions.js
node --check public/circuit-assistant.js
node --check public/circuit-parameter-popover.js
node --check public/circuit-embeds.js
node --check public/circuit-embed.js
node --check public/discussion-previews.js
node --check backend/discussion-preview.js
node --check backend/agent-circuits.js

echo "[ci] course map tests"
npm run test:course-maps

echo "[ci] circuit engine, references and storage tests"
npm run test:circuits

echo "[ci] public page tests"
npm run test:public-pages

echo "[ci] authentication and typography preferences tests"
npm run test:auth

echo "[ci] admin users page tests"
npm run test:admin-users

echo "[ci] discussion Markdown and LaTeX tests"
npm run test:discussion-markdown

echo "[ci] Max agent and circuit context tests"
npm run test:agent-surfaces

echo "[ci] registration, notifications, username and course API tests"
npm run test:community
python3 -B backend/course-upload-client.test.py

echo "[ci] validating required files"
test -f .nvmrc
test -f public/index.html
test -f public/world.html
test -f public/course-map-editor.html
test -f public/markdown-editor.html
test -f public/discussion.html
test -f public/circuit.html
test -f public/circuit-embed.html
test -f public/circuit.css
test -f public/circuit-embed.css
test -f public/circuit-embeds.css
test -f docs/circuit-simulator.md
test -f database/migrations/028_circuit_library.sql
test -f database/migrations/029_circuit_examples.sql
test -f database/migrations/018_create_course_map_settings.sql
test -f database/migrations/024_add_rag_index_revision.sql
test -f backend/server.js
test -f backend/registration-guard.js
test -f public/auth-challenge.js
test -f public/wien-oscillator-model.js
test -f public/registration.css
test -f database/migrations/030_registration_guard.sql
test -f database/migrations/031_auth_circuit_challenges.sql

echo "[ci] checking database scripts for destructive statements"
bash scripts/assert-safe-sql.sh

echo "[ci] done"
