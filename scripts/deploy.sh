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
NODE_VERSION_FILE="$ROOT_DIR/.nvmrc"
NODE_BINARY="${NODE_BINARY:-/usr/bin/node}"
NPM_BINARY="${NPM_BINARY:-/usr/bin/npm}"

if [[ ! -r "$NODE_VERSION_FILE" ]]; then
  echo "[deploy] missing Node.js version file: $NODE_VERSION_FILE" >&2
  exit 1
fi

REQUIRED_NODE_VERSION="$(tr -d '[:space:]' <"$NODE_VERSION_FILE")"
REQUIRED_NODE_MAJOR="${REQUIRED_NODE_VERSION%%.*}"
if [[ ! "$REQUIRED_NODE_MAJOR" =~ ^[0-9]+$ ]]; then
  echo "[deploy] .nvmrc must start with a numeric Node.js major version" >&2
  exit 1
fi

if [[ "$RUN_DB_MIGRATIONS" != "0" && "$RUN_DB_MIGRATIONS" != "1" ]]; then
  echo "[deploy] RUN_DB_MIGRATIONS must be 0 or 1" >&2
  exit 1
fi

if [[ ! -x "$NODE_BINARY" || ! -x "$NPM_BINARY" ]]; then
  echo "[deploy] Node.js and npm must be installed at $NODE_BINARY and $NPM_BINARY" >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BINARY" -p "process.versions.node.split('.')[0]")"
if ((NODE_MAJOR < REQUIRED_NODE_MAJOR)); then
  echo "[deploy] Node.js ${REQUIRED_NODE_VERSION} or newer is required; found $("$NODE_BINARY" --version)" >&2
  echo "[deploy] upgrade the app server runtime before retrying this deployment" >&2
  exit 1
fi

for service_name in "$FRONTEND_SERVICE_NAME" "$BACKEND_SERVICE_NAME"; do
  load_state="$(systemctl show "$service_name" --property=LoadState --value 2>/dev/null || true)"
  exec_start="$(systemctl show "$service_name" --property=ExecStart --value 2>/dev/null || true)"

  if [[ "$load_state" != "loaded" || "$exec_start" != *"$NODE_BINARY"* ]]; then
    echo "[deploy] $service_name must be loaded and configured to start with $NODE_BINARY" >&2
    echo "[deploy] install the repository systemd units and run systemctl daemon-reload before retrying" >&2
    exit 1
  fi
done

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
"$NPM_BINARY" ci --omit=dev

if [[ "$RUN_DB_MIGRATIONS" == "1" ]]; then
  if [[ ! -r "$ENV_FILE" ]]; then
    echo "[deploy] migration environment is not readable: $ENV_FILE" >&2
    echo "[deploy] grant the deployment user read access with mode 0640; do not use 0644" >&2
    exit 1
  fi

  echo "[deploy] loading migration environment from $ENV_FILE"
  (
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    bash scripts/migrate.sh
  )
else
  echo "[deploy] skipping database migrations; backend secrets are not loaded"
fi

echo "[deploy] restarting services"
sudo -n systemctl restart "$FRONTEND_SERVICE_NAME"
sudo -n systemctl restart "$BACKEND_SERVICE_NAME"
sudo -n systemctl status "$FRONTEND_SERVICE_NAME"
sudo -n systemctl status "$BACKEND_SERVICE_NAME"

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
