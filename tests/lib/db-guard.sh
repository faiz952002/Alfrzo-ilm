#!/usr/bin/env bash
# =====================================================================================================
# Alfrzo Ilm - MANDATORY DATABASE GUARD for every test / migration script.
# Nothing in this repository may run psql / createdb / dropdb / pg_dump directly (CI checks this);
# everything goes through this file, which refuses to touch anything but a disposable local / CI test database.
#
#   bash tests/lib/db-guard.sh check                 environment checks only (no connection)
#   bash tests/lib/db-guard.sh verify  <key>         + one read-only verification query on that database
#   bash tests/lib/db-guard.sh run     <key> [flags] run SQL from stdin on a verified database
#                                                     flags (only these): -q -t -A -X --csv -F <sep>
#   bash tests/lib/db-guard.sh dump    <key>         pg_dump (schema + data) of a verified database to stdout
#   bash tests/lib/db-guard.sh create  <key>         create the allowlisted database + set its marker
#   bash tests/lib/db-guard.sh drop    <key>         drop the allowlisted database (marker verified first)
#   bash tests/lib/db-guard.sh reset   <key>         drop + create
#   bash tests/lib/db-guard.sh name    <key>         print the allowlisted database name
#   bash tests/lib/db-guard.sh postgrest <key> <port>  start PostgREST (browser tests, local mode only) on the verified
#                                                     database; JWT test secret on stdin; runs until stopped
#
# Modes (exactly one):
#   local: ALFRZO_TEST_DB=1      not in CI; PGHOST = Unix-socket directory or loopback
#   CI   : ALFRZO_CI_TEST_DB=1   GitHub Actions of faiz952002/Alfrzo-ilm; PGHOST = loopback (service container)
# Exit codes: 70 mode/environment, 71 production/Render sign, 72 host, 73 database name/key, 74 port,
#             75 service file / hostaddr, 76 secret-like variable, 77 forbidden argument / meta-command,
#             78 verification failed (name, marker or server address), 79 destructive operation refused.
# =====================================================================================================
set -euo pipefail

G_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
G_SHIM_DIR="$G_SELF_DIR/shims"
die() { echo "GUARD REFUSED ($1): $2" >&2; exit "$1"; }

# ---------------------------------------------------------------- allowlist (exact names, no patterns) ----
# key -> exact database name, per mode. Nothing else can ever be created, used or dropped.
g_name() {
  local key="$1"
  if [ "$G_MODE" = local ]; then
    case "$key" in
      main) echo alfrzo_disposable_test ;;
      probe) echo alfrzo_disposable_guardprobe ;;
      m_fresh_plain) echo alfrzo_disposable_m_fresh_plain ;;
      m_fresh_supabase) echo alfrzo_disposable_m_fresh_supabase ;;
      m_up_plain) echo alfrzo_disposable_m_up_plain ;;
      m_up_supabase) echo alfrzo_disposable_m_up_supabase ;;
      m_order_plain) echo alfrzo_disposable_m_order_plain ;;
      m_order_supabase) echo alfrzo_disposable_m_order_supabase ;;
      m_fail_plain) echo alfrzo_disposable_m_fail_plain ;;
      m_fail_supabase) echo alfrzo_disposable_m_fail_supabase ;;
      m_h8) echo alfrzo_disposable_m_h8 ;;
      *) return 1 ;;
    esac
  else
    case "$key" in
      main) echo alfrzo_ci_disposable_test ;;
      probe) echo alfrzo_ci_disposable_guardprobe ;;
      m_fresh_plain) echo alfrzo_ci_disposable_m_fresh_plain ;;
      m_fresh_supabase) echo alfrzo_ci_disposable_m_fresh_supabase ;;
      m_up_plain) echo alfrzo_ci_disposable_m_up_plain ;;
      m_up_supabase) echo alfrzo_ci_disposable_m_up_supabase ;;
      m_order_plain) echo alfrzo_ci_disposable_m_order_plain ;;
      m_order_supabase) echo alfrzo_ci_disposable_m_order_supabase ;;
      m_fail_plain) echo alfrzo_ci_disposable_m_fail_plain ;;
      m_fail_supabase) echo alfrzo_ci_disposable_m_fail_supabase ;;
      m_h8) echo alfrzo_ci_disposable_m_h8 ;;
      *) return 1 ;;
    esac
  fi
}
g_marker() { if [ "$G_MODE" = local ]; then echo 'ALFRZO_DISPOSABLE_TEST v1 (local)'; else echo 'ALFRZO_DISPOSABLE_TEST v1 (ci)'; fi; }

# ---------------------------------------------------------------- G1 + N1: environment (no connection) ----
is_loopback() { case "$1" in 127.0.0.1|localhost|::1) return 0 ;; *) return 1 ;; esac; }
g_check_env() {
  # mode
  local l="${ALFRZO_TEST_DB:-}" c="${ALFRZO_CI_TEST_DB:-}"
  if [ "$l" = 1 ] && [ "$c" = 1 ]; then die 70 "both ALFRZO_TEST_DB and ALFRZO_CI_TEST_DB are set"; fi
  if [ "$l" = 1 ]; then
    G_MODE=local
    if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then die 70 "local mode, but CI / GITHUB_ACTIONS is set"; fi
  elif [ "$c" = 1 ]; then
    G_MODE=ci
    [ "${GITHUB_ACTIONS:-}" = true ] && [ "${CI:-}" = true ] && [ -n "${GITHUB_WORKFLOW:-}" ] && [ -n "${RUNNER_TEMP:-}" ] \
      && [ "${GITHUB_REPOSITORY:-}" = faiz952002/Alfrzo-ilm ] || die 70 "CI mode outside the project's GitHub Actions"
  else
    die 70 "set ALFRZO_TEST_DB=1 (local) or ALFRZO_CI_TEST_DB=1 (CI)"
  fi
  # production / Render signs
  if [ -n "${RENDER:-}" ] || [ "${NODE_ENV:-}" = production ] || env | grep -qE '^RENDER_[A-Z_]*='; then die 71 "Render / production environment detected"; fi
  # secret-like variables (names and values); values are never printed
  local n
  for n in SUPABASE_SERVICE_ROLE_KEY RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET LIVEKIT_API_SECRET; do
    if [ -n "${!n:-}" ]; then die 76 "secret variable $n is set"; fi
  done
  if env | grep -qiE 'sb_secret_|rzp_live_|c2VydmljZV9yb2xl|supabase\.co'; then die 76 "a variable contains a production key or Supabase host"; fi
  # PostgREST must never take its settings (database URI, secret ...) from the environment
  if env | grep -qE '^PGRST_[A-Z_]*='; then die 72 "PGRST_* variables are set (PostgREST settings come from the guard only)"; fi
  # service configuration and alternate connection settings
  if [ -n "${PGSERVICE:-}" ] || [ -n "${PGSERVICEFILE:-}" ]; then die 75 "PGSERVICE / PGSERVICEFILE must not be set"; fi
  if [ -n "${PGHOSTADDR:-}" ] && ! is_loopback "$PGHOSTADDR"; then die 75 "PGHOSTADDR is not loopback"; fi
  for n in DATABASE_URL DIRECT_URL SUPABASE_URL POSTGRES_URL PGURI; do
    local v="${!n:-}"
    if [ -n "$v" ] && ! [[ "$v" =~ ^[a-z]+://([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$) ]]; then die 72 "$n points to a non-local host"; fi
  done
  # host
  local h="${PGHOST:-}"
  [ -n "$h" ] || die 72 "PGHOST must be set explicitly"
  case "$h" in *supabase*) die 72 "PGHOST looks like Supabase" ;; esac
  if [ "$G_MODE" = local ]; then
    if [[ "$h" == /* ]]; then [ -d "$h" ] || die 72 "PGHOST socket directory does not exist"
    elif ! is_loopback "$h"; then die 72 "PGHOST is not a local socket directory or loopback"; fi
  else
    is_loopback "$h" || die 72 "CI mode needs a loopback PGHOST"
  fi
  # port
  local p="${PGPORT:-}"
  [[ "$p" =~ ^[0-9]{4,5}$ ]] && [ "$p" -ge 1024 ] && [ "$p" -le 65535 ] || die 74 "PGPORT must be a number between 1024 and 65535"
  # database name from the environment: unset, or exactly the main test database
  if [ -n "${PGDATABASE:-}" ] && [ "$PGDATABASE" != "$(g_name main)" ]; then die 73 "PGDATABASE is not the approved disposable test database"; fi
  return 0
}

# ---------------------------------------------------------------- binaries (never the blocking shims) -----
g_bin() {
  local tool="$1" d
  if [ -n "${ALFRZO_PG_BIN_DIR:-}" ]; then
    [[ "$ALFRZO_PG_BIN_DIR" == /* ]] && [ -x "$ALFRZO_PG_BIN_DIR/$tool" ] || die 70 "ALFRZO_PG_BIN_DIR has no $tool"
    echo "$ALFRZO_PG_BIN_DIR/$tool"; return
  fi
  local IFS=:
  for d in $PATH; do
    [ -n "$d" ] && [ "$(cd "$d" 2>/dev/null && pwd -P || echo)" != "$(cd "$G_SHIM_DIR" && pwd -P)" ] && [ -x "$d/$tool" ] && { echo "$d/$tool"; return; }
  done
  die 70 "$tool not found"
}
# PostgREST binary: first on PATH (never the shim directory), else the local test install; empty if none (no exit)
g_find_postgrest() {
  local d; local IFS=:
  for d in $PATH; do
    if [ -n "$d" ] && [ -x "$d/postgrest" ] && [ "$(cd "$d" 2>/dev/null && pwd -P || echo)" != "$(cd "$G_SHIM_DIR" && pwd -P)" ]; then echo "$d/postgrest"; return 0; fi
  done
  if [ -x /tmp/pgrst/postgrest ]; then echo /tmp/pgrst/postgrest; fi
  return 0
}
G_EMPTY_CONF="$(mktemp -d)"; trap 'rm -rf "$G_EMPTY_CONF"' EXIT
# a clean environment: only what the connection needs; no PGSERVICE, PGSERVICEFILE, PGHOSTADDR, PGDATABASE, PGOPTIONS ...
g_exec() {
  env -i PATH="/usr/bin:/bin" HOME="${HOME:-/tmp}" LANG=C.UTF-8 PGSYSCONFDIR="$G_EMPTY_CONF" \
      ${PGUSER:+PGUSER="$PGUSER"} ${PGPASSWORD:+PGPASSWORD="$PGPASSWORD"} ${PGPASSFILE:+PGPASSFILE="$PGPASSFILE"} \
      ${FAKE_PSQL_LOG:+FAKE_PSQL_LOG="$FAKE_PSQL_LOG"} ${FAKE_PSQL_OUT:+FAKE_PSQL_OUT="$FAKE_PSQL_OUT"} "$@"
}
g_conninfo() { echo "host=$PGHOST port=$PGPORT dbname=$1 sslmode=disable connect_timeout=5 application_name=alfrzo_test_guard"; }

# ---------------------------------------------------------------- G5 + N2: one read-only verification query
# Reads the database name, its comment (marker) and the real server address; compares them exactly here.
# On any mismatch the psql process has already ended (connection closed) and nothing else is run.
g_verify_db() {   # $1 = exact database name, $2 = expected marker ('' = maintenance database: marker not required)
  local db="$1" want="$2" out name marker addr enc sep=$'\x1f'
  out="$(printf '%s\n' "begin transaction read only;" \
     "select current_database(), coalesce(shobj_description(d.oid, 'pg_database'), ''), coalesce(host(inet_server_addr()), ''), pg_encoding_to_char(d.encoding) from pg_database d where d.datname = current_database();" \
     "rollback;" | g_exec "$(g_bin psql)" -X -q -t -A -F "$sep" -v ON_ERROR_STOP=1 -d "$(g_conninfo "$db")" 2>/dev/null)" \
     || die 78 "verification query failed on $db"
  IFS="$sep" read -r name marker addr enc <<<"$out" || true
  [ "$name" = "$db" ] || die 78 "connected database is not $db"
  if [ -n "$want" ]; then
    [ "$marker" = "$want" ] || die 78 "database $db has no valid disposable-test marker for this mode"
    [ "$enc" = UTF8 ] || die 78 "database $db is not UTF8 (production is UTF8; results would differ)"
  fi
  if [ -z "$addr" ]; then
    { [ "$G_MODE" = local ] && [[ "$PGHOST" == /* ]]; } || die 78 "server address is not loopback"
  else
    is_loopback "$addr" || die 78 "server address $addr is not loopback"
  fi
}
g_exists() {   # read-only, on the maintenance database
  g_verify_db postgres ''
  printf "select 1 from pg_database where datname = '%s';\n" "$1" | g_exec "$(g_bin psql)" -X -q -t -A -v ON_ERROR_STOP=1 -d "$(g_conninfo postgres)"
}

# ---------------------------------------------------------------- stdin filter: no connection switching ----
g_check_sql() {   # reads stdin, writes it to stdout if it contains no psql meta-command that could leave the verified database
  local f; f="$(mktemp)"; cat >"$f"
  if grep -qE '\\(c|connect|!|setenv|i|ir|include|include_relative|o|out|copy|cd|w|write|password|getenv)([[:space:]]|$)' "$f"; then
    rm -f "$f"; die 77 "psql meta-commands that switch connection or touch files are not allowed"
  fi
  cat "$f"; rm -f "$f"
}

# ---------------------------------------------------------------- commands -----------------------------------
main() {
  local cmd="${1:-}"; shift || true
  g_check_env
  local key="${1:-}" db
  if [ "$cmd" != check ]; then
    [ -n "$key" ] || die 73 "missing database key"
    db="$(g_name "$key")" || die 73 "unknown database key (not on the allowlist)"
    shift
  fi
  case "$cmd" in
    check) echo "guard ok ($G_MODE)" ;;
    name) echo "$db" ;;
    verify) g_verify_db "$db" "$(g_marker)"; echo "verified $db ($G_MODE)" ;;
    run)
      local args=() a
      while [ $# -gt 0 ]; do
        a="$1"; shift
        case "$a" in
          -q|-t|-A|-X|--csv) args+=("$a") ;;
          -F) [ $# -gt 0 ] && [ "${#1}" -le 2 ] || die 77 "bad -F"; args+=(-F "$1"); shift ;;
          *) die 77 "argument '$a' is not allowed (connection settings come from the guard only)" ;;
        esac
      done
      local sql; sql="$(g_check_sql)"
      g_verify_db "$db" "$(g_marker)"
      printf '%s\n' "$sql" | g_exec "$(g_bin psql)" -X -v ON_ERROR_STOP=1 "${args[@]}" -d "$(g_conninfo "$db")" ;;
    dump)
      [ $# -eq 0 ] || die 77 "dump takes no extra arguments"
      g_verify_db "$db" "$(g_marker)"
      g_exec "$(g_bin pg_dump)" --no-owner -d "$(g_conninfo "$db")" ;;
    create)
      [ $# -eq 0 ] || die 77 "create takes no extra arguments"
      g_verify_db postgres ''
      printf '%s\n' "create database \"$db\" with template template0 encoding 'UTF8';" "comment on database \"$db\" is '$(g_marker)';" \
        | g_exec "$(g_bin psql)" -X -q -v ON_ERROR_STOP=1 -d "$(g_conninfo postgres)"
      g_verify_db "$db" "$(g_marker)" ;;
    drop)
      [ $# -eq 0 ] || die 77 "drop takes no extra arguments"
      local ex; ex="$(g_exists "$db")"              # read-only; a failed check stops here (set -e)
      if [ -n "$ex" ]; then
        ( g_verify_db "$db" "$(g_marker)" ) || die 79 "refusing to drop $db: marker / name / address not verified"
        printf '%s\n' "drop database \"$db\" with (force);" | g_exec "$(g_bin psql)" -X -q -v ON_ERROR_STOP=1 -d "$(g_conninfo postgres)"
      fi ;;
    reset) "$0" drop "$key"; "$0" create "$key" ;;
    postgrest)
      [ "$G_MODE" = local ] || die 70 "PostgREST (browser tests) runs in local mode only"
      [ $# -eq 1 ] && [[ "$1" =~ ^[0-9]{4,5}$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] || die 77 "postgrest needs one port number (1024-65535)"
      local port="$1" secret bin runas="${ALFRZO_PGRST_RUNAS:-}" cdir uri
      IFS= read -r secret || true
      [[ "$secret" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || die 77 "the JWT test secret (stdin) must be 32-128 letters, digits, - or _"
      if [ -n "${ALFRZO_POSTGREST_BIN:-}" ]; then bin="$ALFRZO_POSTGREST_BIN"; else bin="$(g_find_postgrest)"; fi
      [[ "$bin" == /* ]] && [ -x "$bin" ] || die 70 "PostgREST binary not found"
      if [ -n "$runas" ]; then
        [[ "$runas" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] && [ "$runas" != root ] && id -u "$runas" >/dev/null 2>&1 || die 77 "ALFRZO_PGRST_RUNAS must be an existing non-root user"
        G_RUNUSER="$(command -v runuser || true)"; [[ "$G_RUNUSER" == /* ]] || die 70 "runuser not found"
      fi
      g_verify_db "$db" "$(g_marker)"
      if [[ "$PGHOST" == /* ]]; then uri="postgres://authenticator@/$db?host=$PGHOST&port=$PGPORT"; else uri="postgres://authenticator@$PGHOST:$PGPORT/$db"; fi
      cdir="$(mktemp -d)"; chmod 700 "$cdir"
      printf '%s\n' "db-uri = \"$uri\"" 'db-schemas = "public"' 'db-anon-role = "anon"' "jwt-secret = \"$secret\"" \
        "server-port = $port" 'server-host = "127.0.0.1"' 'log-level = "error"' > "$cdir/postgrest.conf"
      chmod 600 "$cdir/postgrest.conf"
      if [ -n "$runas" ]; then chown -R "$runas" "$cdir"; fi
      # clean environment: no PG* / PGRST_* / DATABASE_URL ... reaches PostgREST; its only settings are the file above
      if [ -n "$runas" ]; then
        env -i PATH="/usr/bin:/bin" HOME=/tmp LANG=C.UTF-8 PGSYSCONFDIR="$G_EMPTY_CONF" "$G_RUNUSER" -u "$runas" -- "$bin" "$cdir/postgrest.conf" </dev/null &
      else
        env -i PATH="/usr/bin:/bin" HOME=/tmp LANG=C.UTF-8 PGSYSCONFDIR="$G_EMPTY_CONF" "$bin" "$cdir/postgrest.conf" </dev/null &
      fi
      G_CHILD=$!; G_CDIR="$cdir"   # globals: the EXIT trap runs after this function has returned
      trap 'kill "${G_CHILD:-}" 2>/dev/null || true; rm -rf "${G_CDIR:-}" "$G_EMPTY_CONF"' EXIT
      trap 'exit 0' TERM INT
      wait "$G_CHILD" ;;
    *) die 77 "unknown command '$cmd'" ;;
  esac
}
main "$@"
