#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

load_env_file() {
  local env_file="$1"

  if [[ -f "$env_file" ]]; then
    echo "[start] loading environment: $env_file"
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
    return 0
  fi

  return 1
}

if ! load_env_file "$ROOT_DIR/backend/.env"; then
  load_env_file "$ROOT_DIR/envs.sh" || true
fi

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3000}"
export API_HOST="${API_HOST:-127.0.0.1}"
export API_PORT="${API_PORT:-3001}"
export BACKEND_IP="${BACKEND_IP:-127.0.0.1}"
export MYSQL_PORT="${MYSQL_PORT:-3306}"
export MYSQL_USER="${MYSQL_USER:-root}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
export MYSQL_DATABASE="${MYSQL_DATABASE:-free_bbs}"
export AUTH_SECRET="${AUTH_SECRET:-free-bbs-dev-secret}"
export UPLOAD_DIR="${UPLOAD_DIR:-$ROOT_DIR/database/uploads}"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "[start] node_modules not found; running npm install"
  npm install
fi

mkdir -p "$UPLOAD_DIR"

FRONTEND_PID=""
BACKEND_PID=""

cleanup() {
  echo
  echo "[start] stopping services"

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  wait "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "[start] frontend: http://$HOST:$PORT"
echo "[start] backend:  http://$API_HOST:$API_PORT/api/health"

npm run start:frontend &
FRONTEND_PID="$!"

npm run start:backend &
BACKEND_PID="$!"

while true; do
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    wait "$FRONTEND_PID" || true
    exit 1
  fi

  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID" || true
    exit 1
  fi

  sleep 1
done
