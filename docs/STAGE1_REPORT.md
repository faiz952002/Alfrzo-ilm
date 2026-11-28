# Stage 1 record – database guard, migration 009 update, migration tests

Branch `feature/calling-livekit`, commit `e497b7c` (local only: nothing pushed, merged or deployed; no production SQL;
`integration-release-v1` untouched at `969078d`; migrations 001–008 unchanged). Approved by the owner before starting.

## What was built
| Area | Result |
|---|---|
| Mandatory database guard | `tests/lib/db-guard.sh` (+ `db.mjs`, blocking shims). Local mode `ALFRZO_TEST_DB=1`, CI mode `ALFRZO_CI_TEST_DB=1`. Refuses before connecting on any production/Render sign, secret-like variable, service file, remote host/address/URL, bad port, non-allowlisted database name, caller connection argument or connection-switching meta-command. One read-only verification query (exact name, exact mode marker, loopback / socket address). Create/drop only exact allowlisted names, marker verified right before a drop. |
| Test scripts | Every database test, `reset-db.sh` and the browser-test harness use the guard; `reset-db.sh` no longer hides migration errors. |
| Migration 009 (draft) | `app_settings` with bounds fixed in the migration (admin-only, audited, invalid values refused even for the owner); settings drive call window, ring timeout, rate limit, group capacity; capacity enforced on create/invite/join; group calls voice only; `camera_allowed` only for one-to-one video bookings; `call_fallback_room()` with the same booking rules. |
| Health check | 21 checks for 001–009. On 001–008 (production today) it shows 13/21 – only the 009 items (rows 1, 2, 3, 4, 5, 9, 13, 16). |
| CI | Database job switched to guard CI mode (not yet run on GitHub – see below). |

## Test results (executed locally in the session, 0 failures)
| Suite | Result |
|---|---|
| Server | 35/35 |
| Database: db 19, db3 12, db4 12, db5 13, db6 7, db7 11, db8 8, contact 4, guard 16 | 102/102 |
| Migration scenarios M1–M6 + H1 (plain and Supabase-style privileges) | all passed |
| Browser (through the guard) | 29/29 |
| Mutation check (guard's PGSERVICE check removed → test fails; restored) | detected |

## Known gaps (kept visible on purpose – NOT resolved)
* **Phone numbers written in Devanagari (९८७६५४३२१०) or Arabic-Indic (٩٨٧٦٥٤٣٢١٠) digits are not detected** – neither by the
  database (`contains_contact_info`, migration 001) nor by the browser (`CONTACT_RE`). Both sides behave the same; the cases
  are marked `known_gap` in `tests/fixtures/contact_info_cases.json` and a test keeps them listed. A fix needs a new forward
  migration plus a browser change, with owner approval.
* GitHub Actions has not yet run CI mode for real (pushing was not authorised).

## Follow-up (before Stage 2): two security issues

### 1. PostgREST only through the guard
* New guard command `postgrest <key> <port>` (local mode only; refused in CI mode, where browser tests do not run).
  It checks the environment like every other command, **refuses to start if any `PGRST_*` variable is set** (PostgREST
  would otherwise take its database URI / secret from the environment), verifies the exact disposable database (name,
  mode marker, local address, UTF8), writes the only configuration (exact `db-uri`, 127.0.0.1, port) into a private
  0600 file, starts PostgREST with an **empty environment** (no `PG*`, `PGRST_*`, `DATABASE_URL`, `SUPABASE_*` …),
  takes the JWT test secret on stdin (never in arguments or environment), and deletes the file when PostgREST stops.
* The browser-test harness no longer starts PostgREST itself; the static check (G-19) now also fails on any direct
  PostgREST start outside the guard.
* Tests: G-22 (positive, fake PostgREST: exact URI, clean environment, config removed), G-23 (17 unsafe configurations,
  each with **0 PostgREST starts**: inherited production / any `PGRST_DB_URI`, `PGRST_JWT_SECRET`, production
  `DATABASE_URL` / `SUPABASE_URL`, remote host, Render, CI mode, wrong key, bad / missing port, extra argument, bad
  secret, run as root, missing marker, wrong database), G-24 (positive, real PostgREST answers from the verified
  database; in CI mode the guard refuses).
* Bugs found and fixed on the way: the EXIT trap used a function-local variable (cleanup failed); a `$(… || …)`
  fallback could never run (silent exit 70); `runuser` was not found in the clean PATH. Shutdown measured:
  0 PostgREST and 0 guard processes left after stopping.

### 2. CI mode tested against a real disposable database (local emulation of the GitHub job)
* `tests/ci-emulation.sh` runs the GitHub "database" job's steps in order, with the variables GitHub sets, against a
  separate throw-away PostgreSQL like the GitHub service container (127.0.0.1, password auth, UTF8). It is an
  emulation, **not** a GitHub Actions run.
* Found and fixed: (a) G-14 needed the main database, which CI creates only later → the test now builds it itself;
  (b) the guard created test databases with the server's default encoding → it now always creates them as UTF8
  (`template0`), and verification refuses a non-UTF8 database (production is UTF8). My first emulation server was
  created as SQL_ASCII (my setup mistake) – that is what exposed (b).
* Result: **all steps passed** (refusal step, guard 19, db 19, db3 12, db4 12, db5 13, db6 7, db7 11, db8 8,
  contact 4, migrations all passed).
* **Real GitHub Actions result: not available.** It needs a push of this branch, which is not authorised.

### Results after the follow-up (local mode)
Server 35/35 · database 103/103 (guard now 19) · migration scenarios all passed · browser 29/29.

### Known gap – still open, NOT resolved
Phone numbers in Devanagari / Arabic-Indic digits are not detected (database and browser alike). See above.
