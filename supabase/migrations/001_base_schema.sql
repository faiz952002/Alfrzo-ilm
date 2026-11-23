-- =====================================================================
-- Alfrzo Ilm migration 001_base_schema.sql
-- Base schema: tables, security rules (RLS), triggers, views, categories, question-images bucket
-- Source: supabase/schema.sql (content unchanged below the guard).
-- Safe-run guard added: refuses to run twice or out of order, and changes nothing when it refuses.
-- =====================================================================
begin;
do $$
begin
  if to_regclass('public.questions') is not null then raise exception 'ALREADY_APPLIED: % was already run on this project. Nothing was changed. Do not run it again - continue with the next file.', '001_base_schema.sql'; end if;
end $$;

-- =====================================================================
-- Alfrzo Ilm  -  Supabase schema (PostgreSQL + Row Level Security)
-- Run the whole file once in: Supabase Dashboard > SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id serial primary key,
  slug text unique not null,
  name_hi text not null,
  name_en text not null,
  icon text not null default '📖',
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'User' check (char_length(display_name) between 1 and 60),
  role text not null default 'user' check (role in ('user','scholar','admin')),
  language text not null default 'hi' check (language in ('hi','en')),
  default_anonymous boolean not null default true,
  notify_answers boolean not null default true,
  notify_followed boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.scholars (
  id uuid primary key references public.profiles(id) on delete cascade,
  qualifications text not null default '' check (char_length(qualifications) <= 500),
  specialties text[] not null default '{}',
  bio text not null default '' check (char_length(bio) <= 1500),
  verified boolean not null default false,
  verified_at timestamptz,
  answers_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id int references public.categories(id),
  title text not null check (char_length(title) between 10 and 200),
  body text not null default '' check (char_length(body) <= 4000),
  language text not null default 'hi' check (language in ('hi','en','ur')),
  is_anonymous boolean not null default true,
  status text not null default 'pending_review'
    check (status in ('pending_review','open','answered','rejected')),
  image_path text,
  likes_count int not null default 0,
  body_hash text,
  created_at timestamptz not null default now(),
  unique (user_id, body_hash)
);
create index if not exists questions_status_created_idx on public.questions (status, created_at desc);
create index if not exists questions_category_idx on public.questions (category_id);
create index if not exists questions_user_idx on public.questions (user_id, created_at desc);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  body text not null check (char_length(body) between 10 and 8000),
  quran_refs text not null default '' check (char_length(quran_refs) <= 1000),
  hadith_refs text not null default '' check (char_length(hadith_refs) <= 1000),
  status text not null default 'published' check (status in ('published','hidden')),
  helpful_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists answers_question_idx on public.answers (question_id);
create index if not exists answers_scholar_idx on public.answers (scholar_id, created_at desc);

create table if not exists public.question_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.answer_helpful (
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer_id uuid not null references public.answers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, answer_id)
);

create table if not exists public.saved_answers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer_id uuid not null references public.answers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, answer_id)
);

create table if not exists public.scholar_followers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, scholar_id)
);
create index if not exists scholar_followers_scholar_idx on public.scholar_followers (scholar_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('answer','followed','status','system')),
  data jsonb not null default '{}'::jsonb,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('question','answer')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null default 'premium',
  status text not null default 'inactive' check (status in ('inactive','active','cancelled','expired')),
  current_period_end timestamptz,
  provider text,
  provider_subscription_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete set null,
  amount_paise int not null check (amount_paise >= 0),
  currency text not null default 'INR',
  provider text not null,
  provider_payment_id text unique,
  status text not null check (status in ('created','paid','failed','refunded')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- HELPER FUNCTIONS
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_scholar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.scholars s join public.profiles p on p.id = s.id
    where s.id = auth.uid() and s.verified and p.role in ('scholar','admin')
  );
$$;

create or replace function public.question_is_public(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.questions where id = qid and status in ('open','answered'));
$$;

create or replace function public.contains_contact_info(t text) returns boolean
language sql immutable as $$
  select t ~ '(\+?\d[\s\-\.]?){10,}'
      or t ~* '[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}'
      or t ~* '(https?://|www\.|wa\.me|t\.me)';
$$;

-- ---------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'User'), 60));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.questions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  new.status := 'pending_review';
  new.likes_count := 0;
  new.title := trim(new.title);
  new.body := trim(new.body);
  if public.contains_contact_info(new.title || ' ' || new.body) then
    raise exception 'CONTACT_INFO: do not include phone, email or links in a public question' using errcode = 'P0001';
  end if;
  new.body_hash := md5(lower(new.title || '|' || new.body));
  select count(*) into recent from public.questions
   where user_id = new.user_id and created_at > now() - interval '1 hour';
  if recent >= 5 then
    raise exception 'RATE_LIMIT: too many questions, please try again later' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists questions_before_insert on public.questions;
create trigger questions_before_insert before insert on public.questions
  for each row execute function public.questions_before_insert();

create or replace function public.answers_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.questions where id = new.question_id and status in ('open','answered')) then
    raise exception 'QUESTION_NOT_OPEN' using errcode = 'P0001';
  end if;
  if public.contains_contact_info(new.body || ' ' || new.quran_refs || ' ' || new.hadith_refs) then
    raise exception 'CONTACT_INFO: answers must not contain phone, email or links' using errcode = 'P0001';
  end if;
  new.status := 'published';
  new.helpful_count := 0;
  return new;
end $$;
drop trigger if exists answers_before_insert on public.answers;
create trigger answers_before_insert before insert on public.answers
  for each row execute function public.answers_before_insert();

create or replace function public.answers_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.contains_contact_info(new.body || ' ' || new.quran_refs || ' ' || new.hadith_refs) then
    raise exception 'CONTACT_INFO: answers must not contain phone, email or links' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists answers_before_update on public.answers;
create trigger answers_before_update before update of body, quran_refs, hadith_refs on public.answers
  for each row execute function public.answers_before_update();

create or replace function public.answers_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; sname text;
begin
  select user_id into owner from public.questions where id = new.question_id;
  select display_name into sname from public.profiles where id = new.scholar_id;
  update public.questions set status = 'answered' where id = new.question_id and status = 'open';
  update public.scholars set answers_count = answers_count + 1 where id = new.scholar_id;

  insert into public.notifications (user_id, type, data, link)
  select owner, 'answer', jsonb_build_object('scholar', sname), '#/q/' || new.question_id
  from public.profiles p where p.id = owner and p.notify_answers;

  insert into public.notifications (user_id, type, data, link)
  select f.user_id, 'followed', jsonb_build_object('scholar', sname), '#/q/' || new.question_id
  from public.scholar_followers f join public.profiles p on p.id = f.user_id
  where f.scholar_id = new.scholar_id and p.notify_followed and f.user_id <> owner;
  return new;
end $$;
drop trigger if exists answers_after_insert on public.answers;
create trigger answers_after_insert after insert on public.answers
  for each row execute function public.answers_after_insert();

create or replace function public.bump_question_likes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.questions set likes_count = likes_count + 1 where id = new.question_id;
  else
    update public.questions set likes_count = greatest(likes_count - 1, 0) where id = old.question_id;
  end if;
  return null;
end $$;
drop trigger if exists question_likes_count on public.question_likes;
create trigger question_likes_count after insert or delete on public.question_likes
  for each row execute function public.bump_question_likes();

create or replace function public.bump_answer_helpful() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.answers set helpful_count = helpful_count + 1 where id = new.answer_id;
  else
    update public.answers set helpful_count = greatest(helpful_count - 1, 0) where id = old.answer_id;
  end if;
  return null;
end $$;
drop trigger if exists answer_helpful_count on public.answer_helpful;
create trigger answer_helpful_count after insert or delete on public.answer_helpful
  for each row execute function public.bump_answer_helpful();

-- ---------------------------------------------------------------------
-- PUBLIC VIEWS (never expose user_id / emails)
-- ---------------------------------------------------------------------
create or replace view public.question_feed as
select q.id, q.category_id, q.title, q.body, q.status, q.language, q.likes_count, q.created_at,
       (q.image_path is not null) as has_image,
       case when q.is_anonymous then null else p.display_name end as asker_name,
       (select count(*) from public.answers a where a.question_id = q.id and a.status = 'published')::int as answers_count
from public.questions q join public.profiles p on p.id = q.user_id
where q.status in ('open','answered');

create or replace view public.scholar_queue as
select q.id, q.category_id, q.title, q.body, q.status, q.language, q.created_at,
       q.image_path,
       (select count(*) from public.answers a where a.question_id = q.id)::int as answers_count
from public.questions q
where (q.status = 'open' and public.is_scholar())
   or (q.status in ('pending_review','open') and public.is_admin());

create or replace view public.scholar_directory as
select s.id, p.display_name, s.qualifications, s.specialties, s.bio, s.verified, s.answers_count,
       (select count(*) from public.scholar_followers f where f.scholar_id = s.id)::int as followers_count
from public.scholars s join public.profiles p on p.id = s.id
where s.verified;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.categories        enable row level security;
alter table public.profiles          enable row level security;
alter table public.scholars          enable row level security;
alter table public.questions         enable row level security;
alter table public.answers           enable row level security;
alter table public.question_likes    enable row level security;
alter table public.answer_helpful    enable row level security;
alter table public.saved_answers     enable row level security;
alter table public.scholar_followers enable row level security;
alter table public.notifications     enable row level security;
alter table public.reports           enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.payments          enable row level security;
alter table public.audit_logs        enable row level security;

-- categories
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select using (true);
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories for all
  using (public.is_admin()) with check (public.is_admin());

-- profiles (own row or admin; role cannot be changed by users - see column grants)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- scholars
drop policy if exists scholars_select on public.scholars;
create policy scholars_select on public.scholars for select using (id = auth.uid() or public.is_admin());
drop policy if exists scholars_update_own on public.scholars;
create policy scholars_update_own on public.scholars for update
  using (id = auth.uid()) with check (id = auth.uid());

-- questions (owner only on the base table; everyone else uses the views)
drop policy if exists questions_select_own on public.questions;
create policy questions_select_own on public.questions for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists questions_insert_own on public.questions;
create policy questions_insert_own on public.questions for insert with check (user_id = auth.uid());
drop policy if exists questions_delete_own on public.questions;
create policy questions_delete_own on public.questions for delete using (user_id = auth.uid());

-- answers
drop policy if exists answers_select on public.answers;
create policy answers_select on public.answers for select
  using (status = 'published' or scholar_id = auth.uid() or public.is_admin());
drop policy if exists answers_insert_scholar on public.answers;
create policy answers_insert_scholar on public.answers for insert
  with check (scholar_id = auth.uid() and public.is_scholar());
drop policy if exists answers_update_own on public.answers;
create policy answers_update_own on public.answers for update
  using (scholar_id = auth.uid() and public.is_scholar())
  with check (scholar_id = auth.uid() and public.is_scholar());

-- likes / helpful / saved / follow
drop policy if exists likes_select on public.question_likes;
create policy likes_select on public.question_likes for select using (user_id = auth.uid());
drop policy if exists likes_insert on public.question_likes;
create policy likes_insert on public.question_likes for insert
  with check (user_id = auth.uid() and public.question_is_public(question_id));
drop policy if exists likes_delete on public.question_likes;
create policy likes_delete on public.question_likes for delete using (user_id = auth.uid());

drop policy if exists helpful_select on public.answer_helpful;
create policy helpful_select on public.answer_helpful for select using (user_id = auth.uid());
drop policy if exists helpful_insert on public.answer_helpful;
create policy helpful_insert on public.answer_helpful for insert with check (user_id = auth.uid());
drop policy if exists helpful_delete on public.answer_helpful;
create policy helpful_delete on public.answer_helpful for delete using (user_id = auth.uid());

drop policy if exists saved_select on public.saved_answers;
create policy saved_select on public.saved_answers for select using (user_id = auth.uid());
drop policy if exists saved_insert on public.saved_answers;
create policy saved_insert on public.saved_answers for insert with check (user_id = auth.uid());
drop policy if exists saved_delete on public.saved_answers;
create policy saved_delete on public.saved_answers for delete using (user_id = auth.uid());

drop policy if exists follow_select on public.scholar_followers;
create policy follow_select on public.scholar_followers for select using (user_id = auth.uid());
drop policy if exists follow_insert on public.scholar_followers;
create policy follow_insert on public.scholar_followers for insert with check (user_id = auth.uid());
drop policy if exists follow_delete on public.scholar_followers;
create policy follow_delete on public.scholar_followers for delete using (user_id = auth.uid());

-- notifications
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete using (user_id = auth.uid());

-- reports
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (reporter_id = auth.uid());
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select using (reporter_id = auth.uid() or public.is_admin());

-- subscriptions / payments / audit (read-only from client; written only by server)
drop policy if exists subs_select on public.subscriptions;
create policy subs_select on public.subscriptions for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists pay_select on public.payments;
create policy pay_select on public.payments for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- TABLE / COLUMN PRIVILEGES (defence in depth on top of RLS)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant usage on sequence public.categories_id_seq to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, language, default_anonymous, notify_answers, notify_followed)
  on public.profiles to authenticated;

grant select on public.scholars to authenticated;
grant update (qualifications, specialties, bio) on public.scholars to authenticated;

grant select, insert, delete on public.questions to authenticated;

grant select on public.answers to anon, authenticated;
grant insert (question_id, scholar_id, body, quran_refs, hadith_refs) on public.answers to authenticated;
grant update (body, quran_refs, hadith_refs) on public.answers to authenticated;

grant select, insert, delete on public.question_likes, public.answer_helpful,
  public.saved_answers, public.scholar_followers to authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

grant select, insert on public.reports to authenticated;
grant select on public.subscriptions, public.payments, public.audit_logs to authenticated;

grant select on public.question_feed, public.scholar_directory to anon, authenticated;
grant select on public.scholar_queue to authenticated;

-- ---------------------------------------------------------------------
-- RPC FUNCTIONS (privileged actions, checked on the server)
-- ---------------------------------------------------------------------
create or replace function public.moderate_question(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid; new_status text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('open','rejected') then raise exception 'BAD_STATUS'; end if;
  new_status := p_status;
  if p_status = 'open' and exists (select 1 from public.answers where question_id = p_id) then
    new_status := 'answered';
  end if;
  update public.questions set status = new_status where id = p_id returning user_id into owner;
  if owner is null then raise exception 'NOT_FOUND'; end if;
  insert into public.notifications (user_id, type, data, link)
    values (owner, 'status', jsonb_build_object('status', new_status), '#/my-questions');
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'moderate_question', p_id::text, jsonb_build_object('status', new_status));
end $$;

create or replace function public.admin_hide_content(p_type text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_type = 'question' then
    update public.questions set status = 'rejected' where id = p_id;
  elsif p_type = 'answer' then
    update public.answers set status = 'hidden' where id = p_id;
  else
    raise exception 'BAD_TYPE';
  end if;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'hide_content', p_id::text, jsonb_build_object('type', p_type));
end $$;

create or replace function public.resolve_report(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('resolved','dismissed') then raise exception 'BAD_STATUS'; end if;
  update public.reports set status = p_status where id = p_id;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'resolve_report', p_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_make_scholar(p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'USER_NOT_FOUND'; end if;
  update public.profiles set role = 'scholar' where id = uid and role = 'user';
  insert into public.scholars (id) values (uid) on conflict (id) do nothing;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'make_scholar', uid::text);
end $$;

create or replace function public.admin_set_verified(p_id uuid, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.scholars
     set verified = p_verified, verified_at = case when p_verified then now() else null end
   where id = p_id;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'set_verified', p_id::text, jsonb_build_object('verified', p_verified));
end $$;

create or replace function public.admin_list_users() returns table (
  id uuid, email text, display_name text, role text, created_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select p.id, u.email::text, p.display_name, p.role, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at desc limit 200;
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users',      (select count(*) from public.profiles),
    'scholars',   (select count(*) from public.scholars where verified),
    'questions',  (select count(*) from public.questions),
    'pending',    (select count(*) from public.questions where status = 'pending_review'),
    'answered',   (select count(*) from public.questions where status = 'answered'),
    'answers',    (select count(*) from public.answers),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'active_subscriptions', (select count(*) from public.subscriptions where status = 'active'));
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();   -- cascades to profile and all personal data
end $$;

revoke execute on function public.moderate_question(uuid, text),
  public.admin_hide_content(text, uuid), public.resolve_report(uuid, text),
  public.admin_make_scholar(text), public.admin_set_verified(uuid, boolean),
  public.admin_list_users(), public.admin_stats(), public.delete_my_account()
  from public, anon;
grant execute on function public.moderate_question(uuid, text),
  public.admin_hide_content(text, uuid), public.resolve_report(uuid, text),
  public.admin_make_scholar(text), public.admin_set_verified(uuid, boolean),
  public.admin_list_users(), public.admin_stats(), public.delete_my_account()
  to authenticated;

-- ---------------------------------------------------------------------
-- SEED CATEGORIES
-- ---------------------------------------------------------------------
insert into public.categories (slug, name_hi, name_en, icon, sort_order) values
  ('aqeedah',       'अक़ीदा',        'Aqeedah',       '🕋', 1),
  ('namaz',         'नमाज़',         'Namaz',         '🕌', 2),
  ('roza',          'रोज़ा',         'Roza',          '🌙', 3),
  ('zakat',         'ज़कात',         'Zakat',         '💰', 4),
  ('nikah',         'निकाह',         'Nikah',         '💍', 5),
  ('family',        'फ़ैमिली',       'Family',        '👨‍👩‍👧', 6),
  ('halal-haram',   'हलाल-हराम',     'Halal-Haram',   '✅', 7),
  ('hajj',          'हज',            'Hajj',          '🕋', 8),
  ('akhlaq',        'अख़लाक़',       'Akhlaq',        '🤝', 9),
  ('quran-hadith',  'क़ुरआन व हदीस', 'Quran & Hadith','📖', 10)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- STORAGE: private bucket for optional question images (max 2 MB)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-images', 'question-images', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists qimg_insert on storage.objects;
create policy qimg_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists qimg_select on storage.objects;
create policy qimg_select on storage.objects for select to authenticated
  using (bucket_id = 'question-images'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_scholar() or public.is_admin()));
drop policy if exists qimg_delete on storage.objects;
create policy qimg_delete on storage.objects for delete to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- FIRST ADMIN (run manually once, after you have signed up in the app):
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'YOUR_EMAIL');
--   insert into public.scholars (id, verified, verified_at)
--   select id, true, now() from public.profiles where role = 'admin'
--   on conflict (id) do nothing;
-- =====================================================================

commit;
