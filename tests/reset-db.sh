#!/usr/bin/env bash
# Rebuild the throw-away test database the way production is built: Supabase stand-in + supabase/migrations/001…
# (with Supabase's default privileges for new objects). LEGACY=1 builds it from the old schema.sql + patch files instead.
set -euo pipefail
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
DB=${PGDATABASE:-askdeen}
cd "$(dirname "$0")/.."
dropdb --if-exists "$DB"; createdb "$DB"
P="psql -d $DB -v ON_ERROR_STOP=1 -q"
$P -f tests/supabase_shim.sql
if [ "${LEGACY:-0}" = "1" ]; then
  $P -f supabase/schema.sql 2>&1 | grep -v NOTICE || true
  for f in supabase/patch_*.sql; do $P -f "$f" 2>&1 | grep -v NOTICE || true; done
  echo "db ready (legacy files): $DB"
else
  $P -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
         alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
         alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;"
  for f in supabase/migrations/0[0-9][0-9]_*.sql; do
    case "$f" in *000_preflight_check.sql) continue;; esac
    $P -f "$f" 2>&1 | grep -v NOTICE || true
  done
  echo "db ready (migrations): $DB"
fi
