#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/data/www/free-BBS}"
ENV_FILE="${FREE_BBS_ENV_FILE:-/etc/free-bbs/free-bbs.env}"
FRONTEND_SERVICE_NAME="${FRONTEND_SERVICE_NAME:-free-bbs-frontend}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-free-bbs-backend}"
RUN_DB_MIGRATIONS="${RUN_DB_MIGRATIONS:-0}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3001/api/health}"
HEALTHCHECK_URL="${HEALTHCHECK_URL//$'\r'/}"
HEALTHCHECK_URL="${HEALTHCHECK_URL//$'\n'/}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-15}"
HEALTHCHECK_DELAY_SECONDS="${HEALTHCHECK_DELAY_SECONDS:-2}"

mkdir -p "$DEPLOY_DIR"

echo "[deploy] syncing project to $DEPLOY_DIR"
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "uploads" \
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

if [[ -n "${UPLOAD_DIR:-}" ]]; then
  echo "[deploy] ensuring upload directory exists: $UPLOAD_DIR"
  mkdir -p "$UPLOAD_DIR"
fi

if [[ "$RUN_DB_MIGRATIONS" == "1" ]]; then
  bash scripts/migrate.sh
else
  echo "[deploy] skipping database migrations"
fi

echo "[deploy] restarting services"
sudo systemctl restart "$FRONTEND_SERVICE_NAME"
sudo systemctl restart "$BACKEND_SERVICE_NAME"
sudo systemctl --no-pager --full status "$FRONTEND_SERVICE_NAME"
sudo systemctl --no-pager --full status "$BACKEND_SERVICE_NAME"

echo "[deploy] checking backend health: $HEALTHCHECK_URL"
for ((attempt = 1; attempt <= HEALTHCHECK_RETRIES; attempt++)); do
  if curl --fail --silent --show-error "$HEALTHCHECK_URL" >/dev/null; then
    echo "[deploy] backend health check passed"
    break
  fi

  if [[ "$attempt" -eq "$HEALTHCHECK_RETRIES" ]]; then
    echo "[deploy] backend health check failed after $HEALTHCHECK_RETRIES attempts" >&2
    exit 1
  fi

  echo "[deploy] backend not ready yet, retrying in ${HEALTHCHECK_DELAY_SECONDS}s (attempt ${attempt}/${HEALTHCHECK_RETRIES})"
  sleep "$HEALTHCHECK_DELAY_SECONDS"
done

echo "[deploy] done"
