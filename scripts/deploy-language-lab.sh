#!/usr/bin/env bash
# Run as the deployment user with Docker access. No application secrets are mounted.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAB_IMAGE="${LAB_IMAGE:-freebbs-language-lab:latest}"
docker build --build-arg "DEBIAN_MIRROR=${LAB_DEBIAN_MIRROR:-https://mirrors.aliyun.com/debian}" --network=host --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg ALL_PROXY= --build-arg http_proxy= --build-arg https_proxy= --build-arg all_proxy= --build-arg NO_PROXY="*" -t "$LAB_IMAGE" "$ROOT_DIR/services/language-lab"
docker run --rm --network=none --entrypoint python3 "$LAB_IMAGE" -c \
  'import shutil; assert all(shutil.which(c) for c in ["gcc", "g++", "mips-linux-gnu-g++", "riscv64-linux-gnu-g++", "octave", "iverilog"])'
docker rm -f freebbs-language-lab-controller 2>/dev/null || true
docker run -d --name freebbs-language-lab-controller --restart unless-stopped \
  --user 0:0 --read-only --tmpfs /tmp:rw,nosuid,size=16m \
  --memory 256m --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:8010:8010 \
  -e "LAB_WORKER_IMAGE=$LAB_IMAGE" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /usr/bin/docker:/usr/bin/docker:ro \
  --entrypoint python3 "$LAB_IMAGE" /opt/lab/controller.py
for attempt in $(seq 1 15); do
  if curl --fail --silent http://127.0.0.1:8010/health; then exit 0; fi
  sleep 1
done
exit 1
