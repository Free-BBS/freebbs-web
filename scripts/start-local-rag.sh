#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_ROOT="${FREEBBS_AGENT_DIR:-$(cd "$WEB_ROOT/../freebbs-agent" && pwd)}"
WEB_ENV_FILE="$WEB_ROOT/backend/.env"
AGENT_ENV_FILE="$AGENT_ROOT/.env"
LOCAL_RAG_ROOT="${FREEBBS_LOCAL_RAG_ROOT:-$WEB_ROOT/database/local-rag}"
LOCAL_SOCKET="${FREEBBS_LOCAL_RAG_SOCKET:-/tmp/free-bbs-local-rag-${UID}.sock}"

if [[ ! -f "$WEB_ENV_FILE" ]]; then
  echo "[local-rag] missing Web environment: $WEB_ENV_FILE" >&2
  exit 1
fi
if [[ ! -f "$AGENT_ENV_FILE" ]]; then
  echo "[local-rag] missing Agent environment: $AGENT_ENV_FILE" >&2
  exit 1
fi
if [[ ! -x "$AGENT_ROOT/.venv/bin/python" ]]; then
  echo "[local-rag] missing Agent virtualenv: $AGENT_ROOT/.venv/bin/python" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$WEB_ENV_FILE"
set +a

LOCAL_TOKEN="$(openssl rand -hex 32)"
LOCAL_SETTINGS_KEY="$(openssl rand -base64 32)"
mkdir -p "$LOCAL_RAG_ROOT"

export AGENT_SERVICE_TOKEN="$LOCAL_TOKEN"
export AGENT_SETTINGS_SOCKET="$LOCAL_SOCKET"
export SETTINGS_ENCRYPTION_KEY="$LOCAL_SETTINGS_KEY"
export COURSE_MATERIALS_ROOT="$LOCAL_RAG_ROOT"
export COURSE_MATERIALS_ALLOWED_ROOT="$LOCAL_RAG_ROOT"
export FREEBBS_SKIP_LOCAL_ENV=1

if [[ "${RUN_LOCAL_DB_MIGRATIONS:-1}" == "1" ]]; then
  echo "[local-rag] applying local database migrations"
  bash "$WEB_ROOT/scripts/migrate.sh"
fi

WEB_PID=""
AGENT_PID=""
SYNC_PID=""

cleanup() {
  echo
  echo "[local-rag] stopping local services"
  for process_id in "$SYNC_PID" "$AGENT_PID" "$WEB_PID"; do
    if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
      kill "$process_id" 2>/dev/null || true
    fi
  done
  wait "$SYNC_PID" "$AGENT_PID" "$WEB_PID" 2>/dev/null || true
  if [[ -S "$LOCAL_SOCKET" ]]; then
    rm -f "$LOCAL_SOCKET"
  fi
}
trap cleanup EXIT INT TERM

echo "[local-rag] starting Web frontend and backend"
bash "$WEB_ROOT/scripts/start-local.sh" &
WEB_PID="$!"

echo "[local-rag] starting Agent"
(
  cd "$AGENT_ROOT"
  set -a
  # shellcheck disable=SC1090
  . "$AGENT_ENV_FILE"
  set +a
  unset AGENT_SETTINGS_SOCKET AGENT_SERVICE_TOKEN
  export COURSE_MATERIALS_ROOT="$LOCAL_RAG_ROOT"
  export RAG_COURSE_SNAPSHOT_SOCKET="$LOCAL_SOCKET"
  export RAG_COURSE_SNAPSHOT_TOKEN="$LOCAL_TOKEN"
  export RAG_INDEX_MANIFEST_PATH="data/rag/current.json"
  export FREEBBS_WEB_BASE_URL="http://127.0.0.1:3000"
  exec .venv/bin/python app.py
) &
AGENT_PID="$!"

for attempt in $(seq 1 50); do
  if [[ -S "$LOCAL_SOCKET" ]]; then
    break
  fi
  if [[ "$attempt" -eq 50 ]]; then
    echo "[local-rag] Web internal socket did not become ready: $LOCAL_SOCKET" >&2
    exit 1
  fi
  sleep 0.2
done

echo "[local-rag] building initial course index"
(
  cd "$AGENT_ROOT"
  set -a
  # shellcheck disable=SC1090
  . "$AGENT_ENV_FILE"
  set +a
  unset AGENT_SETTINGS_SOCKET AGENT_SERVICE_TOKEN
  export COURSE_MATERIALS_ROOT="$LOCAL_RAG_ROOT"
  export RAG_COURSE_SNAPSHOT_SOCKET="$LOCAL_SOCKET"
  export RAG_COURSE_SNAPSHOT_TOKEN="$LOCAL_TOKEN"
  export RAG_INDEX_MANIFEST_PATH="data/rag/current.json"
  export FREEBBS_WEB_BASE_URL="http://127.0.0.1:3000"
  .venv/bin/python scripts/sync_course_rag_index.py
)

echo "[local-rag] starting automatic index checks every 30 seconds"
(
  while true; do
    sleep 30
    (
      cd "$AGENT_ROOT"
      set -a
      # shellcheck disable=SC1090
      . "$AGENT_ENV_FILE"
      set +a
      unset AGENT_SETTINGS_SOCKET AGENT_SERVICE_TOKEN
      export COURSE_MATERIALS_ROOT="$LOCAL_RAG_ROOT"
      export RAG_COURSE_SNAPSHOT_SOCKET="$LOCAL_SOCKET"
      export RAG_COURSE_SNAPSHOT_TOKEN="$LOCAL_TOKEN"
      export RAG_INDEX_MANIFEST_PATH="data/rag/current.json"
      export FREEBBS_WEB_BASE_URL="http://127.0.0.1:3000"
      .venv/bin/python scripts/sync_course_rag_index.py
    ) || echo "[local-rag] index refresh failed; the previous index remains active" >&2
  done
) &
SYNC_PID="$!"

echo
echo "[local-rag] ready"
echo "[local-rag] website: http://127.0.0.1:3000"
echo "[local-rag] knowledge example: http://127.0.0.1:3000/knowledge?course=signals&point=SS-01-01"
echo "[local-rag] press Ctrl-C to stop all services"

while true; do
  for process_id in "$WEB_PID" "$AGENT_PID" "$SYNC_PID"; do
    if ! kill -0 "$process_id" 2>/dev/null; then
      wait "$process_id" || true
      exit 1
    fi
  done
  sleep 1
done
