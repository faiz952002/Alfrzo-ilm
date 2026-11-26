-- =====================================================================
-- Alfrzo Ilm migration 007_premium_refund_correction.sql
-- Premium refunds remove ONLY the days that the refunded payment bought.
--   * every Premium payment records how many days it bought and which subscription it extended
--     (payments.premium_days, payments.subscription_id) - a reliable payment-to-subscription record
--   * every refund is recorded once, by the provider's refund id (new table payment_refunds), so a
--     repeated webhook never applies a refund twice; refunds of one payment can never exceed its amount
--   * partial refunds remove exactly the same share of the bought time (to the microsecond, no rounding),
--     computed on the running total of refunds, so many small refunds never remove more than the payment bought
--   * a refund never cancels a whole subscription: other paid days and admin-granted days stay;
--     only when the remaining end date is already in the past does the subscription end
--   * an expired / cancelled subscription is never re-activated by a refund
--   * consultation refunds keep their own rule (006) and never touch Premium
-- Run AFTER 006. Safe-run guard: refuses to run before 006 or a second time, and changes nothing when it refuses.
-- Nothing is deleted. Payments stay OFF until the owner configures the payment keys on the server.
-- =====================================================================
begin;
do $$
begin
  if to_regclass('public.reel_views') is null
     or to_regprocedure('public.consultation_cancel_cutoff()') is null
     or has_function_privilege('anon', 'public.consultation_cancel_cutoff()', 'execute') then
    raise exception 'MISSING_PREVIOUS: run % first. Nothing was changed.', '006_phase1_fixes.sql';
  end if;
  if to_regclass('public.payment_refunds') is not null
     and to_regprocedure('public.apply_payment_refund(text,text,integer)') is not null then
    raise exception 'ALREADY_APPLIED: % was already run on this project. Nothing was changed. Do not run it again.', '007_premium_refund_correction.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) payment-to-subscription record
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists premium_days int check (premium_days is null or premium_days between 1 and 366);
alter table public.payments add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null;
alter table public.payments add column if not exists refunded_paise int not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_refunded_le_amount') then
    alter table public.payments add constraint payments_refunded_le_amount check (refunded_paise >= 0 and refunded_paise <= amount_paise);
  end if;
end $$;
create index if not exists payments_subscription_idx on public.payments (subscription_id) where subscription_id is not null;

-- every refund, once (provider refund id is unique)
create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider_refund_id text not null unique check (char_length(provider_refund_id) between 1 and 100),
  amount_paise int not null check (amount_paise > 0),
  time_removed interval not null default '0' check (time_removed >= interval '0'),
  created_at timestamptz not null default now()
);
create index if not exists payment_refunds_payment_idx on public.payment_refunds (payment_id);
alter table public.payment_refunds enable row level security;   -- no policies: only the server-side functions write and read it
revoke all on public.payment_refunds from anon, authenticated;

-- link the Premium payments made before this migration (if any) to the subscription they extended
update public.payments p
   set subscription_id = coalesce(
         (select s.id from public.subscriptions s where s.user_id = p.user_id and s.provider_subscription_id = p.provider_order_id limit 1),
         (select s.id from public.subscriptions s where s.user_id = p.user_id order by (s.status = 'active') desc, s.created_at desc limit 1))
 where p.purpose = 'premium' and p.status in ('paid','refunded') and p.subscription_id is null;
-- payments that were already refunded before this migration count as fully refunded
update public.payments set refunded_paise = amount_paise where status = 'refunded' and refunded_paise = 0;

-- ---------------------------------------------------------------------
-- 2) activate_premium: same checks as before, and it now records days + subscription on the payment.
--    Extending an admin-granted subscription keeps its provider ('admin_grant').
-- ---------------------------------------------------------------------
create or replace function public.activate_premium(p_user uuid, p_order text, p_payment text, p_amount int,
                                                  p_currency text, p_provider text, p_days int default 30) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare pay public.payments; sub public.subscriptions; new_end timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'BAD_DAYS'; end if;
  select * into pay from public.payments where provider_order_id = p_order and purpose = 'premium' for update;   -- a booking payment never buys Premium
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if pay.user_id is distinct from p_user then raise exception 'USER_MISMATCH' using errcode = 'P0001'; end if;
  if pay.amount_paise <> p_amount or pay.currency <> p_currency then raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001'; end if;
  if pay.status = 'refunded' then raise exception 'ALREADY_REFUNDED' using errcode = 'P0001'; end if;
  if pay.status = 'paid' then
    select current_period_end into new_end from public.subscriptions where user_id = p_user and status = 'active' limit 1;
    return new_end;
  end if;

  select * into sub from public.subscriptions where user_id = p_user and status = 'active' for update;
  if found then
    new_end := greatest(coalesce(sub.current_period_end, now()), now()) + make_interval(days => p_days);
    update public.subscriptions set current_period_end = new_end,
           provider = case when provider = 'admin_grant' then provider else p_provider end
     where id = sub.id;
  else
    new_end := now() + make_interval(days => p_days);
    insert into public.subscriptions (user_id, plan, status, current_period_end, provider, provider_subscription_id)
      values (p_user, 'premium', 'active', new_end, p_provider, p_order) returning * into sub;
  end if;

  update public.payments set status = 'paid', provider_payment_id = p_payment, premium_days = p_days, subscription_id = sub.id
   where id = pay.id;

  insert into public.notifications (user_id, type, data, link)
    values (p_user, 'system', jsonb_build_object('msg', 'premium_activated'), '#/premium');
  insert into public.audit_logs (actor_id, action, target, meta)
    values (null, 'premium_payment', p_user::text, jsonb_build_object('order', p_order, 'amount_paise', p_amount, 'days', p_days, 'subscription', sub.id));
  return new_end;
end $$;

-- ---------------------------------------------------------------------
-- 3) apply_payment_refund: one refund of one payment, by the provider's refund id. Server only.
--    Returns 'applied', 'duplicate', 'unknown_payment', 'not_paid' or 'nothing_left'.
-- ---------------------------------------------------------------------
create or replace function public.apply_payment_refund(p_payment text, p_refund text, p_amount int) returns text
language plpgsql security definer set search_path = public as $$
declare pay public.payments; sub public.subscriptions; k public.consultations;
        amt int; total_days int; bought interval; target interval; done interval; delta interval := interval '0'; is_full boolean;
begin
  if p_refund is null or char_length(p_refund) not between 1 and 100 then raise exception 'BAD_REFUND_ID' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'BAD_AMOUNT' using errcode = 'P0001'; end if;

  select * into pay from public.payments where provider_payment_id = p_payment for update;
  if not found then return 'unknown_payment'; end if;
  if exists (select 1 from public.payment_refunds where provider_refund_id = p_refund) then return 'duplicate'; end if;
  if pay.status not in ('paid','refunded') then return 'not_paid'; end if;

  amt := least(p_amount, pay.amount_paise - pay.refunded_paise);           -- never more than what is left
  if amt <= 0 then return 'nothing_left'; end if;
  is_full := pay.refunded_paise + amt >= pay.amount_paise;
  update public.payments set refunded_paise = refunded_paise + amt, status = case when is_full then 'refunded' else status end
   where id = pay.id;

  if pay.purpose = 'consultation' then
    if is_full then       -- same rule as 006: a booking refunded in full is cancelled (if still booked) or its "refund due" is cleared
      select * into k from public.consultations where id = pay.ref_id for update;
      if found then
        if k.status in ('pending_payment','confirmed') then
          update public.consultations set status = 'cancelled', refund_due = false where id = k.id;
          update public.scholar_slots set status = 'open' where id = k.slot_id and starts_at > now();
          insert into public.notifications (user_id, type, data, link) values
            (k.user_id,    'consult', jsonb_build_object('msg', 'cancelled', 'kind', k.kind, 'at', k.starts_at), '#/consultations'),
            (k.scholar_id, 'consult', jsonb_build_object('msg', 'cancelled', 'kind', k.kind, 'at', k.starts_at), '#/dashboard?tab=consults');
        else
          update public.consultations set refund_due = false where id = k.id;
        end if;
      end if;
    end if;
  else
    -- Premium: remove exactly this payment's share of the time it bought. The share is computed on the RUNNING
    -- TOTAL of its refunds (no rounding per refund), and only the difference to what earlier refunds already
    -- removed is taken now - so the total removed can never exceed the time this payment bought.
    total_days := coalesce(pay.premium_days, 30);                           -- 30 = the default Premium period (PREMIUM_DAYS)
    bought := make_interval(days => total_days);
    target := make_interval(secs => total_days * 86400.0 * (pay.refunded_paise + amt) / pay.amount_paise);
    if target > bought then target := bought; end if;
    select coalesce(sum(time_removed), interval '0') into done from public.payment_refunds where payment_id = pay.id;
    delta := target - done;
    if delta < interval '0' then delta := interval '0'; end if;
    if delta > interval '0' and pay.subscription_id is not null then
      select * into sub from public.subscriptions where id = pay.subscription_id for update;
      if found and sub.current_period_end is not null then
        update public.subscriptions
           set current_period_end = current_period_end - delta,
               status = case when status = 'active' and current_period_end - delta <= now() then 'cancelled' else status end
         where id = sub.id;
      end if;
    end if;
  end if;

  insert into public.payment_refunds (payment_id, provider_refund_id, amount_paise, time_removed)
    values (pay.id, p_refund, amt, delta);
  insert into public.audit_logs (actor_id, action, target, meta)
    values (null, 'payment_refunded', coalesce(pay.user_id::text, ''),
            jsonb_build_object('payment', p_payment, 'refund', p_refund, 'amount_paise', amt, 'full', is_full,
                               'purpose', pay.purpose, 'ref', pay.ref_id, 'subscription', pay.subscription_id, 'seconds_removed', round(extract(epoch from delta)::numeric, 6)));
  return 'applied';
end $$;

-- the old entry point stays (older server code): it refunds whatever is left of the payment, once
create or replace function public.mark_payment_refunded(p_payment text) returns void
language plpgsql security definer set search_path = public as $$
declare left_paise int;
begin
  select amount_paise - refunded_paise into left_paise from public.payments where provider_payment_id = p_payment;
  if left_paise is null or left_paise <= 0 then return; end if;
  perform public.apply_payment_refund(p_payment, 'full:' || p_payment, left_paise);
end $$;

-- ---------------------------------------------------------------------
-- PERMISSIONS: server (service_role) only, like the other payment functions
-- ---------------------------------------------------------------------
revoke execute on function public.apply_payment_refund(text, text, integer) from public, anon, authenticated;
grant execute on function public.apply_payment_refund(text, text, integer) to service_role;
revoke execute on function public.mark_payment_refunded(text) from public, anon, authenticated;
grant execute on function public.mark_payment_refunded(text) to service_role;
revoke execute on function public.activate_premium(uuid, text, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.activate_premium(uuid, text, text, integer, text, text, integer) to service_role;
revoke all on public.payment_refunds from anon, authenticated;

commit;
