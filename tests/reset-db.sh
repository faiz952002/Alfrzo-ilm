#!/usr/bin/env bash
# Rebuild the disposable test database the way production is built: Supabase stand-in + supabase/migrations/001…
# (with Supabase's default privileges for new objects). LEGACY=1 builds it from the old schema.sql + patch files instead.
# Everything goes through the mandatory database guard (tests/lib/db-guard.sh): it refuses unless this is the
# exact disposable local / CI test database. Any failure stops the script with a non-zero exit code.
set -euo pipefail
cd "$(dirname "$0")/.."
G="bash tests/lib/db-guard.sh"
KEY="${1:-main}"

apply() {   # apply one SQL file; show its output only when it fails
  local f="$1" out
  if ! out="$($G run "$KEY" -q < "$f" 2>&1)"; then
    echo "FAILED: $f" >&2; echo "$out" | grep -v '^NOTICE' >&2; exit 1
  fi
}

$G reset "$KEY" >/dev/null
apply tests/supabase_shim.sql
if [ "${LEGACY:-0}" = "1" ]; then
  apply supabase/schema.sql
  for f in supabase/patch_*.sql; do apply "$f"; done
  echo "db ready (legacy files): $($G name "$KEY")"
else
  printf '%s\n' "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" \
    "alter default privileges in schema public grant all on functions to anon, authenticated, service_role;" \
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" | $G run "$KEY" -q
  for f in supabase/migrations/0[0-9][0-9]_*.sql; do
    case "$f" in *000_preflight_check.sql) continue;; esac
    apply "$f"
  done
  echo "db ready (migrations): $($G name "$KEY")"
fi
