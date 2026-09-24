#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${BACKEND_IP:?BACKEND_IP is required}"
: "${MYSQL_PORT:?MYSQL_PORT is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"

NODE_BINARY="${NODE_BINARY:-node}"

require_database_identifier() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[A-Za-z0-9_]+$ ]]; then
    echo "[deploy] $name must contain only letters, numbers, and underscores" >&2
    exit 1
  fi
}

require_database_identifier MYSQL_DATABASE "$MYSQL_DATABASE"

MYSQL_PWD="${MYSQL_PASSWORD:-}"
export MYSQL_PWD

MYSQL_ARGS=(
  --protocol=TCP
  -h "$BACKEND_IP"
  -P "$MYSQL_PORT"
  -u "$MYSQL_USER"
)

MIGRATIONS_DIR="$ROOT_DIR/database/migrations"

echo "[deploy] ensuring database exists: $MYSQL_DATABASE"
mysql "${MYSQL_ARGS[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`$MYSQL_DATABASE\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
SQL

echo "[deploy] ensuring schema_migrations table exists"
mysql "${MYSQL_ARGS[@]}" "$MYSQL_DATABASE" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "[deploy] no migrations directory found, skipping"
  exit 0
fi

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "[deploy] no migration files found, skipping"
  exit 0
fi

for file in "${migration_files[@]}"; do
  version="$(basename "$file")"

  applied="$(mysql "${MYSQL_ARGS[@]}" "$MYSQL_DATABASE" --batch --skip-column-names \
    -e "SELECT 1 FROM schema_migrations WHERE version = '$version' LIMIT 1;")"

  if [[ "$applied" == "1" ]]; then
    echo "[deploy] skipping already applied migration: $version"
    continue
  fi

  echo "[deploy] applying migration: $version"
  mysql "${MYSQL_ARGS[@]}" "$MYSQL_DATABASE" < "$file"
  mysql "${MYSQL_ARGS[@]}" "$MYSQL_DATABASE" \
    -e "INSERT INTO schema_migrations (version) VALUES ('$version');"
done

echo "[deploy] database migration complete"

DEVELOPMENT_MYSQL_HOST="${DEVELOPMENT_MYSQL_HOST:-$BACKEND_IP}"
DEVELOPMENT_MYSQL_PORT="${DEVELOPMENT_MYSQL_PORT:-$MYSQL_PORT}"
DEVELOPMENT_MYSQL_USER="${DEVELOPMENT_MYSQL_USER:-$MYSQL_USER}"
DEVELOPMENT_MYSQL_PASSWORD="${DEVELOPMENT_MYSQL_PASSWORD-${MYSQL_PASSWORD:-}}"
DEVELOPMENT_MYSQL_DATABASE="${DEVELOPMENT_MYSQL_DATABASE:-${MYSQL_DATABASE}_development}"
DEVELOPMENT_MYSQL_SOCKET="${DEVELOPMENT_MYSQL_SOCKET:-${MYSQL_SOCKET:-}}"

require_database_identifier DEVELOPMENT_MYSQL_DATABASE "$DEVELOPMENT_MYSQL_DATABASE"

DEVELOPMENT_MYSQL_ARGS=(-u "$DEVELOPMENT_MYSQL_USER")
if [[ -n "$DEVELOPMENT_MYSQL_SOCKET" ]]; then
  DEVELOPMENT_MYSQL_ARGS+=(--socket "$DEVELOPMENT_MYSQL_SOCKET")
else
  DEVELOPMENT_MYSQL_ARGS+=(
    --protocol=TCP
    -h "$DEVELOPMENT_MYSQL_HOST"
    -P "$DEVELOPMENT_MYSQL_PORT"
  )
fi

echo "[deploy] ensuring development database exists: $DEVELOPMENT_MYSQL_DATABASE"
MYSQL_PWD="$DEVELOPMENT_MYSQL_PASSWORD" mysql "${DEVELOPMENT_MYSQL_ARGS[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`$DEVELOPMENT_MYSQL_DATABASE\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
SQL

echo "[deploy] applying development database migrations"
NODE_ENV="${NODE_ENV:-production}" \
MYSQL_HOST="$DEVELOPMENT_MYSQL_HOST" \
MYSQL_PORT="$DEVELOPMENT_MYSQL_PORT" \
MYSQL_USER="$DEVELOPMENT_MYSQL_USER" \
MYSQL_PASSWORD="$DEVELOPMENT_MYSQL_PASSWORD" \
MYSQL_DATABASE="$DEVELOPMENT_MYSQL_DATABASE" \
MYSQL_SOCKET="$DEVELOPMENT_MYSQL_SOCKET" \
  "$NODE_BINARY" development/apps/api/dist/core/database/migrate.js

echo "[deploy] development database migration complete"
