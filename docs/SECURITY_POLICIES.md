# Alfrzo Ilm – Security Policies

**Principle:** the browser is never trusted. Every rule below is enforced inside PostgreSQL, so it holds even if someone calls the
Supabase API directly with the public key.

## 1. Who is who
| Role | Meaning |
|---|---|
| `anon` | visitor, not logged in (public anon/publishable key) |
| `authenticated` | logged-in user; `auth.uid()` is their id. Their `profiles.role` decides: `user`, `scholar`, `admin` |
| verified scholar | `role` = scholar/admin **and** `scholars.verified` **and** not suspended (`is_scholar()`) |
| admin | `profiles.role = 'admin'` (`is_admin()`); can only be set in the SQL Editor or by another admin via `admin_set_role` (which cannot create admins) |
| `service_role` | the Node server only (payments). **Never** in the browser, never in `public/` |

## 2. Guarantees (each one tested – see section 6)
1. **Users manage only their own profile**, and only the columns `display_name, language, default_anonymous, notify_answers, notify_followed`.
   `role` and `suspended` are not writable by users → **nobody can make themselves admin**.
2. **Users cannot read other users' private data:** `profiles`, `questions`, `notifications`, `payments`, `subscriptions`, likes/saves/follows are "own rows only".
3. **Private questions stay private:** never in `question_feed`; readable only by the asker, verified scholars (to answer, **without** the asker's identity) and admins. Their answers are readable by the asker, the answering scholar and admins. Followers are not notified.
4. **Only verified, non-suspended scholars can post answers**, only as themselves, only on approved (open/answered) questions; one answer per question, editable by its author.
5. **Every new question is reviewed** (`pending_review`) before anyone else sees it. Phone numbers, emails and links are rejected by the database.
6. **Chat is visible only to the two participants** (admins can read a reported conversation – stated on the privacy page). Messages only inside a *confirmed* consultation.
7. **Consultations** are visible to the client, the scholar and admins only. Prices come from the database, never from the browser.
8. **Payments** can only be marked paid by the server after verifying with Razorpay (`service_role` functions). Browsers cannot call them.
9. **Admin actions** check `is_admin()` inside every function and are written to `audit_logs`.
10. **Abuse limits**: 5 questions/hour, 20 reports/hour, 200 likes/saves/follows per hour, 120 messages/hour, 10 bookings/day, 10 reels/day.

## 3. Row Level Security
RLS is **on for all 22 tables**; 50 policies on public tables + 5 on storage. The full list per table is in
`DATABASE_ARCHITECTURE.md` section 7 and is verified by the health check (check 8).

## 4. Table / view / column permissions (exact, set by migration 005)
Anything not listed is **denied**. RLS policies then decide *which rows*.

| Kind | Object | Role | Allowed |
|---|---|---|---|
| table | `answer_helpful` | authenticated | delete, insert, select |
| column | `answers.body` | authenticated | insert, update |
| column | `answers.hadith_refs` | authenticated | insert, update |
| column | `answers.question_id` | authenticated | insert |
| column | `answers.quran_refs` | authenticated | insert, update |
| column | `answers.scholar_id` | authenticated | insert |
| table | `answers` | anon | select |
| table | `answers` | authenticated | select |
| table | `audit_logs` | authenticated | select |
| table | `categories` | anon | select |
| table | `categories` | authenticated | delete, insert, select, update |
| table | `consultation_list` | authenticated | select |
| table | `consultations` | authenticated | select |
| table | `conversation_list` | authenticated | select |
| table | `conversations` | authenticated | select |
| column | `messages.body` | authenticated | insert |
| column | `messages.conversation_id` | authenticated | insert |
| column | `messages.sender_id` | authenticated | insert |
| table | `messages` | authenticated | select |
| column | `notifications.read` | authenticated | update |
| table | `notifications` | authenticated | delete, select |
| table | `payments` | authenticated | select |
| column | `profiles.default_anonymous` | authenticated | update |
| column | `profiles.display_name` | authenticated | update |
| column | `profiles.language` | authenticated | update |
| column | `profiles.notify_answers` | authenticated | update |
| column | `profiles.notify_followed` | authenticated | update |
| table | `profiles` | authenticated | select |
| table | `question_feed` | anon | select |
| table | `question_feed` | authenticated | select |
| table | `question_likes` | authenticated | delete, insert, select |
| table | `questions` | authenticated | delete, insert, select |
| table | `reel_feed` | anon | select |
| table | `reel_feed` | authenticated | select |
| table | `reel_likes` | authenticated | delete, insert, select |
| column | `reels.caption` | authenticated | insert |
| column | `reels.category_id` | authenticated | insert |
| column | `reels.scholar_id` | authenticated | insert |
| column | `reels.video_path` | authenticated | insert |
| table | `reels` | anon | select |
| table | `reels` | authenticated | delete, select |
| table | `reports` | authenticated | insert, select |
| table | `saved_answers` | authenticated | delete, insert, select |
| column | `scholar_applications.bio` | authenticated | insert |
| column | `scholar_applications.credentials_note` | authenticated | insert |
| column | `scholar_applications.qualifications` | authenticated | insert |
| column | `scholar_applications.specialties` | authenticated | insert |
| column | `scholar_applications.user_id` | authenticated | insert |
| table | `scholar_applications` | authenticated | delete, select |
| table | `scholar_directory` | anon | select |
| table | `scholar_directory` | authenticated | select |
| table | `scholar_followers` | authenticated | delete, insert, select |
| table | `scholar_queue` | authenticated | select |
| column | `scholar_services.active` | authenticated | insert, update |
| column | `scholar_services.duration_min` | authenticated | insert, update |
| column | `scholar_services.kind` | authenticated | insert |
| column | `scholar_services.price_paise` | authenticated | insert, update |
| column | `scholar_services.scholar_id` | authenticated | insert |
| table | `scholar_services` | anon | select |
| table | `scholar_services` | authenticated | delete, select |
| column | `scholar_slots.scholar_id` | authenticated | insert |
| column | `scholar_slots.starts_at` | authenticated | insert |
| table | `scholar_slots` | anon | select |
| table | `scholar_slots` | authenticated | delete, select |
| column | `scholars.bio` | authenticated | update |
| column | `scholars.qualifications` | authenticated | update |
| column | `scholars.specialties` | authenticated | update |
| table | `scholars` | authenticated | select |
| table | `subscriptions` | authenticated | select |
| sequence | `categories_id_seq` | authenticated | usage |

## 5. Function permissions (allow-list, set by migration 005)
| Group | Visitors | Users | Server |
|---|---|---|---|
| 7 security-rule helpers | ✅ | ✅ | ✅ |
| `reel_viewed` | ✅ | ✅ | – |
| 20 app actions (admin functions check `is_admin()` inside) | ❌ | ✅ | – |
| 6 payment functions | ❌ | ❌ | ✅ |
| 3 internal functions | ❌ | ❌ | – |

All `SECURITY DEFINER` functions set `search_path = public` (or `public, auth`) explicitly.

## 6. Storage
* `question-images`: private bucket; users upload only into `<their user id>/…`; read only by owner, verified scholars, admins (signed links, 10 minutes).
* `reels`: public bucket (videos are public content); upload only verified scholars into their own folder; delete own (or admin).
* Not present (not used by the app): profile pictures, scholar documents, attachments. A future scholar-documents bucket must be **private** with admin-only read.

## 7. Evidence (local tests, PostgreSQL 16 + Supabase stand-in)
Blocked as required: visitor reading private question / questions table / messages; visitor writing to views; visitor or user calling
payment functions; user B reading user A's private question, chat or booking; user promoting themselves; user calling admin functions;
unverified scholar answering or seeing the queue.
Allowed as required: asker reads own private question; chat participant reads chat; verified scholar sees queue and answers; admin stats;
visitors read categories. Plus the app's own suites: 31 database tests and 23 browser flows.

**Known items not changed here (Phase 1, awaiting approval):** reel views can be counted by visitors without limit; consultation refund /
cancellation rules; rate-limit IP handling. See the Phase 1 plan.
