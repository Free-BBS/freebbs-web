#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${BACKEND_IP:?BACKEND_IP is required}"
: "${MYSQL_PORT:?MYSQL_PORT is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"

MYSQL_PWD="${MYSQL_PASSWORD:-}"
export MYSQL_PWD

if [[ -f database/schema.sql ]]; then
  echo "[deploy] applying schema.sql"
  mysql \
    --protocol=TCP \
    -h "$BACKEND_IP" \
    -P "$MYSQL_PORT" \
    -u "$MYSQL_USER" \
    "$MYSQL_DATABASE" < database/schema.sql
fi

if [[ -f database/seed.sql ]]; then
  echo "[deploy] applying seed.sql"
  mysql \
    --protocol=TCP \
    -h "$BACKEND_IP" \
    -P "$MYSQL_PORT" \
    -u "$MYSQL_USER" \
    "$MYSQL_DATABASE" < database/seed.sql
fi

echo "[deploy] database migration complete"
