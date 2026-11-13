-- =====================================================================
-- Alfrzo Ilm migration 003_scholar_applications_and_payments.sql
-- Scholar applications, server-only payment functions, abuse limits (was patch_002.sql)
-- Source: supabase/patch_002.sql (content unchanged below the guard).
-- Safe-run guard added: refuses to run twice or out of order, and changes nothing when it refuses.
-- =====================================================================
-- =====================================================================
-- Alfrzo Ilm - patch 002 (run AFTER schema.sql and patch_001.sql, safe to re-run)
--   1. Scholar applications  (user applies -> admin verifies credentials -> becomes verified scholar)
--   2. Server-only payment functions (the browser can NEVER mark a payment as paid)
--   3. Abuse limits for likes / helpful / follows, contact-info guard for scholar profiles
--   4. Admin helpers: list scholars / list applications
-- =====================================================================

begin;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'suspended') then raise exception 'MISSING_PREVIOUS: run % first. Nothing was changed.', '002_suspension_and_admin_tools.sql'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) SCHOLAR APPLICATIONS
-- ---------------------------------------------------------------------
create table if not exists public.scholar_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  qualifications text not null check (char_length(qualifications) between 5 and 500),
  specialties text[] not null default '{}' check (cardinality(specialties) <= 10 and char_length(array_to_string(specialties, ',')) <= 400),
  bio text not null default '' check (char_length(bio) <= 1500),
  credentials_note text not null default '' check (char_length(credentials_note) <= 1000),  -- PRIVATE: only the admin sees it
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 500),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists scholar_applications_one_pending on public.scholar_applications (user_id) where status = 'pending';
create index if not exists scholar_applications_status_idx on public.scholar_applications (status, created_at desc);

alter table public.scholar_applications enable row level security;
drop policy if exists sapp_select on public.scholar_applications;
create policy sapp_select on public.scholar_applications for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists sapp_insert on public.scholar_applications;
create policy sapp_insert on public.scholar_applications for insert with check (user_id = auth.uid());
drop policy if exists sapp_delete on public.scholar_applications;
create policy sapp_delete on public.scholar_applications for delete using (user_id = auth.uid() and status = 'pending');

revoke all on public.scholar_applications from anon, authenticated;
grant select, delete on public.scholar_applications to authenticated;
grant insert (user_id, qualifications, specialties, bio, credentials_note) on public.scholar_applications to authenticated;

create or replace function public.scholar_applications_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and suspended) then
    raise exception 'SUSPENDED: this account is suspended' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.scholars where id = new.user_id) then
    raise exception 'ALREADY_SCHOLAR' using errcode = 'P0001';
  end if;
  if (select count(*) from public.scholar_applications
        where user_id = new.user_id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'RATE_LIMIT: too many applications, try again tomorrow' using errcode = 'P0001';
  end if;
  -- qualifications / bio become PUBLIC if approved, so no phone / email / links there
  if public.contains_contact_info(new.qualifications || ' ' || new.bio || ' ' || array_to_string(new.specialties, ' ')) then
    raise exception 'CONTACT_INFO: public profile text must not contain phone, email or links' using errcode = 'P0001';
  end if;
  new.status := 'pending'; new.admin_note := null; new.reviewed_by := null; new.reviewed_at := null;
  new.qualifications := trim(new.qualifications); new.bio := trim(new.bio);
  return new;
end $$;
drop trigger if exists scholar_applications_before_insert on public.scholar_applications;
create trigger scholar_applications_before_insert before insert on public.scholar_applications
  for each row execute function public.scholar_applications_before_insert();

-- Approve = the admin has checked the credentials: user becomes a VERIFIED scholar.
create or replace function public.admin_review_application(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare app public.scholar_applications;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into app from public.scholar_applications where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if app.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  if p_approve then
    update public.profiles set role = 'scholar' where id = app.user_id and role = 'user';
    insert into public.scholars (id, qualifications, specialties, bio, verified, verified_at)
      values (app.user_id, app.qualifications, app.specialties, app.bio, true, now())
      on conflict (id) do update
        set qualifications = excluded.qualifications, specialties = excluded.specialties, bio = excluded.bio,
            verified = true, verified_at = now();
  end if;

  update public.scholar_applications
     set status = case when p_approve then 'approved' else 'rejected' end,
         admin_note = nullif(trim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  insert into public.notifications (user_id, type, data, link)
    values (app.user_id, 'system',
            jsonb_build_object('msg', case when p_approve then 'scholar_approved' else 'scholar_rejected' end),
            case when p_approve then '#/dashboard' else '#/become-scholar' end);
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'review_application', p_id::text, jsonb_build_object('approved', p_approve));
end $$;

create or replace function public.admin_list_applications() returns table (
  id uuid, user_id uuid, display_name text, email text, qualifications text, specialties text[], bio text,
  credentials_note text, status text, admin_note text, created_at timestamptz, reviewed_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select a.id, a.user_id, p.display_name, u.email::text, a.qualifications, a.specialties, a.bio,
           a.credentials_note, a.status, a.admin_note, a.created_at, a.reviewed_at
    from public.scholar_applications a
    join public.profiles p on p.id = a.user_id
    join auth.users u on u.id = a.user_id
    order by (a.status = 'pending') desc, a.created_at desc limit 200;
end $$;

create or replace function public.admin_list_scholars() returns table (
  id uuid, display_name text, email text, qualifications text, specialties text[], bio text,
  verified boolean, answers_count int, suspended boolean, role text)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select s.id, p.display_name, u.email::text, s.qualifications, s.specialties, s.bio,
           s.verified, s.answers_count, p.suspended, p.role
    from public.scholars s
    join public.profiles p on p.id = s.id
    join auth.users u on u.id = s.id
    order by s.verified asc, s.created_at desc limit 300;
end $$;

-- Scholars can edit their own profile text, but never put contact details into it.
create or replace function public.scholars_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.contains_contact_info(new.qualifications || ' ' || new.bio || ' ' || array_to_string(new.specialties, ' ')) then
    raise exception 'CONTACT_INFO: profile text must not contain phone, email or links' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists scholars_before_update on public.scholars;
create trigger scholars_before_update before update of qualifications, specialties, bio on public.scholars
  for each row execute function public.scholars_before_update();

revoke execute on function public.admin_review_application(uuid, boolean, text), public.admin_list_applications(),
  public.admin_list_scholars() from public, anon;
grant execute on function public.admin_review_application(uuid, boolean, text), public.admin_list_applications(),
  public.admin_list_scholars() to authenticated;

-- ---------------------------------------------------------------------
-- 2) PAYMENTS - only the trusted server (service_role) may call these
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists provider_order_id text;
create unique index if not exists payments_provider_order_uidx on public.payments (provider_order_id) where provider_order_id is not null;
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

-- Called when the server has created an order at the payment provider.
create or replace function public.record_payment_order(p_user uuid, p_order text, p_amount int, p_currency text, p_provider text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
  if exists (select 1 from public.profiles where id = p_user and suspended) then raise exception 'SUSPENDED'; end if;
  insert into public.payments (user_id, amount_paise, currency, provider, provider_order_id, status)
    values (p_user, p_amount, p_currency, p_provider, p_order, 'created')
    on conflict (provider_order_id) where provider_order_id is not null do nothing;
end $$;

-- Called ONLY after the server has verified the signature and re-fetched the payment from the provider.
-- Idempotent: calling it twice for the same order never extends premium twice.
create or replace function public.activate_premium(p_user uuid, p_order text, p_payment text, p_amount int,
                                                  p_currency text, p_provider text, p_days int default 30) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare pay public.payments; sub public.subscriptions; new_end timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'BAD_DAYS'; end if;
  select * into pay from public.payments where provider_order_id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if pay.user_id is distinct from p_user then raise exception 'USER_MISMATCH' using errcode = 'P0001'; end if;
  if pay.amount_paise <> p_amount or pay.currency <> p_currency then raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001'; end if;
  if pay.status = 'refunded' then raise exception 'ALREADY_REFUNDED' using errcode = 'P0001'; end if;
  if pay.status = 'paid' then
    select current_period_end into new_end from public.subscriptions where user_id = p_user and status = 'active' limit 1;
    return new_end;
  end if;

  update public.payments set status = 'paid', provider_payment_id = p_payment where id = pay.id;

  select * into sub from public.subscriptions where user_id = p_user and status = 'active' for update;
  if found then
    new_end := greatest(coalesce(sub.current_period_end, now()), now()) + make_interval(days => p_days);
    update public.subscriptions set current_period_end = new_end, provider = p_provider where id = sub.id;
  else
    new_end := now() + make_interval(days => p_days);
    insert into public.subscriptions (user_id, plan, status, current_period_end, provider, provider_subscription_id)
      values (p_user, 'premium', 'active', new_end, p_provider, p_order);
  end if;

  insert into public.notifications (user_id, type, data, link)
    values (p_user, 'system', jsonb_build_object('msg', 'premium_activated'), '#/premium');
  insert into public.audit_logs (actor_id, action, target, meta)
    values (null, 'premium_payment', p_user::text, jsonb_build_object('order', p_order, 'amount_paise', p_amount, 'days', p_days));
  return new_end;
end $$;

create or replace function public.fail_payment(p_order text, p_payment text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payments set status = 'failed', provider_payment_id = coalesce(provider_payment_id, p_payment)
   where provider_order_id = p_order and status = 'created';
end $$;

create or replace function public.mark_payment_refunded(p_payment text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  update public.payments set status = 'refunded' where provider_payment_id = p_payment and status = 'paid' returning user_id into uid;
  if uid is not null then
    update public.subscriptions set status = 'cancelled' where user_id = uid and status = 'active' and provider <> 'admin_grant';
    insert into public.audit_logs (actor_id, action, target, meta)
      values (null, 'payment_refunded', uid::text, jsonb_build_object('payment', p_payment));
  end if;
end $$;

revoke execute on function public.record_payment_order(uuid, text, int, text, text),
  public.activate_premium(uuid, text, text, int, text, text, int),
  public.fail_payment(text, text), public.mark_payment_refunded(text) from public, anon, authenticated;
grant execute on function public.record_payment_order(uuid, text, int, text, text),
  public.activate_premium(uuid, text, text, int, text, text, int),
  public.fail_payment(text, text), public.mark_payment_refunded(text) to service_role;

-- ---------------------------------------------------------------------
-- 3) ABUSE LIMITS (200 actions / hour / user) for like / helpful / follow / save
-- ---------------------------------------------------------------------
create or replace function public.limit_user_actions() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  execute format('select count(*) from public.%I where user_id = $1 and created_at > now() - interval ''1 hour''', tg_table_name)
    into n using new.user_id;
  if n >= 200 then raise exception 'RATE_LIMIT: too many actions, slow down' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists question_likes_limit on public.question_likes;
create trigger question_likes_limit before insert on public.question_likes for each row execute function public.limit_user_actions();
drop trigger if exists answer_helpful_limit on public.answer_helpful;
create trigger answer_helpful_limit before insert on public.answer_helpful for each row execute function public.limit_user_actions();
drop trigger if exists saved_answers_limit on public.saved_answers;
create trigger saved_answers_limit before insert on public.saved_answers for each row execute function public.limit_user_actions();
drop trigger if exists scholar_followers_limit on public.scholar_followers;
create trigger scholar_followers_limit before insert on public.scholar_followers for each row execute function public.limit_user_actions();

commit;
