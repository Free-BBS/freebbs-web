#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

fail() {
  printf 'Server installation failed: %s\n' "$1" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || fail 'run this installer as root'

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
service_name=freebbs-development

getent group "$service_name" >/dev/null 2>&1 ||
  groupadd --system "$service_name"
id "$service_name" >/dev/null 2>&1 ||
  useradd --system --gid "$service_name" --home-dir /nonexistent --shell /usr/sbin/nologin "$service_name"

install -d -o root -g root -m 0755 /opt/freebbs-development
install -d -o root -g root -m 0755 /opt/freebbs-development/releases
install -d -o root -g "$service_name" -m 0750 /etc/freebbs-development
install -d -o "$service_name" -g "$service_name" -m 0750 /var/backups/freebbs-development
install -d -o root -g root -m 0755 /etc/nginx/snippets

install -o root -g root -m 0755 \
  "$repo_root/scripts/deploy-release.sh" \
  /usr/local/sbin/deploy-freebbs-development
install -o root -g root -m 0644 \
  "$repo_root/deploy/nginx/freebbs-development.locations.conf" \
  /etc/nginx/snippets/freebbs-development.locations.conf
install -o root -g root -m 0644 \
  "$repo_root"/deploy/systemd/*.service \
  "$repo_root"/deploy/systemd/*.timer \
  /etc/systemd/system/

install_environment() {
  local source=$1
  local target=$2
  if [[ ! -e $target ]]; then
    install -o root -g "$service_name" -m 0640 "$source" "$target"
  fi
}

install_environment \
  "$repo_root/deploy/env/development.env.example" \
  /etc/freebbs-development/development.env
install_environment \
  "$repo_root/deploy/env/backup.env.example" \
  /etc/freebbs-development/backup.env

systemctl daemon-reload
printf '%s\n' 'Server files installed. Configure development.env and deploy a release before enabling services.'
