-- =====================================================================
-- Alfrzo Ilm migration 002_suspension_and_admin_tools.sql
-- Fixes, account suspension, premium priority, admin tools (was patch_001.sql)
-- Source: supabase/patch_001.sql (content unchanged below the guard).
-- Safe-run guard added: refuses to run twice or out of order, and changes nothing when it refuses.
-- =====================================================================
-- =====================================================================
-- Alfrzo Ilm - patch 001 (run AFTER schema.sql, safe to re-run)
-- Fixes found while testing schema.sql on a real PostgreSQL, and adds the
-- pieces the app needs (suspension, premium priority, admin helpers).
-- =====================================================================

begin;
do $$
begin
  if to_regclass('public.questions') is null then raise exception 'MISSING_PREVIOUS: run % first. Nothing was changed.', '001_base_schema.sql'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'suspended') then raise exception 'ALREADY_APPLIED: % was already run on this project. Nothing was changed. Do not run it again - continue with the next file.', '002_suspension_and_admin_tools.sql'; end if;
end $$;

-- 1) BUG: payments.user_id was NOT NULL but FK is "on delete set null",
--    so deleting an account that had any payment record FAILED.
--    Payment records must be kept (accounting) but detached from the person.
alter table public.payments alter column user_id drop not null;

-- 2) BUG: answers of a rejected/hidden question stayed publicly readable.
drop policy if exists answers_select on public.answers;
create policy answers_select on public.answers for select
  using ((status = 'published' and public.question_is_public(question_id))
         or scholar_id = auth.uid() or public.is_admin());

-- 3) One answer per scholar per question (scholars edit instead of re-posting).
create unique index if not exists answers_one_per_scholar on public.answers (question_id, scholar_id);

-- 4) Suspension (admin can block abusive users / scholars)
alter table public.profiles add column if not exists suspended boolean not null default false;
revoke update on public.profiles from authenticated;
grant update (display_name, language, default_anonymous, notify_answers, notify_followed)
  on public.profiles to authenticated;                       -- suspended/role stay admin-only

create or replace function public.is_scholar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.scholars s join public.profiles p on p.id = s.id
    where s.id = auth.uid() and s.verified and not p.suspended and p.role in ('scholar','admin')
  );
$$;

-- 5) Questions: also block suspended users and foreign image paths
create or replace function public.questions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  if exists (select 1 from public.profiles where id = new.user_id and suspended) then
    raise exception 'SUSPENDED: this account is suspended' using errcode = 'P0001';
  end if;
  if new.image_path is not null and split_part(new.image_path, '/', 1) <> new.user_id::text then
    raise exception 'BAD_IMAGE_PATH' using errcode = 'P0001';
  end if;
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

-- 6) Abuse limit for reports (max 20 / hour / user)
create or replace function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.reports where reporter_id = new.reporter_id
        and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'RATE_LIMIT: too many reports' using errcode = 'P0001';
  end if;
  new.status := 'open';
  return new;
end $$;
drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

-- 7) Premium = priority answers. Scholars see a flag, never an identity.
create or replace function public.is_premium(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions
                 where user_id = uid and status = 'active'
                   and (current_period_end is null or current_period_end > now()));
$$;
revoke execute on function public.is_premium(uuid) from public, anon, authenticated;

create or replace view public.scholar_queue as
select q.id, q.category_id, q.title, q.body, q.status, q.language, q.created_at,
       q.image_path,
       (select count(*) from public.answers a where a.question_id = q.id)::int as answers_count,
       exists (select 1 from public.subscriptions s where s.user_id = q.user_id and s.status = 'active'
               and (s.current_period_end is null or s.current_period_end > now())) as is_premium
from public.questions q
where (q.status = 'open' and public.is_scholar())
   or (q.status in ('pending_review','open') and public.is_admin());
grant select on public.scholar_queue to authenticated;

-- 8) Admin helpers (every one is checked server-side and written to audit_logs)
create or replace function public.admin_set_role(p_id uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_role not in ('user','scholar') then raise exception 'BAD_ROLE'; end if;
  if p_id = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;
  if (select role from public.profiles where id = p_id) = 'admin' then raise exception 'CANNOT_CHANGE_ADMIN'; end if;
  update public.profiles set role = p_role where id = p_id;
  if p_role = 'scholar' then insert into public.scholars (id) values (p_id) on conflict (id) do nothing;
  else update public.scholars set verified = false, verified_at = null where id = p_id; end if;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'set_role', p_id::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_set_suspended(p_id uuid, p_suspended boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_id = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;
  if (select role from public.profiles where id = p_id) = 'admin' then raise exception 'CANNOT_CHANGE_ADMIN'; end if;
  update public.profiles set suspended = p_suspended where id = p_id;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'set_suspended', p_id::text, jsonb_build_object('suspended', p_suspended));
end $$;

-- Manual premium grant/revoke for support (NOT a payment; provider = 'admin_grant')
create or replace function public.admin_set_premium(p_id uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_days is null or p_days < 0 or p_days > 3650 then raise exception 'BAD_DAYS'; end if;
  update public.subscriptions set status = 'cancelled' where user_id = p_id and status = 'active';
  if p_days > 0 then
    insert into public.subscriptions (user_id, plan, status, current_period_end, provider)
      values (p_id, 'premium', 'active', now() + make_interval(days => p_days), 'admin_grant');
    insert into public.notifications (user_id, type, data, link)
      values (p_id, 'system', jsonb_build_object('msg', 'premium_granted'), '#/premium');
  end if;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'set_premium', p_id::text, jsonb_build_object('days', p_days));
end $$;

drop function if exists public.admin_list_users();
create or replace function public.admin_list_users() returns table (
  id uuid, email text, display_name text, role text, created_at timestamptz,
  suspended boolean, verified boolean, premium boolean)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select p.id, u.email::text, p.display_name, p.role, p.created_at, p.suspended,
           coalesce(s.verified, false), public.is_premium(p.id)
    from public.profiles p join auth.users u on u.id = p.id
    left join public.scholars s on s.id = p.id
    order by p.created_at desc limit 300;
end $$;

-- Admin overview of everything waiting for a decision / recent reports with content
create or replace function public.admin_reports() returns table (
  id uuid, target_type text, target_id uuid, reason text, status text, created_at timestamptz, snippet text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at,
           left(case r.target_type
             when 'question' then (select q.title from public.questions q where q.id = r.target_id)
             else (select a.body from public.answers a where a.id = r.target_id) end, 220)
    from public.reports r order by (r.status = 'open') desc, r.created_at desc limit 200;
end $$;

drop function if exists public.admin_stats();
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
    'active_subscriptions', (select count(*) from public.subscriptions where status = 'active'),
    'questions_7d', (select count(*) from public.questions where created_at > now() - interval '7 days'),
    'answers_7d',   (select count(*) from public.answers where created_at > now() - interval '7 days'),
    'revenue_paise', (select coalesce(sum(amount_paise),0) from public.payments where status = 'paid'));
end $$;

revoke execute on function public.admin_set_role(uuid, text), public.admin_set_suspended(uuid, boolean),
  public.admin_set_premium(uuid, int), public.admin_list_users(), public.admin_reports(), public.admin_stats()
  from public, anon;
grant execute on function public.admin_set_role(uuid, text), public.admin_set_suspended(uuid, boolean),
  public.admin_set_premium(uuid, int), public.admin_list_users(), public.admin_reports(), public.admin_stats()
  to authenticated;

-- 9) Subscriptions: one active row per user (server upserts on payment)
create unique index if not exists subscriptions_one_active on public.subscriptions (user_id) where status = 'active';

commit;
