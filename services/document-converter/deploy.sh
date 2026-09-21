#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker build -t freebbs-document-converter:local .
docker network inspect freebbs-documents-isolated >/dev/null 2>&1 || docker network create --internal --subnet 172.30.77.0/24 freebbs-documents-isolated
if docker container inspect freebbs-document-converter >/dev/null 2>&1; then
  docker rm -f freebbs-document-converter
fi
docker run -d --name freebbs-document-converter --restart unless-stopped \
  --network freebbs-documents-isolated --ip 172.30.77.2 \
  --read-only --tmpfs /tmp:rw,nosuid,size=384m \
  --memory=768m --cpus=1 --pids-limit=128 --cap-drop=ALL \
  --security-opt no-new-privileges:true freebbs-document-converter:local
