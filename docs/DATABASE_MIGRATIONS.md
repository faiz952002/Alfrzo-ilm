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
| 007 | `007_premium_refund_correction.sql` | Premium refunds remove only the days the refunded payment bought; each refund applied once | refuses: `ALREADY_APPLIED`; refuses `MISSING_PREVIOUS` if 006 is missing |
| 008 | `008_profile_settings.sql` | Profile photo (private `avatars` bucket), consultation-notification preference, display-name check on change. Additive only | refuses: `ALREADY_APPLIED`; refuses `MISSING_PREVIOUS` if 007 is missing |
| – | `../DATABASE_HEALTH_CHECK.sql` | **Read-only.** 21 checks for a project with **001–008**; every row must be `true` | always safe |

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
| Phase 1 patch (`patch_004.sql`) run directly on top of 001–005 | applies, but health check **16/20**: it leaves the new 2-hour helper open and the old check did not know the new rules → use **006** instead |

## 006 – Phase 1 fixes

`006_phase1_fixes.sql` = the unchanged SQL of `patch_004.sql` between a guard and a permissions block:

| Object added / changed | Visitors (`anon`) | Logged-in users | Why |
|---|---|---|---|
| `consultation_housekeeping()` | ❌ | ✅ run | "My bookings", the scholar dashboard, booking and cancelling release expired unpaid holds first |
| view `bookable_slots` (new) | ✅ read | ✅ read | the public booking page reads it: open future slots of verified scholars **plus** held slots whose unpaid hold is older than 15 minutes (free again). No public function is needed; booking releases the old hold before it books. The health check fails if its 15 minutes and housekeeping's ever differ. |
| `consultation_cancel_cutoff()` (2-hour rule) | ❌ | ❌ | used only inside `cancel_consultation()` (runs with owner rights) |
| `reel_viewed(uuid)` | ❌ (was ✅) | ✅ run | M3: views are counted for logged-in users only, once per person |
| table `reel_views` | ❌ | ❌ | RLS on, no policies; only `reel_viewed()` writes it |
| view `consultation_list` (+ `can_cancel`) | ❌ | ✅ read | rows limited to the caller inside the view; the 2-hour rule is written in (`interval '2 hours'`) because a function called inside a view is checked against the reader, and the helper is closed. The health check fails if the view and the helper ever differ. |
| trigger functions `answers_sync_counts`, `questions_before_delete` | ❌ | ❌ | run by the database only |

Guard: refuses (and changes nothing) when 005 has not run (`MISSING_PREVIOUS`) or when 006 is already complete (`ALREADY_APPLIED`).
A project that ran the raw `patch_004.sql` after 005 may still run 006: it re-applies the same SQL and fixes the permissions.
The live app (older code) keeps working after 006: it never calls housekeeping and reads `scholar_slots` directly.

## 007 – Premium refund correction

| Rule | How |
|---|---|
| A refund removes only the Premium days **that payment** bought | `payments.premium_days` + `payments.subscription_id` are recorded by `activate_premium`; a refund shortens that subscription by those days. A subscription is never cancelled as a whole. |
| Other paid days stay | two payments = 60 days; refunding one leaves 30 days active |
| Admin-granted days are never removed | only the payment's own days are subtracted; extending an admin grant keeps provider `admin_grant` |
| A consultation refund never touches Premium | consultation refunds keep the 006 rule (booking cancelled / "refund due" cleared, on a full refund) |
| A repeated webhook is applied once | every refund is stored in `payment_refunds` under the provider's unique refund id |
| Partial refunds | exactly the same share of the bought time is removed, to the microsecond (no rounding). It is computed on the running total of that payment's refunds and only the difference is taken each time, so many small refunds can never remove more than the payment bought; the refunded amount can never exceed the payment; the payment becomes `refunded` when fully refunded |
| Expired / cancelled subscriptions | are never re-activated by a refund; an active one whose new end date is in the past becomes `cancelled` |
| Server only | `apply_payment_refund(payment, refund_id, amount)` and `mark_payment_refunded` (old entry point = full refund of what is left) run only with the server's service key; `payment_refunds` is closed to visitors and users |

The server (`server/payments.js`) passes Razorpay's refund id and amount from the signed `refund.processed` webhook;
`refund.failed` changes nothing. On a database without 007 it falls back to the old rule.

## 008 – Profile and settings

* `profiles.avatar_path` – optional profile photo. Files go to a new **private** bucket `avatars` (1 MB, jpeg/png/webp).
  Only the owner can upload, read (signed link) and delete files in their own folder; the path must point into that folder.
* `profiles.notify_consult` (default ON) – when switched off, consultation notifications (`type = 'consult'`) are not created
  for that person. Important account notifications (`system`) and all other types are unchanged.
* `profiles_before_update` – a display name is checked **only when it is changed**: trimmed, 1–60 characters, no invisible or
  control characters, no phone numbers / emails / links. Existing names are never rewritten.
* Nothing is removed; payments, refunds and the RLS rules of existing tables are not touched.
* The app works on a database **without** 008: the photo option and the consultation switch are simply not shown.

## Health check before 006 / 007 / 008

| Database state | Health check | Failing rows |
|---|---|---|
| 001–005 (production before this release) | **11 of 20** | 1, 2, 3, 4, 5, 9, 12, 13, 16 |
| 001–006 | **16 of 20** | 1, 3, 5, 16 (the 007 items) |
| 001–007 (production after 007) | **16 of 21** | 4, 8, 9, 16, 21 (the 008 items) |
| 001–008 | **21 of 21** | none |

## Tested (008)

| Scenario (plain and Supabase-style default privileges) | Result |
|---|---|
| Fresh project 001…008 | health check **21/21** |
| 001–007 **with data** (incl. an unusual existing name), then 008 | 16/21 → **21/21**, existing rows **unchanged**, the existing name kept exactly |
| 008 a second time | refuses `ALREADY_APPLIED`, database **unchanged** |
| 008 before 007 | refuses `MISSING_PREVIOUS`, database **unchanged** |
| An error injected just before `commit` | everything rolled back, database **unchanged**; the real file afterwards → 21/21 |
| `tests/db6.test.mjs` | 7/7 (columns, own-folder photo paths, private bucket, name checks, notification preference, no client access to trigger functions, account deletion) |

## Tested (006 + 007)

Locally (PostgreSQL 16 + Supabase stand-in, plain **and** Supabase-style default permissions; not on a real Supabase project):

| Test | Result |
|---|---|
| Fresh project 000 → 001…007 | health check **20/20** |
| 001–005 **with data** (incl. an older Premium payment), then 006, then 007 | 11/20 → 16/20 → **20/20**, **no rows lost**, the older payment is linked to its subscription |
| 006 / 007 a second time | refuse `ALREADY_APPLIED`, database **unchanged** |
| 007 before 006, 006 before 005 | refuse `MISSING_PREVIOUS`, database **unchanged** |
| An error injected just before `commit` in 006 / 007 | everything rolled back, database **unchanged**; the real file afterwards → 20/20 |
| 001–005 + raw `patch_004.sql`, then 006, 007 | **20/20** |
| App tests on a database built from 001–007 (`tests/reset-db.sh`) | database **55/55**, server **35/35**, browser **23/23** |
| Health check catches: housekeeping or refund function opened/closed for the wrong role, `payment_refunds` readable, `bookable_slots` closed, cutoff / `reel_viewed` opened | 10/10 caught |

## Adding a migration later

1. Create the next number, e.g. `008_<what>.sql`, inside `begin; … commit;`, with a guard if it must not run twice.
2. Every new function needs an explicit `revoke … from public, anon, authenticated` and then `grant execute … to <role>` **in the new
   migration itself** (as 006 and 007 do), and the matching update of `DATABASE_HEALTH_CHECK.sql` (checks 3, 12, 13, 14, 15).
3. Every new table: `enable row level security`, policies, and explicit grants; add it to the health check.
4. Test locally (`tests/reset-db.sh`, `npm run test:db`, `npm run test:e2e`) before running it on Supabase.

Example: 006 adds `consultation_housekeeping()` (logged-in users) and `consultation_cancel_cutoff()` (no direct access); 007 adds
`apply_payment_refund()` (server only). The health check lists all of them.
