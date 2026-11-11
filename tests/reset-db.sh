#!/usr/bin/env bash
# Rebuild the throw-away test database: Supabase shim + schema.sql + all patches.
set -euo pipefail
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
DB=${PGDATABASE:-askdeen}
cd "$(dirname "$0")/.."
dropdb --if-exists "$DB"; createdb "$DB"
P="psql -d $DB -v ON_ERROR_STOP=1 -q"
$P -f tests/supabase_shim.sql
$P -f supabase/schema.sql 2>&1 | grep -v NOTICE || true
for f in supabase/patch_*.sql; do $P -f "$f" 2>&1 | grep -v NOTICE || true; done
echo "db ready: $DB"
