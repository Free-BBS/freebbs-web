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
