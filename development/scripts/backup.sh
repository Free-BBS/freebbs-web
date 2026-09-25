#!/bin/sh

set -eu
umask 077

usage() {
  printf '%s\n' 'Usage: scripts/backup.sh OUTPUT.sql'
  printf '%s\n' 'Requires MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE.'
}

fail() {
  printf 'Backup failed: %s\n' "$1" >&2
  exit 1
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 2
fi

output=$1
[ -n "$output" ] || fail 'an explicit output path is required'
case $output in
  -*) fail 'output paths beginning with - must be prefixed with ./' ;;
esac
[ ! -e "$output" ] || fail "Refusing to overwrite existing target: $output"

for variable_name in MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE; do
  eval "variable_value=\${$variable_name-}"
  [ -n "$variable_value" ] || fail "$variable_name is required"
  line_breaks=$(printf '%s' "$variable_value" | wc -l | tr -d '[:space:]')
  [ "$line_breaks" -eq 0 ] || fail "$variable_name must not contain line breaks"
  if printf '%s' "$variable_value" | LC_ALL=C grep '[[:cntrl:]]' >/dev/null 2>&1; then
    fail "$variable_name must not contain control characters"
  fi
done

case $MYSQL_DATABASE in
  -*) fail 'MYSQL_DATABASE must not begin with -' ;;
esac

case $MYSQL_PORT in
  *[!0-9]*|'') fail 'MYSQL_PORT must be an integer between 1 and 65535' ;;
esac
[ "$MYSQL_PORT" -ge 1 ] 2>/dev/null && [ "$MYSQL_PORT" -le 65535 ] 2>/dev/null ||
  fail 'MYSQL_PORT must be an integer between 1 and 65535'

command -v mysqldump >/dev/null 2>&1 || fail 'mysqldump is not installed or not on PATH'

output_directory=$(dirname "$output")
[ -d "$output_directory" ] || fail "output directory does not exist: $output_directory"

option_file=$(mktemp "${TMPDIR:-/tmp}/freebbs-development-client.XXXXXX") ||
  fail 'could not create a temporary client option file'
partial_file=$(mktemp "${output}.partial.XXXXXX") || {
  rm -f "$option_file"
  fail 'could not create a temporary backup file beside the target'
}

cleanup() {
  rm -f "$option_file" "$partial_file"
}
trap cleanup 0 HUP INT TERM

escape_option_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

escaped_host=$(escape_option_value "$MYSQL_HOST")
escaped_user=$(escape_option_value "$MYSQL_USER")
escaped_password=$(escape_option_value "$MYSQL_PASSWORD")

{
  printf '%s\n' '[client]'
  printf 'host="%s"\n' "$escaped_host"
  printf 'port=%s\n' "$MYSQL_PORT"
  printf 'user="%s"\n' "$escaped_user"
  printf 'password="%s"\n' "$escaped_password"
} >"$option_file"
chmod 600 "$option_file" "$partial_file"

if ! mysqldump \
  --defaults-extra-file="$option_file" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --no-tablespaces \
  --databases "$MYSQL_DATABASE" >"$partial_file"; then
  fail 'mysqldump did not complete; no target backup was published'
fi

[ -s "$partial_file" ] || fail 'mysqldump produced an empty backup'

# A same-directory hard link publishes atomically and fails if the target appeared meanwhile.
if ! ln "$partial_file" "$output"; then
  fail "Refusing to overwrite or publish target: $output"
fi
rm -f "$partial_file"
trap - 0 HUP INT TERM
rm -f "$option_file"

printf 'Backup written to %s\n' "$output"
