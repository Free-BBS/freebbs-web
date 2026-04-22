#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/data/www/free-BBS}"
ENV_FILE="${FREE_BBS_ENV_FILE:-/etc/free-bbs/free-bbs.env}"
FRONTEND_SERVICE_NAME="${FRONTEND_SERVICE_NAME:-free-bbs-frontend}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-free-bbs-backend}"
RUN_DB_MIGRATIONS="${RUN_DB_MIGRATIONS:-1}"

mkdir -p "$DEPLOY_DIR"

echo "[deploy] syncing project to $DEPLOY_DIR"
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "database/uploads" \
  "$ROOT_DIR"/ "$DEPLOY_DIR"/

cd "$DEPLOY_DIR"

echo "[deploy] installing dependencies"
npm ci

if [[ -f "$ENV_FILE" ]]; then
  echo "[deploy] loading environment from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[deploy] missing env file: $ENV_FILE" >&2
  exit 1
fi

if [[ "$RUN_DB_MIGRATIONS" == "1" ]]; then
  bash scripts/migrate.sh
fi

echo "[deploy] restarting services"
sudo systemctl restart "$FRONTEND_SERVICE_NAME"
sudo systemctl restart "$BACKEND_SERVICE_NAME"
sudo systemctl --no-pager --full status "$FRONTEND_SERVICE_NAME"
sudo systemctl --no-pager --full status "$BACKEND_SERVICE_NAME"

echo "[deploy] done"
