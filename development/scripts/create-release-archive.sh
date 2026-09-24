#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

usage() {
  printf '%s\n' 'Usage: scripts/create-release-archive.sh --sha 40_HEX_COMMIT_SHA --output ARCHIVE.tar.gz'
}

fail() {
  printf 'Release archive creation failed: %s\n' "$1" >&2
  exit 1
}

release_sha=
output=
while (($#)); do
  case "$1" in
    --sha)
      (($# >= 2)) || fail '--sha requires a value'
      release_sha=$2
      shift 2
      ;;
    --output)
      (($# >= 2)) || fail '--output requires a value'
      output=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ $release_sha =~ ^[0-9a-fA-F]{40}$ ]] ||
  fail 'SHA must be a 40-character hexadecimal commit identifier'
[[ -n $output ]] || fail '--output is required'
[[ ! -e $output ]] || fail 'output archive already exists'

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
output_parent=$(cd "$(dirname "$output")" && pwd -P) ||
  fail 'output parent directory does not exist'
output="$output_parent/$(basename "$output")"
staging=$(mktemp -d "${TMPDIR:-/tmp}/freebbs-release.XXXXXX")
partial=$(mktemp "$output.partial.XXXXXX") || fail 'could not create output beside target'

cleanup() {
  rm -rf -- "$staging"
  rm -f -- "$partial"
}
trap cleanup EXIT HUP INT TERM

include_paths=(
  package.json
  package-lock.json
  tsconfig.base.json
  eslint.config.mjs
  apps/api/package.json
  apps/api/tsconfig.json
  apps/api/src
  apps/web/package.json
  apps/web/tsconfig.json
  apps/web/vite.config.ts
  apps/web/index.html
  apps/web/public
  apps/web/src
  packages/contracts/package.json
  packages/contracts/tsconfig.json
  packages/contracts/src
  database/migrations
  deploy
  scripts
)

cd "$repo_root"
command -v git >/dev/null 2>&1 || fail 'git is required to resolve the release commit'
resolved_sha=$(git rev-parse --verify "$release_sha^{commit}" 2>/dev/null) ||
  fail 'SHA does not resolve to a repository commit'
[[ $resolved_sha == "${release_sha,,}" ]] || fail 'SHA does not identify the resolved commit exactly'

# Source bytes come from the immutable Git object, never from the working tree.
git archive --format=tar "$resolved_sha" -- "${include_paths[@]}" |
  tar -xf - -C "$staging"
for path in "${include_paths[@]}"; do
  [[ -e $staging/$path ]] || fail "required release input is missing from commit: $path"
done

# Environment files are server-owned. Only documented examples may enter an archive.
while IFS= read -r -d '' candidate; do
  case "$(basename "$candidate")" in
    *.example) ;;
    *) rm -f -- "$candidate" ;;
  esac
done < <(find "$staging" -type f -name '.env*' -print0)

printf '%s\n' "${release_sha,,}" >"$staging/.release-sha"

tar \
  --sort=name \
  --mtime="@${SOURCE_DATE_EPOCH:-0}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C "$staging" \
  -czf "$partial" \
  .
chmod 0600 "$partial"
if ! ln -- "$partial" "$output"; then
  fail 'refusing to overwrite an archive target created concurrently'
fi
rm -f -- "$partial"
trap - EXIT HUP INT TERM
rm -rf -- "$staging"

printf 'Release archive created for %s\n' "${release_sha,,}"
