-- =====================================================================
-- Alfrzo Ilm - patch 004 (run AFTER schema.sql and patch_001..003; safe to re-run)
-- Phase 1 stability fixes. Nothing is dropped; no feature is removed.
--   H1  a refund only undoes what that payment bought (a consultation refund never cancels Premium)
--   H2  cancellation rules: client until 2 h before the start, scholar until the end, admin any time;
--       past consultations complete automatically
--   M1  no overlapping slots, and no double booking of a scholar's time
--   M2  unpaid holds are released for everyone, not only when someone books
--   M3  reel views: logged-in users only, one view per person per reel
--   M6  a question that has a published answer cannot be deleted by the asker
--       (deleting the whole account still removes everything)
--   L1/L2  answer counters and question status stay correct when answers are hidden or removed
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- H2) cancellation window (one place to change it)
-- ---------------------------------------------------------------------
create or replace function public.consultation_cancel_cutoff() returns interval
language sql immutable as $$ select interval '2 hours' $$;

-- ---------------------------------------------------------------------
-- M2 + H2) housekeeping: release expired holds, complete finished consultations.
-- Called by book/cancel and by the app before it shows slots or bookings. Idempotent and cheap.
-- (Optional: schedule it every 5 minutes with pg_cron in Supabase.)
-- ---------------------------------------------------------------------
create index if not exists consultations_pending_idx on public.consultations (created_at) where status = 'pending_payment';
create index if not exists consultations_confirmed_idx on public.consultations (starts_at) where status = 'confirmed';
create index if not exists scholar_slots_held_idx on public.scholar_slots (id) where status = 'held';

create or replace function public.consultation_housekeeping() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- holds whose payment never arrived (15 minutes)
  update public.consultations set status = 'cancelled'
   where status = 'pending_payment' and created_at < now() - interval '15 minutes';
  update public.scholar_slots s set status = 'open'
   where s.status = 'held'
     and not exists (select 1 from public.consultations c where c.slot_id = s.id and c.status = 'pending_payment');
  -- finished: end of the session + 30 minutes (the same window in which the call link stays open)
  update public.consultations set status = 'completed'
   where status = 'confirmed' and starts_at + make_interval(mins => duration_min) + interval '30 minutes' < now();
end $$;
revoke execute on function public.consultation_housekeeping() from public;
grant execute on function public.consultation_housekeeping() to anon, authenticated;

-- ---------------------------------------------------------------------
-- M1) slots: a new slot may not overlap another one of the same scholar
--     (span = the scholar's longest active service, at least 15 minutes)
-- ---------------------------------------------------------------------
create or replace function public.scholar_slots_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare span interval;
begin
  new.status := 'open';
  if (select count(*) from public.scholar_slots where scholar_id = new.scholar_id and starts_at > now()) >= 200 then
    raise exception 'RATE_LIMIT: too many slots' using errcode = 'P0001';
  end if;
  select make_interval(mins => coalesce(max(duration_min), 15)) into span
    from public.scholar_services where scholar_id = new.scholar_id and active;
  if exists (select 1 from public.scholar_slots
              where scholar_id = new.scholar_id
                and starts_at > new.starts_at - span and starts_at < new.starts_at + span) then
    raise exception 'SLOT_OVERLAP: this time overlaps another of your open times' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- M1 + M2) booking: shared housekeeping, and never two bookings in the same time of one scholar
-- (same checks and messages as before otherwise)
-- ---------------------------------------------------------------------
create or replace function public.book_consultation(p_slot uuid, p_kind text, p_topic text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare sl public.scholar_slots; sv public.scholar_services; me uuid := auth.uid(); new_id uuid;
begin
  if me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = me and suspended) then raise exception 'SUSPENDED: this account is suspended' using errcode = 'P0001'; end if;
  if public.contains_contact_info(coalesce(p_topic, '')) then raise exception 'CONTACT_INFO: do not include phone, email or links' using errcode = 'P0001'; end if;

  perform public.consultation_housekeeping();

  select * into sl from public.scholar_slots where id = p_slot for update;
  if not found or sl.status <> 'open' or sl.starts_at <= now() then raise exception 'SLOT_TAKEN: this time is no longer available' using errcode = 'P0001'; end if;
  if sl.scholar_id = me then raise exception 'CANNOT_BOOK_SELF' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.scholars s join public.profiles p on p.id = s.id where s.id = sl.scholar_id and s.verified and not p.suspended) then
    raise exception 'SCHOLAR_UNAVAILABLE' using errcode = 'P0001'; end if;
  select * into sv from public.scholar_services where scholar_id = sl.scholar_id and kind = p_kind and active;
  if not found then raise exception 'SERVICE_UNAVAILABLE' using errcode = 'P0001'; end if;
  if (select count(*) from public.consultations where user_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMIT: too many bookings today' using errcode = 'P0001'; end if;

  -- one booking at a time per scholar, so two people cannot take overlapping times simultaneously
  perform pg_advisory_xact_lock(hashtext('consult:' || sl.scholar_id::text));
  if exists (select 1 from public.consultations c
              where c.scholar_id = sl.scholar_id and c.status in ('pending_payment','confirmed')
                and c.starts_at < sl.starts_at + make_interval(mins => sv.duration_min)
                and sl.starts_at < c.starts_at + make_interval(mins => c.duration_min)) then
    raise exception 'SLOT_TAKEN: this time is no longer available' using errcode = 'P0001';
  end if;

  insert into public.consultations (user_id, scholar_id, slot_id, kind, price_paise, duration_min, starts_at, topic, status)
    values (me, sl.scholar_id, sl.id, sv.kind, sv.price_paise, sv.duration_min, sl.starts_at, trim(coalesce(p_topic, '')), 'pending_payment')
    returning id into new_id;
  update public.scholar_slots set status = 'held' where id = sl.id;
  if sv.price_paise = 0 then perform public.confirm_consultation_internal(new_id); end if;
  return new_id;
end $$;

-- ---------------------------------------------------------------------
-- H2) cancelling: client until the cut-off, scholar until the session ends, admin any time.
--     A paid, confirmed booking cancelled by anyone is marked "refund due" (as before).
-- ---------------------------------------------------------------------
create or replace function public.cancel_consultation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.consultations; me uuid := auth.uid(); other uuid; adm boolean := public.is_admin();
begin
  perform public.consultation_housekeeping();
  select * into k from public.consultations where id = p_id for update;
  if not found or (k.user_id <> me and k.scholar_id <> me and not adm) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if k.status not in ('pending_payment','confirmed') then raise exception 'NOT_CANCELLABLE' using errcode = 'P0001'; end if;
  if k.status = 'confirmed' and not adm then
    if me = k.user_id and now() >= k.starts_at - public.consultation_cancel_cutoff() then
      raise exception 'TOO_LATE_TO_CANCEL: bookings can be cancelled up to 2 hours before the start' using errcode = 'P0001';
    end if;
    if me = k.scholar_id and now() >= k.starts_at + make_interval(mins => k.duration_min) then
      raise exception 'TOO_LATE_TO_CANCEL: this consultation has already ended' using errcode = 'P0001';
    end if;
  end if;
  update public.consultations set status = 'cancelled', cancelled_by = me,
         refund_due = (k.status = 'confirmed' and k.price_paise > 0) where id = p_id;
  update public.scholar_slots set status = 'open' where id = k.slot_id and starts_at > now();
  other := case when me = k.user_id then k.scholar_id else k.user_id end;
  insert into public.notifications (user_id, type, data, link)
    values (other, 'consult', jsonb_build_object('msg', 'cancelled', 'kind', k.kind, 'at', k.starts_at), '#/consultations');
  insert into public.audit_logs (actor_id, action, target, meta)
    values (me, 'cancel_consultation', p_id::text, jsonb_build_object('refund_due', k.status = 'confirmed' and k.price_paise > 0));
end $$;
revoke execute on function public.cancel_consultation(uuid) from public, anon;
grant execute on function public.cancel_consultation(uuid) to authenticated;

-- The app reads "can_cancel" so the button follows exactly the rule above. (New column added at the end.)
create or replace view public.consultation_list as
select k.id, k.kind, k.price_paise, k.duration_min, k.starts_at, k.topic, k.status, k.meeting_room, k.refund_due, k.created_at,
       k.scholar_id, (k.user_id = auth.uid()) as i_am_client,
       sp.display_name as scholar_name,
       case when up.default_anonymous then null else up.display_name end as client_name,
       c.id as conversation_id,
       case when k.status = 'pending_payment' then true
            when k.status <> 'confirmed' then false
            when public.is_admin() then true
            when k.user_id = auth.uid() then now() < k.starts_at - public.consultation_cancel_cutoff()
            else now() < k.starts_at + make_interval(mins => k.duration_min) end as can_cancel
from public.consultations k
join public.profiles sp on sp.id = k.scholar_id
join public.profiles up on up.id = k.user_id
left join public.conversations c on c.consultation_id = k.id
where k.user_id = auth.uid() or k.scholar_id = auth.uid() or public.is_admin();
grant select on public.consultation_list to authenticated;

-- ---------------------------------------------------------------------
-- H1) refunds undo only what that payment bought
-- ---------------------------------------------------------------------
create or replace function public.mark_payment_refunded(p_payment text) returns void
language plpgsql security definer set search_path = public as $$
declare pay public.payments; k public.consultations;
begin
  update public.payments set status = 'refunded'
   where provider_payment_id = p_payment and status = 'paid' returning * into pay;
  if pay.id is null then return; end if;     -- unknown or already refunded: nothing to do (idempotent)

  if pay.purpose = 'consultation' then
    select * into k from public.consultations where id = pay.ref_id for update;
    if found then
      if k.status in ('pending_payment','confirmed') then
        -- refunded from the payment dashboard while still booked: the booking is cancelled, the time is freed
        update public.consultations set status = 'cancelled', refund_due = false where id = k.id;
        update public.scholar_slots set status = 'open' where id = k.slot_id and starts_at > now();
        insert into public.notifications (user_id, type, data, link) values
          (k.user_id,    'consult', jsonb_build_object('msg', 'cancelled', 'kind', k.kind, 'at', k.starts_at), '#/consultations'),
          (k.scholar_id, 'consult', jsonb_build_object('msg', 'cancelled', 'kind', k.kind, 'at', k.starts_at), '#/dashboard?tab=consults');
      else
        update public.consultations set refund_due = false where id = k.id;   -- the refund that was due is now done
      end if;
    end if;
  else
    update public.subscriptions set status = 'cancelled'
     where user_id = pay.user_id and status = 'active' and provider <> 'admin_grant';
  end if;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (null, 'payment_refunded', coalesce(pay.user_id::text, ''), jsonb_build_object('payment', p_payment, 'purpose', pay.purpose, 'ref', pay.ref_id));
end $$;
revoke execute on function public.mark_payment_refunded(text) from public, anon, authenticated;
grant execute on function public.mark_payment_refunded(text) to service_role;

-- ---------------------------------------------------------------------
-- M3) reel views: one per logged-in person per reel
-- ---------------------------------------------------------------------
create table if not exists public.reel_views (
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);
alter table public.reel_views enable row level security;   -- no policies: only reel_viewed() writes here
revoke all on public.reel_views from anon, authenticated;

create or replace function public.reel_viewed(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then return; end if;
  insert into public.reel_views (reel_id, user_id)
    select p_id, auth.uid() where exists (select 1 from public.reels where id = p_id and status = 'published')
    on conflict do nothing;
  if found then update public.reels set views_count = views_count + 1 where id = p_id; end if;
end $$;
revoke execute on function public.reel_viewed(uuid) from public, anon;
grant execute on function public.reel_viewed(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- L1 + L2) keep counters and question status right when an answer is hidden or removed
-- ---------------------------------------------------------------------
create or replace function public.answers_sync_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare qid uuid := coalesce(new.question_id, old.question_id); sid uuid := coalesce(new.scholar_id, old.scholar_id);
begin
  update public.scholars s
     set answers_count = (select count(*) from public.answers a where a.scholar_id = sid and a.status = 'published')
   where s.id = sid;
  update public.questions q
     set status = case when exists (select 1 from public.answers a where a.question_id = qid and a.status = 'published')
                       then 'answered' else 'open' end
   where q.id = qid and q.status in ('open','answered');
  return null;
end $$;
drop trigger if exists answers_sync_counts on public.answers;
create trigger answers_sync_counts after update of status or delete on public.answers
  for each row execute function public.answers_sync_counts();

-- one-time correction of values that drifted before this patch
update public.scholars s
   set answers_count = x.n
  from (select s2.id, (select count(*) from public.answers a where a.scholar_id = s2.id and a.status = 'published')::int as n
          from public.scholars s2) x
 where x.id = s.id and s.answers_count is distinct from x.n;
update public.questions q set status = 'open'
 where q.status = 'answered' and not exists (select 1 from public.answers a where a.question_id = q.id and a.status = 'published');

-- ---------------------------------------------------------------------
-- M6) the asker cannot delete a question that already has a published answer.
--     Only direct deletes from the app are blocked: deleting an account (cascade), the SQL editor
--     and admins are not affected.
-- ---------------------------------------------------------------------
create or replace function public.questions_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1                                                -- a direct DELETE, not an account-deletion cascade
     and coalesce(current_setting('request.jwt.claims', true), '') <> ''   -- coming from the app (PostgREST)
     and not public.is_admin()
     and exists (select 1 from public.answers a where a.question_id = old.id and a.status = 'published') then
    raise exception 'QUESTION_HAS_ANSWERS: a question that has an answer cannot be deleted' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists questions_before_delete on public.questions;
create trigger questions_before_delete before delete on public.questions
  for each row execute function public.questions_before_delete();

commit;
