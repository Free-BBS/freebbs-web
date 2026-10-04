#!/usr/bin/env bash
set -euo pipefail
MOBILE_RELEASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_TARGET="${DEPLOY_DIR:-/data/www/free-BBS}"
MOBILE_SERVICE="${BACKEND_SERVICE_NAME:-free-bbs-backend}"
MOBILE_HEALTH="http://127.0.0.1:3001/api/health"
exec 9>/tmp/free-bbs-mobile-deployment.lock
flock -n 9
test -w "$MOBILE_TARGET/backend"
test -w "$MOBILE_TARGET/database/migrations"
test -w "$MOBILE_TARGET/public"
sudo -k
sudo -n -l /usr/bin/systemctl restart "$MOBILE_SERVICE" >/dev/null
sudo -n -l /usr/bin/systemctl --no-pager --full status "$MOBILE_SERVICE" >/dev/null
MOBILE_SERVER_SHA="$(sha256sum "$MOBILE_TARGET/backend/server.js" | awk '{print $1}')"
export MOBILE_SERVER_SHA
/usr/bin/node "$MOBILE_RELEASE/patch-mobile-backend.js" "$MOBILE_TARGET/backend/server.js" "$MOBILE_RELEASE/backend/server.js"
/usr/bin/node --check "$MOBILE_RELEASE/backend/server.js"
/usr/bin/node --check "$MOBILE_RELEASE/backend/mobile-safety.js"

mkdir -p "$MOBILE_TARGET/.mobile-release-backups"
MOBILE_BACKUP="$(mktemp -d "$MOBILE_TARGET/.mobile-release-backups/release-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
chmod 700 "$MOBILE_BACKUP"
export MOBILE_RELEASE MOBILE_TARGET MOBILE_BACKUP
python3 - <<'PY'
import hashlib, json, os, shutil
from pathlib import Path
root=Path(os.environ['MOBILE_TARGET']); backup=Path(os.environ['MOBILE_BACKUP'])
names=['backend/server.js','backend/mobile-safety.js','database/migrations/032_mobile_safety.sql','public/mobile/privacy.html','public/mobile/support.html']
manifest=[]
for name in names:
    p=root/name
    present=p.exists()
    item={'name':name,'existed':present}
    if present:
        q=backup/name; q.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(p,q)
        item['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
        if name=='backend/server.js' and item['sha256']!=os.environ['MOBILE_SERVER_SHA']:
            raise RuntimeError('Production changed while the patch was being prepared')
    manifest.append(item)
(backup/'manifest.json').write_text(json.dumps(manifest,indent=2))
PY

rollback() {
  trap - ERR
  if [[ ! -f "$MOBILE_RELEASE/.installation-started" ]]; then
    echo '[mobile deploy] stopped before installation; production files preserved' >&2
    exit 1
  fi
  echo '[mobile deploy] failed; restoring saved code and pages' >&2
  python3 - <<'PY'
import json, os, shutil
from pathlib import Path
root=Path(os.environ['MOBILE_TARGET']); backup=Path(os.environ['MOBILE_BACKUP'])
for item in json.loads((backup/'manifest.json').read_text()):
    target=root/item['name']
    if item['existed']: shutil.copy2(backup/item['name'],target)
    elif target.exists(): target.unlink()
PY
  sudo -n /usr/bin/systemctl restart "$MOBILE_SERVICE" || true
  echo "[mobile deploy] backup: $MOBILE_BACKUP; additive tables are retained" >&2
  exit 1
}
trap rollback ERR
python3 - <<'PY'
import hashlib, json, os, shutil, uuid
from pathlib import Path
root=Path(os.environ['MOBILE_TARGET']); source=Path(os.environ['MOBILE_RELEASE']); backup=Path(os.environ['MOBILE_BACKUP'])
manifest=json.loads((backup/'manifest.json').read_text())
for item in manifest:
    p=root/item['name']
    if item['existed'] and hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:
        raise RuntimeError('Production changed during preparation; refusing to overwrite')
    if not item['existed'] and p.exists():
        raise RuntimeError('A new production file appeared during preparation')
(source/'.installation-started').touch()
for item in manifest:
    target=root/item['name']; target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.parent/('.mobile-'+str(uuid.uuid4())+'.tmp')
    shutil.copyfile(source/item['name'],temporary); temporary.chmod(0o644); os.replace(temporary,target)
PY
sudo -n /usr/bin/systemctl restart "$MOBILE_SERVICE"
MOBILE_READY=0
for attempt in {1..20}; do
  if curl --fail --silent "$MOBILE_HEALTH" >/dev/null &&
     [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:3001/api/mobile/blocks)" == 401 ]] &&
     [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:3001/api/admin/mobile/reports)" == 401 ]]; then
    MOBILE_READY=1
    break
  fi
  sleep 2
done
[[ "$MOBILE_READY" == 1 ]]
sudo -n /usr/bin/systemctl --no-pager --full status "$MOBILE_SERVICE"
trap - ERR
echo "[mobile deploy] healthy; five scoped files installed; backup: $MOBILE_BACKUP"
