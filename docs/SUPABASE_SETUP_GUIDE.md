# Alfrzo Ilm – Supabase Setup Guide (for beginners)

Time: about 20 minutes. You only copy, paste and click **Run**. Do every step in order and stop if anything shows an `ERROR`.

## Before you start
* Decide which Supabase project the website uses. Render's `SUPABASE_URL` must point to **this same project**
  (the project ID is in the dashboard address: `supabase.com/dashboard/project/<ID>/…`).
* Use the files from GitHub branch `release-e6859de` (or the branch these migrations are published on), folder `supabase/migrations/`.
  To copy a file: open it on GitHub → **Raw** → select all → copy.

## Step 1 – Pre-flight (read-only)
1. Supabase → **SQL Editor** → **New query**.
2. Paste `000_preflight_check.sql` → **Run**.
3. For a new project every number must be **0**.
   * Not all 0? **Stop.** The project already has something in it – ask before continuing.
   * Only `auth_users` is above 0? That is fine (people signed up early); step 2 file 005 gives them profiles.

## Step 2 – Run the 5 setup files (each once, in this order)
For each file: **New query** → paste the whole file → **Run** → wait for `Success. No rows returned`.

1. `001_base_schema.sql`
2. `002_suspension_and_admin_tools.sql`
3. `003_scholar_applications_and_payments.sql`
4. `004_private_questions_consultations_chat_reels.sql`
5. `005_security_hardening.sql`

What you may see:
* A warning about "destructive operations" → the files contain `drop … if exists` for their **own** security rules. Confirm with **Run**.
* `ALREADY_APPLIED` → that file was run before. Nothing was changed. Continue with the next file.
* `MISSING_PREVIOUS` → you skipped a file. Nothing was changed. Run the file it names first.
* Any other `ERROR` → **stop**, do not continue, copy the full error text and ask.

### Project already set up with the OLD files (schema.sql + patch_001…003)?
Run the same 5 files in order anyway. 001 and 002 answer `ALREADY_APPLIED` (nothing changed), 003 and 004 re-apply safely,
005 adds the security hardening. Existing users, questions and answers are kept (tested: health check 16/20 → 20/20, no data lost).

## Step 3 – Health check (read-only)
1. **New query** → paste `supabase/DATABASE_HEALTH_CHECK.sql` → **Run**.
2. You get 20 rows plus a last row `RESULT`. **Every `ok` must be `true`**, and the last row says `20 of 20 checks passed`.
3. Any `false`? The `details` column says exactly what is wrong. Send a screenshot before changing anything.

## Step 4 – Authentication settings
1. **Authentication → URL Configuration**
   * **Site URL:** `https://alfrzo-ilm.onrender.com`
   * **Redirect URLs:** add `https://alfrzo-ilm.onrender.com/reset`
2. **Authentication → Sign In / Providers → Email:** enabled, "Confirm email" on.

## Step 5 – Connect the website (Render)
Render → service → **Environment**: `SUPABASE_URL` and `SUPABASE_ANON_KEY` must be this project's values
(see `ENVIRONMENT_VARIABLES.md`). If you changed them: **Save** → deploy (your approval).

## Step 6 – Test the website
1. Open the site: categories show, no "Could not load data".
2. **Sign up** with your email, click the confirmation email, log in.
3. Make yourself admin – SQL Editor (replace the email):
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```
4. Log out and in again → Profile shows **Admin panel**.
5. Ask a test question → it appears in Admin → moderation → approve → it shows on the home page.

## Never do this
* Never run the old `supabase/schema.sql` or `patch_001.sql` a second time (use the migrations folder – it protects you).
* Never put the `service_role` / `sb_secret_…` key in the website or share it in chat.
* Never run "fix" SQL from the internet on the live project without testing it first.
