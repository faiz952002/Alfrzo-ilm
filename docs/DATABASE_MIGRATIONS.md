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
| 006 | `006_phase1_fixes.sql` | Phase 1 fixes (the SQL of `patch_004.sql`, unchanged) + exact permissions for what it adds | refuses: `ALREADY_APPLIED`; refuses `MISSING_PREVIOUS` if 005 is missing |
| – | `../DATABASE_HEALTH_CHECK.sql` | **Read-only.** 20 checks for a project with **001–006**; every row must be `true` | always safe |

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
| Phase 1 patch (`patch_004.sql`) run directly on top of 001–005 | applies, but health check **17/20**: it leaves the new 2-hour helper open and the old check did not know the new rules → use **006** instead |

## 006 – Phase 1 fixes

`006_phase1_fixes.sql` = the unchanged SQL of `patch_004.sql` between a guard and a permissions block:

| Object added / changed | Visitors (`anon`) | Logged-in users | Why |
|---|---|---|---|
| `consultation_housekeeping()` | ✅ run | ✅ run | the booking page (open to visitors) and "My bookings" free expired unpaid holds first |
| `consultation_cancel_cutoff()` (2-hour rule) | ❌ | ❌ | used only inside `cancel_consultation()` and the `consultation_list` view |
| `reel_viewed(uuid)` | ❌ (was ✅) | ✅ run | M3: views are counted for logged-in users only, once per person |
| table `reel_views` | ❌ | ❌ | RLS on, no policies; only `reel_viewed()` writes it |
| view `consultation_list` (+ `can_cancel`) | ❌ | ✅ read | rows limited to the caller inside the view |
| trigger functions `answers_sync_counts`, `questions_before_delete` | ❌ | ❌ | run by the database only |

Guard: refuses (and changes nothing) when 005 has not run (`MISSING_PREVIOUS`) or when 006 is already complete (`ALREADY_APPLIED`).
A project that ran the raw `patch_004.sql` after 005 may still run 006: it re-applies the same SQL and fixes the permissions.

Tested locally (PostgreSQL 16 + Supabase stand-in, plain **and** Supabase-style default permissions; not on a real Supabase project):

| Test | Result |
|---|---|
| Fresh project 000 → 001…006 | health check **20/20** |
| 001–005 **with data**, then 006 | 13/20 before → **20/20** after, **no rows lost** |
| 006 a second time | refuses `ALREADY_APPLIED`, schema **unchanged** |
| 006 before 005 (after 004) | refuses `MISSING_PREVIOUS`, schema **unchanged** |
| 006 on an empty project | refuses `MISSING_PREVIOUS` |
| 001–005 + raw `patch_004.sql`, then 006 | 17/20 → **20/20** |
| Health check detects: helper opened to visitors or users, `reel_viewed` opened to visitors or closed to users, housekeeping closed, `reel_views` / `consultation_list` readable by visitors | each one fails the right check |

## Adding a migration later

1. Create the next number, e.g. `006_<what>.sql`, inside `begin; … commit;`, with a guard if it must not run twice.
2. Every new function needs an explicit `revoke … from public, anon, authenticated` and then `grant execute … to <role>` **in the new
   migration itself** (as 006 does), and the matching update of `DATABASE_HEALTH_CHECK.sql` (checks 3, 12, 13, 15).
3. Every new table: `enable row level security`, policies, and explicit grants; add it to the health check.
4. Test locally (`tests/reset-db.sh`, `npm run test:db`, `npm run test:e2e`) before running it on Supabase.

Example: 006 adds `consultation_housekeeping()` (visitors + users) and `consultation_cancel_cutoff()` (no direct access), and the
health check lists both.
