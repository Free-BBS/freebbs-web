#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-/etc/free-bbs/free-bbs.env}"
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-free-bbs-backend}"
MAIN_HEALTHCHECK_URL="${MAIN_HEALTHCHECK_URL:-http://127.0.0.1:3001/api/health}"
DEVELOPMENT_READY_URL="${DEVELOPMENT_READY_URL:-http://127.0.0.1:3001/api/development/v1/ready}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-20}"
HEALTHCHECK_DELAY_SECONDS="${HEALTHCHECK_DELAY_SECONDS:-2}"
NODE_BINARY="${NODE_BINARY:-/usr/bin/node}"
SUDO_BINARY="${SUDO_BINARY:-/usr/bin/sudo}"
SYSTEMCTL_BINARY="${SYSTEMCTL_BINARY:-/usr/bin/systemctl}"
CURL_BINARY="${CURL_BINARY:-/usr/bin/curl}"

if [[ ! "$BACKEND_SERVICE_NAME" =~ ^[A-Za-z0-9@._-]+$ ]]; then
  echo "[development-migrate] invalid backend service name" >&2
  exit 1
fi

if [[ ! "$HEALTHCHECK_RETRIES" =~ ^[1-9][0-9]*$ ]] ||
  [[ ! "$HEALTHCHECK_DELAY_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "[development-migrate] health check limits must be positive integers" >&2
  exit 1
fi

for url in "$MAIN_HEALTHCHECK_URL" "$DEVELOPMENT_READY_URL"; do
  if [[ ! "$url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/ ]]; then
    echo "[development-migrate] health checks must use a loopback HTTP URL" >&2
    exit 1
  fi
done

for binary in "$NODE_BINARY" "$SUDO_BINARY" "$SYSTEMCTL_BINARY" "$CURL_BINARY"; do
  if [[ ! -x "$binary" ]]; then
    echo "[development-migrate] required binary is unavailable: $binary" >&2
    exit 1
  fi
done

if [[ ! -r "$ENV_FILE" ]]; then
  echo "[development-migrate] environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required to prove database isolation}"
DEVELOPMENT_DATABASE="${DEVELOPMENT_MYSQL_DATABASE:-${MYSQL_DATABASE}_development}"

if [[ ! "$DEVELOPMENT_DATABASE" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "[development-migrate] development database name is invalid" >&2
  exit 1
fi
if [[ "$DEVELOPMENT_DATABASE" == "$MYSQL_DATABASE" ]]; then
  echo "[development-migrate] refusing to migrate the main database" >&2
  exit 1
fi

export DEVELOPMENT_MYSQL_DATABASE="$DEVELOPMENT_DATABASE"
echo "[development-migrate] applying migrations only to $DEVELOPMENT_DATABASE"
NODE_BINARY="$NODE_BINARY" bash scripts/migrate-development.sh

if ! "$SUDO_BINARY" -n -l "$SYSTEMCTL_BINARY" restart "$BACKEND_SERVICE_NAME" >/dev/null 2>&1; then
  echo "[development-migrate] passwordless backend restart is not permitted" >&2
  exit 1
fi

echo "[development-migrate] restarting backend service"
"$SUDO_BINARY" -n "$SYSTEMCTL_BINARY" restart "$BACKEND_SERVICE_NAME"

wait_for_health() {
  local label="$1"
  local url="$2"
  local attempt
  for ((attempt = 1; attempt <= HEALTHCHECK_RETRIES; attempt++)); do
    if "$CURL_BINARY" --fail --silent --show-error "$url" >/dev/null; then
      echo "[development-migrate] $label passed"
      return 0
    fi
    if [[ "$attempt" -lt "$HEALTHCHECK_RETRIES" ]]; then
      sleep "$HEALTHCHECK_DELAY_SECONDS"
    fi
  done
  echo "[development-migrate] $label failed after $HEALTHCHECK_RETRIES attempts" >&2
  return 1
}

wait_for_health "main health check" "$MAIN_HEALTHCHECK_URL"
wait_for_health "development readiness check" "$DEVELOPMENT_READY_URL"
echo "[development-migrate] development-only migration complete"
