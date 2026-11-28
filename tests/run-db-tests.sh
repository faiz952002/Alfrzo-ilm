#!/usr/bin/env bash
# Runs every database test against the disposable test database, behind the mandatory guard.
# Local:  ALFRZO_TEST_DB=1 PGHOST=<socket dir or 127.0.0.1> PGPORT=<port> PGUSER=postgres bash tests/run-db-tests.sh
# CI:     the workflow sets ALFRZO_CI_TEST_DB=1 (see .github/workflows/tests.yml)
# While it runs, the blocking stand-ins in tests/lib/shims come first on PATH, so a test that tries to call
# psql / createdb / dropdb / pg_dump directly fails instead of reaching a database.
# Any failure stops the run with a non-zero exit code. Pass test names to run only those (e.g. db7 db8).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/tests/lib/shims:$PATH"
bash tests/lib/db-guard.sh check

ALL=(db db3 db4 db5 db6 db7 db8)
SEL=("$@"); [ ${#SEL[@]} -gt 0 ] || SEL=("${ALL[@]}")
for t in "${SEL[@]}"; do
  case "$t" in
    db|db3|db4|db5|db6|db7|db8) bash tests/reset-db.sh main >/dev/null; node --test "tests/$t.test.mjs" ;;
    contact) bash tests/reset-db.sh main >/dev/null; node --test tests/contact.test.mjs ;;
    guard) node --test tests/guard.test.mjs ;;
    migrations) bash tests/migrations.sh ;;
    e2e) bash tests/reset-db.sh main >/dev/null; node --test tests/e2e/flows.test.mjs ;;
    *) echo "unknown test set: $t" >&2; exit 2 ;;
  esac
done
echo "database tests finished: ${SEL[*]}"
