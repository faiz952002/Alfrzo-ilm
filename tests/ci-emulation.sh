#!/usr/bin/env bash
# LOCAL EMULATION of the GitHub Actions "database" job (.github/workflows/tests.yml), for checking CI mode before
# anything is pushed. It needs a separate DISPOSABLE PostgreSQL that looks like the GitHub service container:
# TCP on 127.0.0.1, password authentication (scram), superuser postgres / password postgres - never a real database.
#   CI_EMU_PORT=55432 bash tests/ci-emulation.sh
# It sets the same variables GitHub Actions sets, then runs the job's steps in the same order. This is NOT a GitHub
# Actions run; the real CI result only exists after a push (with the owner's approval).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${CI_EMU_PORT:?set CI_EMU_PORT to the port of the disposable emulation server}"
TMP_RUNNER="$(mktemp -d)"; trap 'rm -rf "$TMP_RUNNER"' EXIT
# start from an empty environment: nothing from this machine (local-mode flags, other PG* settings) leaks in
run_ci() {
  env -i PATH="/usr/local/bin:/usr/bin:/bin" HOME="${HOME:-/tmp}" LANG=C.UTF-8 \
    CI=true GITHUB_ACTIONS=true GITHUB_WORKFLOW=Tests RUNNER_TEMP="$TMP_RUNNER" GITHUB_REPOSITORY=faiz952002/Alfrzo-ilm \
    ALFRZO_CI_TEST_DB=1 PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGPASSWORD=postgres "$@"
}
step() { echo "=== STEP: $1"; }

step "Guard must REFUSE a production-like configuration"
if run_ci env PGHOST=db.example.supabase.co bash tests/lib/db-guard.sh check; then echo "guard did not refuse"; exit 1; fi
if run_ci env RENDER=true bash tests/lib/db-guard.sh check; then echo "guard did not refuse"; exit 1; fi
if run_ci env ALFRZO_CI_TEST_DB= bash tests/lib/db-guard.sh check; then echo "guard did not refuse"; exit 1; fi
echo "refused as expected"
for t in guard db db3 db4 db5 db6 db7 db8 contact migrations; do
  step "$t"
  run_ci bash tests/run-db-tests.sh "$t"
done
echo "=== CI EMULATION: ALL STEPS PASSED"
