#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

declare -a sql_files=(
  "database/schema.sql"
  "database/seed.sql"
)

shopt -s nullglob
for migration_file in database/migrations/*.sql; do
  sql_files+=("$migration_file")
done
shopt -u nullglob

declare -a blocked_patterns=(
  '(^|[^A-Z_])DROP[[:space:]]+(DATABASE|TABLE|SCHEMA|INDEX|VIEW)\b'
  '(^|[^A-Z_])TRUNCATE\b'
  '(^|[^A-Z_])DELETE[[:space:]]+FROM\b'
  '(^|[^A-Z_])ALTER[[:space:]]+TABLE\b.*\bDROP\b'
  '(^|[^A-Z_])RENAME[[:space:]]+TABLE\b'
)

for file in "${sql_files[@]}"; do
  [[ -f "$file" ]] || continue

  upper_content="$(tr '[:lower:]' '[:upper:]' < "$file")"

  for pattern in "${blocked_patterns[@]}"; do
    if grep -Eq "$pattern" <<<"$upper_content"; then
      echo "[ci] destructive SQL detected in $file" >&2
      echo "[ci] blocked pattern: $pattern" >&2
      exit 1
    fi
  done
done

echo "[ci] database SQL safety check passed"
