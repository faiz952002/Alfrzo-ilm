# Alfrzo Ilm – Database Migrations

All database setup lives in `supabase/migrations/`. Run the files **in number order, each once**.

| # | File | What it does | Re-run behaviour |
|---|---|---|---|
| 000 | `000_preflight_check.sql` | **Read-only.** Shows what already exists. For a new project every number must be `0`. | always safe |
| 001 | `001_base_schema.sql` | Base tables, security rules (RLS), triggers, views, 10 categories, `question-images` bucket | refuses: `ALREADY_APPLIED` (nothing changed) |
| 002 | `002_suspension_and_admin_tools.sql` | Fixes, account suspension, Premium priority, admin tools | refuses: `ALREADY_APPLIED`; refuses `MISSING_PREVIOUS` if 001 is missing |
| 003 | `003_scholar_applications_and_payments.sql` | Scholar applications, server-only payment functions, abuse limits | safe to re-run; refuses if 002 is missing |
| 004 | `004_private_questions_consultations_chat_reels.sql` | Private questions, consultations, chat, reels, `reels` bucket | safe to re-run; refuses if 003 is missing |
| 005 | `005_security_hardening.sql` | **New.** Exact permissions, function allow-list, profiles for users who signed up early | safe to re-run (always ends in the same state) |
| – | `../DATABASE_HEALTH_CHECK.sql` | **Read-only.** 20 checks; every row must be `true` | always safe |

## Relation to the old files

`001`–`004` contain the **unchanged** SQL of `supabase/schema.sql`, `patch_001.sql`, `patch_002.sql`, `patch_003.sql`
(0 lines removed). Only safety lines were added:

* a `begin; … commit;` transaction around `schema.sql` (the patches already had one), so a file either applies completely or not at all;
* a guard at the top that stops with a clear message (and changes nothing) when a file was already applied or the previous one is missing.

The old files stay in the repository for history. **Use the migrations folder for new projects.**
Why the guards matter: running the old `schema.sql` or `patch_001.sql` a second time fails half-way and could restore older
security functions (in a test this made a private question visible in the public feed). The guards make that impossible.

## Why 005 is needed

Supabase gives new tables and functions in `public` broad default permissions. The old files revoke most of them, but not on the
3 views created by patch_003 (`consultation_list`, `conversation_list`, `reel_feed`): visitors received insert/update/delete rights there
(not exploitable today because those views cannot be written through, but not intended). Some Supabase projects instead give **no**
function permissions by default, which breaks the security-rule helpers ("Could not load data"). 005 makes the final state identical in
both cases: exactly the 96 intended table/column permissions and an explicit function allow-list.

## Tested (local PostgreSQL 16 with a Supabase stand-in; not on a real Supabase project)

| Test | Result |
|---|---|
| Fresh project, 3 kinds of default permissions (plain, Supabase-like, no function defaults): 000 → 001…005 | all OK, health check **20/20** in each |
| Same database as the old 4 files (schema dump, excluding permissions) | **0 differences** |
| App test suites on a database built only from 001–005 | 19/19 + 12/12 database tests, **23/23 browser flows** |
| Every file run a second time | 001/002 refuse cleanly, 003–005 OK, schema **unchanged**, health 20/20 |
| 002 on an empty project | refuses (`MISSING_PREVIOUS`), 0 objects created |
| Users who signed up before setup | profiles created by 005 |
| Old 4 files without 005 on Supabase-like defaults | health check **16/20** (it detects the extra permissions) |
| Future Phase 1 patch (`patch_004.sql`) on top of 001–005 | applies, its 11 tests pass |

## Adding a migration later

1. Create the next number, e.g. `006_<what>.sql`, inside `begin; … commit;`, with a guard if it must not run twice.
2. Every new function needs an explicit `grant execute … to <role>` (the allow-list in 005 removes default access).
   Add it to the lists in `005_security_hardening.sql` **and** `DATABASE_HEALTH_CHECK.sql` (checks 3, 12, 13).
3. Every new table: `enable row level security`, policies, and explicit grants; add it to the health check.
4. Test locally (`tests/reset-db.sh`, `npm run test:db`, `npm run test:e2e`) before running it on Supabase.

Example: Phase 1's `patch_004.sql` adds `consultation_housekeeping()` and `consultation_cancel_cutoff()`. The health check flags them
until they are added to the allow-list – that is intended.
