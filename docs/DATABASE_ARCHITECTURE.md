# Alfrzo Ilm – Database Architecture

Backend: **Supabase** (PostgreSQL + Row Level Security + Auth + Storage).
This document describes the database built by `supabase/migrations/001`–`005` for the code on branch `release-e6859de`.
Everything here was checked against the actual app code (38 browser files, 6 server files): **269 column references, 0 mismatches**.

## 1. How the pieces fit together

```
Browser (public/js)  ──anon / user JWT──►  Supabase REST (PostgREST) ──► tables & views, protected by RLS
        │                                   Supabase Auth  (signup, login, reset, email confirm)
        │                                   Supabase Storage (question-images, reels)
        └──► Node server (server/) ──service_role key (server only)──► payment functions
```
* The browser only ever uses the **public anon/publishable key**. Every permission is enforced **inside the database** (RLS policies, column grants, function allow-list), never by hiding buttons.
* The **server** uses the secret `service_role` key only for payments (6 functions) and reads `question_feed` with the anon key for SEO.

## 2. Modules → tables

| Module | Tables | Views / functions |
|---|---|---|
| Users & accounts | `profiles` (role, language, privacy & notification settings, `suspended`) | `delete_my_account()`, trigger `on_auth_user_created` creates the profile |
| Categories | `categories` (10 seeded, admins can add/edit) | – |
| Questions | `questions` (public/private, anonymous, status, optional image) | `question_feed` (public, never shows who asked), `question_is_public()` |
| Scholars | `scholars`, `scholar_applications`, `scholar_followers` | `scholar_directory`, `scholar_queue`, `is_scholar()`, admin review functions |
| Answers | `answers` (Quran/Hadith references, published/hidden, one per scholar per question) | triggers keep counts & send notifications |
| Interactions | `question_likes`, `answer_helpful`, `saved_answers`, `reports` | abuse limits (200 actions/hour) |
| Notifications | `notifications` | created by triggers / functions only |
| Consultations | `scholar_services`, `scholar_slots`, `consultations` | `consultation_list`, `book_consultation()`, `cancel_consultation()`, `complete_consultation()` |
| Chat | `conversations`, `messages` | `conversation_list`, `mark_conversation_read()`; contact details blocked |
| Reels | `reels`, `reel_likes` | `reel_feed`, `reel_viewed()` |
| Payments (optional) | `payments`, `subscriptions` | 6 **server-only** functions; Premium + paid consultations |
| Admin | `audit_logs` (every admin action) | 13 `admin_*` functions + `moderate_question`, `resolve_report` (each checks `is_admin()` inside) |

## 3. Requested modules that the current app does NOT use (not built – on purpose)

The task asked to build modules "wherever required by the existing application". These are **not used anywhere in the app code**, so adding tables for them now would create unused, untested parts. They are listed for a later phase, where database **and** screens are built together:

| Requested | Current app | Status |
|---|---|---|
| Profile pictures (`profile-images` bucket) | avatars are drawn from the name's first letter | not built – needs upload screen |
| Comments (questions, reels) | none | not built |
| Question views count, question history | none | not built |
| Mufti / Maulana / Alim / Alima titles, scholar availability calendar | free-text `qualifications`, `specialties`; consultation time slots exist | not built – titles planned for Phase 2 |
| Scholar documents (`scholar-documents` bucket) | application has a private text field `credentials_note` (only admins see it) | not built – needs a private bucket + upload screen |
| Answer approval workflow, source references | answers publish immediately (verified scholars only); admins can hide; Quran + Hadith reference fields | not built |
| Message attachments, reel thumbnails, `answer-attachments` bucket | none | not built |
| Categories Fiqh / Islamic History / General | 10 seeded categories (artwork in the app is drawn per category) | admins can **add** categories from the admin panel – no migration needed |
| `updated_at` on every table | only `answers` has it (the app only edits answers) | not added |

## 4. Views (what the app reads)

| View | Who | Purpose |
|---|---|---|
| `question_feed` | everyone | published **public** questions; asker name only if not anonymous; never `user_id` |
| `scholar_directory` | everyone | verified scholars with follower count |
| `scholar_queue` | verified scholars, admins | questions to answer / moderate (Premium flag, never the asker) |
| `consultation_list` | the two participants, admins | bookings |
| `conversation_list` | the two participants | chat inbox with unread counts |
| `reel_feed` | everyone | published reels of verified, non-suspended scholars |

## 5. Functions (37) – who may run them
| Group | Functions | Allowed for |
|---|---|---|
| Security-rule helpers (7) | `is_admin`, `is_scholar`, `question_is_public`, `question_owned_by_me`, `scholar_is_verified`, `conversation_role`, `conversation_open` | visitors, users |
| App actions (20) | 13 `admin_*`, `moderate_question`, `resolve_report`, `book_consultation`, `cancel_consultation`, `complete_consultation`, `delete_my_account`, `mark_conversation_read` | logged-in users (each checks rights inside) |
| Reel views (1) | `reel_viewed` | visitors, users |
| Payments (6) | `record_payment_order`, `activate_premium`, `record_consultation_order`, `confirm_consultation_payment`, `fail_payment`, `mark_payment_refunded` | **server only** (`service_role`) |
| Internal (3) | `confirm_consultation_internal`, `contains_contact_info`, `is_premium` | nobody directly |
| Triggers (15) | counts, notifications, contact-info and rate-limit checks, new-user profile | fired by the database |

## 6. Storage
| Bucket | Access | Limit | Types | Policies |
|---|---|---|---|---|
| `question-images` | **private**; signed links only for the asker, verified scholars, admins | 2 MB | jpeg, png, webp | upload/delete only into own folder |
| `reels` | public (videos are meant to be watched) | 30 MB | mp4, webm | upload only verified scholars into own folder; delete own or admin |

## 7. Table reference (generated from the tested database)
### `answer_helpful`
- **Columns** (`?` = optional): user_id uuid, answer_id uuid, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (user_id, answer_id)
- **References:** answer_id → answers (on delete cascade); user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** helpful_delete (DELETE), helpful_insert (INSERT), helpful_select (SELECT)

### `answers`
- **Columns** (`?` = optional): id uuid, question_id uuid, scholar_id uuid, body text, quran_refs text, hadith_refs text, status text, helpful_count integer, created_at timestamp with time zone, updated_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** question_id → questions (on delete cascade); scholar_id → scholars (on delete cascade)
- **Unique:** -
- **RLS policies:** answers_insert_scholar (INSERT), answers_select (SELECT), answers_update_own (UPDATE)

### `audit_logs`
- **Columns** (`?` = optional): id bigint, actor_id uuid?, action text, target text?, meta jsonb, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** -
- **Unique:** -
- **RLS policies:** audit_select (SELECT)

### `categories`
- **Columns** (`?` = optional): id integer, slug text, name_hi text, name_en text, icon text, sort_order integer, active boolean
- **Primary key:** PRIMARY KEY (id)
- **References:** -
- **Unique:** UNIQUE (slug)
- **RLS policies:** categories_admin_write (ALL), categories_read (SELECT)

### `consultations`
- **Columns** (`?` = optional): id uuid, user_id uuid, scholar_id uuid, slot_id uuid?, kind text, price_paise integer, duration_min integer, starts_at timestamp with time zone, topic text, status text, meeting_room text?, refund_due boolean, cancelled_by uuid?, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** scholar_id → scholars (on delete cascade); slot_id → scholar_slots (on delete set null); user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** consult_select (SELECT)

### `conversations`
- **Columns** (`?` = optional): id uuid, consultation_id uuid, user_id uuid, scholar_id uuid, last_message_at timestamp with time zone?, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** consultation_id → consultations (on delete cascade); scholar_id → scholars (on delete cascade); user_id → profiles (on delete cascade)
- **Unique:** UNIQUE (consultation_id)
- **RLS policies:** conv_select (SELECT)

### `messages`
- **Columns** (`?` = optional): id uuid, conversation_id uuid, sender_id uuid, body text, read_at timestamp with time zone?, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** conversation_id → conversations (on delete cascade); sender_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** msg_insert (INSERT), msg_select (SELECT)

### `notifications`
- **Columns** (`?` = optional): id uuid, user_id uuid, type text, data jsonb, link text?, read boolean, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** notif_delete (DELETE), notif_select (SELECT), notif_update (UPDATE)

### `payments`
- **Columns** (`?` = optional): id uuid, user_id uuid?, amount_paise integer, currency text, provider text, provider_payment_id text?, status text, created_at timestamp with time zone, provider_order_id text?, purpose text, ref_id uuid?
- **Primary key:** PRIMARY KEY (id)
- **References:** user_id → profiles (on delete set null)
- **Unique:** UNIQUE (provider_payment_id)
- **RLS policies:** pay_select (SELECT)

### `profiles`
- **Columns** (`?` = optional): id uuid, display_name text, role text, language text, default_anonymous boolean, notify_answers boolean, notify_followed boolean, created_at timestamp with time zone, suspended boolean
- **Primary key:** PRIMARY KEY (id)
- **References:** id → users (on delete cascade)
- **Unique:** -
- **RLS policies:** profiles_select (SELECT), profiles_update_own (UPDATE)

### `question_likes`
- **Columns** (`?` = optional): user_id uuid, question_id uuid, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (user_id, question_id)
- **References:** question_id → questions (on delete cascade); user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** likes_delete (DELETE), likes_insert (INSERT), likes_select (SELECT)

### `questions`
- **Columns** (`?` = optional): id uuid, user_id uuid, category_id integer?, title text, body text, language text, is_anonymous boolean, status text, image_path text?, likes_count integer, body_hash text?, created_at timestamp with time zone, visibility text
- **Primary key:** PRIMARY KEY (id)
- **References:** category_id → categories (on delete no action); user_id → profiles (on delete cascade)
- **Unique:** UNIQUE (user_id, body_hash)
- **RLS policies:** questions_delete_own (DELETE), questions_insert_own (INSERT), questions_select_own (SELECT)

### `reel_likes`
- **Columns** (`?` = optional): reel_id uuid, user_id uuid, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (reel_id, user_id)
- **References:** reel_id → reels (on delete cascade); user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** reel_likes_delete (DELETE), reel_likes_insert (INSERT), reel_likes_select (SELECT)

### `reels`
- **Columns** (`?` = optional): id uuid, scholar_id uuid, video_path text, caption text, category_id integer?, status text, likes_count integer, views_count integer, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** category_id → categories (on delete set null); scholar_id → scholars (on delete cascade)
- **Unique:** -
- **RLS policies:** reels_delete (DELETE), reels_insert (INSERT), reels_select (SELECT)

### `reports`
- **Columns** (`?` = optional): id uuid, reporter_id uuid, target_type text, target_id uuid, reason text, status text, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** reporter_id → profiles (on delete cascade)
- **Unique:** UNIQUE (reporter_id, target_type, target_id)
- **RLS policies:** reports_insert (INSERT), reports_select (SELECT)

### `saved_answers`
- **Columns** (`?` = optional): user_id uuid, answer_id uuid, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (user_id, answer_id)
- **References:** answer_id → answers (on delete cascade); user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** saved_delete (DELETE), saved_insert (INSERT), saved_select (SELECT)

### `scholar_applications`
- **Columns** (`?` = optional): id uuid, user_id uuid, qualifications text, specialties text[], bio text, credentials_note text, status text, admin_note text?, reviewed_by uuid?, reviewed_at timestamp with time zone?, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** reviewed_by → profiles (on delete set null); user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** sapp_delete (DELETE), sapp_insert (INSERT), sapp_select (SELECT)

### `scholar_followers`
- **Columns** (`?` = optional): user_id uuid, scholar_id uuid, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (user_id, scholar_id)
- **References:** scholar_id → scholars (on delete cascade); user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** follow_delete (DELETE), follow_insert (INSERT), follow_select (SELECT)

### `scholar_services`
- **Columns** (`?` = optional): id uuid, scholar_id uuid, kind text, price_paise integer, duration_min integer, active boolean
- **Primary key:** PRIMARY KEY (id)
- **References:** scholar_id → scholars (on delete cascade)
- **Unique:** UNIQUE (scholar_id, kind)
- **RLS policies:** svc_select (SELECT), svc_write (ALL)

### `scholar_slots`
- **Columns** (`?` = optional): id uuid, scholar_id uuid, starts_at timestamp with time zone, status text, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** scholar_id → scholars (on delete cascade)
- **Unique:** UNIQUE (scholar_id, starts_at)
- **RLS policies:** slot_delete (DELETE), slot_insert (INSERT), slot_select (SELECT)

### `scholars`
- **Columns** (`?` = optional): id uuid, qualifications text, specialties text[], bio text, verified boolean, verified_at timestamp with time zone?, answers_count integer, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** scholars_select (SELECT), scholars_update_own (UPDATE)

### `subscriptions`
- **Columns** (`?` = optional): id uuid, user_id uuid, plan text, status text, current_period_end timestamp with time zone?, provider text?, provider_subscription_id text?, created_at timestamp with time zone
- **Primary key:** PRIMARY KEY (id)
- **References:** user_id → profiles (on delete cascade)
- **Unique:** -
- **RLS policies:** subs_select (SELECT)

