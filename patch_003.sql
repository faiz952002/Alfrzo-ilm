-- =====================================================================
-- Alfrzo Ilm - patch 003 (run AFTER schema.sql, patch_001.sql, patch_002.sql; safe to re-run)
--   1. Private questions (only the asker, the answering scholars and admins see them)
--   2. Consultations: scholar services + time slots + bookings (paid ones confirmed ONLY by the server)
--   3. Messages: a private thread per confirmed consultation (contact details blocked)
--   4. Reels: short videos by verified scholars
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0) shared small changes
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('answer','followed','status','system','message','consult'));

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('question','answer','reel','conversation'));

alter table public.payments add column if not exists purpose text not null default 'premium' check (purpose in ('premium','consultation'));
alter table public.payments add column if not exists ref_id uuid;

-- ---------------------------------------------------------------------
-- 1) PRIVATE QUESTIONS
-- ---------------------------------------------------------------------
alter table public.questions add column if not exists visibility text not null default 'public'
  check (visibility in ('public','private'));

create or replace function public.question_is_public(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.questions where id = qid and status in ('open','answered') and visibility = 'public');
$$;

create or replace view public.question_feed as
select q.id, q.category_id, q.title, q.body, q.status, q.language, q.likes_count, q.created_at,
       (q.image_path is not null) as has_image,
       case when q.is_anonymous then null else p.display_name end as asker_name,
       (select count(*) from public.answers a where a.question_id = q.id and a.status = 'published')::int as answers_count
from public.questions q join public.profiles p on p.id = q.user_id
where q.status in ('open','answered') and q.visibility = 'public';

-- Scholars: open questions, plus ones they already answered (to edit a private answer). Never who asked.
create or replace view public.scholar_queue as
select q.id, q.category_id, q.title, q.body, q.status, q.language, q.created_at,
       q.image_path,
       (select count(*) from public.answers a where a.question_id = q.id)::int as answers_count,
       exists (select 1 from public.subscriptions s where s.user_id = q.user_id and s.status = 'active'
               and (s.current_period_end is null or s.current_period_end > now())) as is_premium,
       q.visibility
from public.questions q
where (q.status = 'open' and public.is_scholar())
   or (q.status = 'answered' and public.is_scholar()
       and exists (select 1 from public.answers a where a.question_id = q.id and a.scholar_id = auth.uid()))
   or (q.status in ('pending_review','open') and public.is_admin());
grant select on public.scholar_queue to authenticated;

-- Answers of a private question: asker + the scholar who wrote it + admins.
create or replace function public.question_owned_by_me(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.questions where id = qid and user_id = auth.uid());
$$;
drop policy if exists answers_select on public.answers;
create policy answers_select on public.answers for select
  using ((status = 'published' and (public.question_is_public(question_id) or public.question_owned_by_me(question_id)))
         or scholar_id = auth.uid() or public.is_admin());

-- Followers are NOT told about answers to private questions.
create or replace function public.answers_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; sname text; vis text;
begin
  select user_id, visibility into owner, vis from public.questions where id = new.question_id;
  select display_name into sname from public.profiles where id = new.scholar_id;
  update public.questions set status = 'answered' where id = new.question_id and status = 'open';
  update public.scholars set answers_count = answers_count + 1 where id = new.scholar_id;

  insert into public.notifications (user_id, type, data, link)
  select owner, 'answer', jsonb_build_object('scholar', sname), '#/q/' || new.question_id
  from public.profiles p where p.id = owner and p.notify_answers;

  if vis = 'public' then
    insert into public.notifications (user_id, type, data, link)
    select f.user_id, 'followed', jsonb_build_object('scholar', sname), '#/q/' || new.question_id
    from public.scholar_followers f join public.profiles p on p.id = f.user_id
    where f.scholar_id = new.scholar_id and p.notify_followed and f.user_id <> owner;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2) CONSULTATIONS
-- ---------------------------------------------------------------------
create table if not exists public.scholar_services (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  kind text not null check (kind in ('audio','video','chat')),
  price_paise int not null default 0 check (price_paise between 0 and 10000000),
  duration_min int not null default 30 check (duration_min in (15,30,45,60)),
  active boolean not null default true,
  unique (scholar_id, kind)
);
create table if not exists public.scholar_slots (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  starts_at timestamptz not null,
  status text not null default 'open' check (status in ('open','held','booked')),
  created_at timestamptz not null default now(),
  unique (scholar_id, starts_at)
);
create index if not exists scholar_slots_open_idx on public.scholar_slots (scholar_id, starts_at) where status = 'open';

create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  slot_id uuid references public.scholar_slots(id) on delete set null,
  kind text not null check (kind in ('audio','video','chat')),
  price_paise int not null check (price_paise >= 0),
  duration_min int not null,
  starts_at timestamptz not null,
  topic text not null default '' check (char_length(topic) <= 500),
  status text not null default 'pending_payment' check (status in ('pending_payment','confirmed','completed','cancelled')),
  meeting_room text,
  refund_due boolean not null default false,
  cancelled_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists consultations_user_idx on public.consultations (user_id, starts_at desc);
create index if not exists consultations_scholar_idx on public.consultations (scholar_id, starts_at desc);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null unique references public.consultations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

alter table public.scholar_services enable row level security;
alter table public.scholar_slots    enable row level security;
alter table public.consultations    enable row level security;
alter table public.conversations    enable row level security;
alter table public.messages         enable row level security;

-- services: everyone reads active ones of verified scholars; the scholar manages their own
create or replace function public.scholar_is_verified(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.scholars s join public.profiles p on p.id = s.id where s.id = sid and s.verified and not p.suspended);
$$;
drop policy if exists svc_select on public.scholar_services;
create policy svc_select on public.scholar_services for select
  using (scholar_id = auth.uid() or public.is_admin() or (active and public.scholar_is_verified(scholar_id)));
drop policy if exists svc_write on public.scholar_services;
create policy svc_write on public.scholar_services for all
  using (scholar_id = auth.uid() and public.is_scholar()) with check (scholar_id = auth.uid() and public.is_scholar());

-- slots: everyone sees open future slots; scholar sees + manages own (can only delete an OPEN slot)
drop policy if exists slot_select on public.scholar_slots;
create policy slot_select on public.scholar_slots for select
  using (scholar_id = auth.uid() or public.is_admin() or (status = 'open' and starts_at > now() and public.scholar_is_verified(scholar_id)));
drop policy if exists slot_insert on public.scholar_slots;
create policy slot_insert on public.scholar_slots for insert
  with check (scholar_id = auth.uid() and public.is_scholar() and starts_at > now() and starts_at < now() + interval '90 days');
drop policy if exists slot_delete on public.scholar_slots;
create policy slot_delete on public.scholar_slots for delete using (scholar_id = auth.uid() and status = 'open');

-- consultations / conversations / messages: only the two participants (+ admin for moderation)
drop policy if exists consult_select on public.consultations;
create policy consult_select on public.consultations for select
  using (user_id = auth.uid() or scholar_id = auth.uid() or public.is_admin());
drop policy if exists conv_select on public.conversations;
create policy conv_select on public.conversations for select
  using (user_id = auth.uid() or scholar_id = auth.uid() or public.is_admin());

create or replace function public.conversation_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when c.user_id = auth.uid() then 'user' when c.scholar_id = auth.uid() then 'scholar' end
  from public.conversations c where c.id = cid;
$$;
create or replace function public.conversation_open(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c join public.consultations k on k.id = c.consultation_id
                 where c.id = cid and k.status = 'confirmed');
$$;
drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select
  using (public.conversation_role(conversation_id) is not null or public.is_admin());
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert
  with check (sender_id = auth.uid() and public.conversation_role(conversation_id) is not null
              and public.conversation_open(conversation_id));

revoke all on public.scholar_services, public.scholar_slots, public.consultations, public.conversations, public.messages from anon, authenticated;
grant select on public.scholar_services, public.scholar_slots to anon, authenticated;
grant insert (scholar_id, kind, price_paise, duration_min, active), update (price_paise, duration_min, active), delete on public.scholar_services to authenticated;
grant insert (scholar_id, starts_at), delete on public.scholar_slots to authenticated;
grant select on public.consultations, public.conversations, public.messages to authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;

create or replace function public.scholar_slots_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.status := 'open';
  if (select count(*) from public.scholar_slots where scholar_id = new.scholar_id and starts_at > now()) >= 200 then
    raise exception 'RATE_LIMIT: too many slots' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists scholar_slots_before_insert on public.scholar_slots;
create trigger scholar_slots_before_insert before insert on public.scholar_slots
  for each row execute function public.scholar_slots_before_insert();

-- internal: turn a booking into a confirmed consultation (slot booked, thread opened, both notified)
create or replace function public.confirm_consultation_internal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.consultations;
begin
  select * into k from public.consultations where id = p_id for update;
  if k.status <> 'pending_payment' then return; end if;
  update public.consultations set status = 'confirmed', meeting_room = replace(gen_random_uuid()::text, '-', '') where id = p_id;
  update public.scholar_slots set status = 'booked' where id = k.slot_id;
  insert into public.conversations (consultation_id, user_id, scholar_id) values (p_id, k.user_id, k.scholar_id)
    on conflict (consultation_id) do nothing;
  insert into public.notifications (user_id, type, data, link) values
    (k.user_id,    'consult', jsonb_build_object('msg', 'confirmed', 'kind', k.kind, 'at', k.starts_at), '#/consultations'),
    (k.scholar_id, 'consult', jsonb_build_object('msg', 'booked',    'kind', k.kind, 'at', k.starts_at), '#/dashboard?tab=consults');
end $$;
revoke execute on function public.confirm_consultation_internal(uuid) from public, anon, authenticated;

-- A user books a slot. Free services are confirmed at once; paid ones wait for the server-verified payment.
create or replace function public.book_consultation(p_slot uuid, p_kind text, p_topic text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare sl public.scholar_slots; sv public.scholar_services; me uuid := auth.uid(); new_id uuid;
begin
  if me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = me and suspended) then raise exception 'SUSPENDED: this account is suspended' using errcode = 'P0001'; end if;
  if public.contains_contact_info(coalesce(p_topic, '')) then raise exception 'CONTACT_INFO: do not include phone, email or links' using errcode = 'P0001'; end if;

  -- release holds whose payment never arrived (15 minutes)
  update public.consultations set status = 'cancelled' where status = 'pending_payment' and created_at < now() - interval '15 minutes';
  update public.scholar_slots s set status = 'open' where s.status = 'held'
    and not exists (select 1 from public.consultations c where c.slot_id = s.id and c.status = 'pending_payment');

  select * into sl from public.scholar_slots where id = p_slot for update;
  if not found or sl.status <> 'open' or sl.starts_at <= now() then raise exception 'SLOT_TAKEN: this time is no longer available' using errcode = 'P0001'; end if;
  if sl.scholar_id = me then raise exception 'CANNOT_BOOK_SELF' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.scholars s join public.profiles p on p.id = s.id where s.id = sl.scholar_id and s.verified and not p.suspended) then
    raise exception 'SCHOLAR_UNAVAILABLE' using errcode = 'P0001'; end if;
  select * into sv from public.scholar_services where scholar_id = sl.scholar_id and kind = p_kind and active;
  if not found then raise exception 'SERVICE_UNAVAILABLE' using errcode = 'P0001'; end if;
  if (select count(*) from public.consultations where user_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMIT: too many bookings today' using errcode = 'P0001'; end if;

  insert into public.consultations (user_id, scholar_id, slot_id, kind, price_paise, duration_min, starts_at, topic, status)
    values (me, sl.scholar_id, sl.id, sv.kind, sv.price_paise, sv.duration_min, sl.starts_at, trim(coalesce(p_topic, '')), 'pending_payment')
    returning id into new_id;
  update public.scholar_slots set status = 'held' where id = sl.id;
  if sv.price_paise = 0 then perform public.confirm_consultation_internal(new_id); end if;
  return new_id;
end $$;

create or replace function public.cancel_consultation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.consultations; me uuid := auth.uid(); other uuid;
begin
  select * into k from public.consultations where id = p_id for update;
  if not found or (k.user_id <> me and k.scholar_id <> me and not public.is_admin()) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if k.status not in ('pending_payment','confirmed') then raise exception 'NOT_CANCELLABLE' using errcode = 'P0001'; end if;
  update public.consultations set status = 'cancelled', cancelled_by = me,
         refund_due = (k.status = 'confirmed' and k.price_paise > 0) where id = p_id;
  update public.scholar_slots set status = 'open' where id = k.slot_id and starts_at > now();
  other := case when me = k.user_id then k.scholar_id else k.user_id end;
  insert into public.notifications (user_id, type, data, link)
    values (other, 'consult', jsonb_build_object('msg', 'cancelled', 'kind', k.kind, 'at', k.starts_at), '#/consultations');
  insert into public.audit_logs (actor_id, action, target, meta)
    values (me, 'cancel_consultation', p_id::text, jsonb_build_object('refund_due', k.status = 'confirmed' and k.price_paise > 0));
end $$;

create or replace function public.complete_consultation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.consultations set status = 'completed'
   where id = p_id and scholar_id = auth.uid() and status = 'confirmed' and starts_at <= now();
  if not found then raise exception 'NOT_COMPLETABLE' using errcode = 'P0001'; end if;
end $$;

revoke execute on function public.book_consultation(uuid, text, text), public.cancel_consultation(uuid), public.complete_consultation(uuid) from public, anon;
grant execute on function public.book_consultation(uuid, text, text), public.cancel_consultation(uuid), public.complete_consultation(uuid) to authenticated;

-- SERVER ONLY: payment for a consultation
create or replace function public.record_consultation_order(p_user uuid, p_consultation uuid, p_order text, p_amount int, p_currency text, p_provider text) returns void
language plpgsql security definer set search_path = public as $$
declare k public.consultations;
begin
  select * into k from public.consultations where id = p_consultation;
  if not found or k.user_id <> p_user then raise exception 'CONSULTATION_NOT_FOUND' using errcode = 'P0001'; end if;
  if k.status <> 'pending_payment' then raise exception 'NOT_PAYABLE' using errcode = 'P0001'; end if;
  if k.price_paise <> p_amount or p_amount <= 0 then raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001'; end if;
  insert into public.payments (user_id, amount_paise, currency, provider, provider_order_id, status, purpose, ref_id)
    values (p_user, p_amount, p_currency, p_provider, p_order, 'created', 'consultation', p_consultation)
    on conflict (provider_order_id) where provider_order_id is not null do nothing;
end $$;

-- Called ONLY after the server verified the signature and re-fetched the payment. Idempotent.
create or replace function public.confirm_consultation_payment(p_user uuid, p_order text, p_payment text, p_amount int, p_currency text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pay public.payments; k public.consultations;
begin
  select * into pay from public.payments where provider_order_id = p_order and purpose = 'consultation' for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if pay.user_id is distinct from p_user then raise exception 'USER_MISMATCH' using errcode = 'P0001'; end if;
  if pay.amount_paise <> p_amount or pay.currency <> p_currency then raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001'; end if;
  if pay.status = 'refunded' then raise exception 'ALREADY_REFUNDED' using errcode = 'P0001'; end if;
  if pay.status = 'paid' then return pay.ref_id; end if;
  update public.payments set status = 'paid', provider_payment_id = p_payment where id = pay.id;
  select * into k from public.consultations where id = pay.ref_id for update;
  if k.status = 'pending_payment' then
    perform public.confirm_consultation_internal(k.id);
  elsif k.status = 'cancelled' then
    update public.consultations set refund_due = true where id = k.id;   -- paid after the hold expired: admin refunds
  end if;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (null, 'consultation_payment', pay.ref_id::text, jsonb_build_object('order', p_order, 'amount_paise', p_amount));
  return pay.ref_id;
end $$;
revoke execute on function public.record_consultation_order(uuid, uuid, text, int, text, text), public.confirm_consultation_payment(uuid, text, text, int, text) from public, anon, authenticated;
grant execute on function public.record_consultation_order(uuid, uuid, text, int, text, text), public.confirm_consultation_payment(uuid, text, text, int, text) to service_role;

-- What each participant sees. The scholar sees a name only if the user is not anonymous by default; never an email.
create or replace view public.consultation_list as
select k.id, k.kind, k.price_paise, k.duration_min, k.starts_at, k.topic, k.status, k.meeting_room, k.refund_due, k.created_at,
       k.scholar_id, (k.user_id = auth.uid()) as i_am_client,
       sp.display_name as scholar_name,
       case when up.default_anonymous then null else up.display_name end as client_name,
       c.id as conversation_id
from public.consultations k
join public.profiles sp on sp.id = k.scholar_id
join public.profiles up on up.id = k.user_id
left join public.conversations c on c.consultation_id = k.id
where k.user_id = auth.uid() or k.scholar_id = auth.uid() or public.is_admin();
grant select on public.consultation_list to authenticated;

-- ---------------------------------------------------------------------
-- 3) MESSAGES
-- ---------------------------------------------------------------------
create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations; other uuid;
begin
  if exists (select 1 from public.profiles where id = new.sender_id and suspended) then raise exception 'SUSPENDED: this account is suspended' using errcode = 'P0001'; end if;
  new.body := trim(new.body); new.read_at := null; new.created_at := now();
  if public.contains_contact_info(new.body) then raise exception 'CONTACT_INFO: do not share phone, email or links' using errcode = 'P0001'; end if;
  if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'RATE_LIMIT: too many messages' using errcode = 'P0001'; end if;
  select * into c from public.conversations where id = new.conversation_id;
  update public.conversations set last_message_at = now() where id = c.id;
  other := case when new.sender_id = c.user_id then c.scholar_id else c.user_id end;
  -- one unread "new message" notification per thread, not one per message
  if not exists (select 1 from public.notifications where user_id = other and type = 'message' and not read and link = '#/messages/' || c.id) then
    insert into public.notifications (user_id, type, data, link) values (other, 'message', '{}'::jsonb, '#/messages/' || c.id);
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

create or replace function public.mark_conversation_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.conversation_role(p_id) is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.messages set read_at = now() where conversation_id = p_id and sender_id <> auth.uid() and read_at is null;
  update public.notifications set read = true where user_id = auth.uid() and type = 'message' and link = '#/messages/' || p_id;
end $$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace view public.conversation_list as
select c.id, c.consultation_id, c.last_message_at, c.created_at, k.kind, k.status, k.starts_at, k.duration_min,
       (c.user_id = auth.uid()) as i_am_client,
       case when c.user_id = auth.uid() then sp.display_name
            when up.default_anonymous then null else up.display_name end as other_name,
       (c.user_id = auth.uid()) as other_is_scholar,
       (select left(m.body, 80) from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1) as last_body,
       (select count(*) from public.messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null)::int as unread
from public.conversations c
join public.consultations k on k.id = c.consultation_id
join public.profiles sp on sp.id = c.scholar_id
join public.profiles up on up.id = c.user_id
where c.user_id = auth.uid() or c.scholar_id = auth.uid();
grant select on public.conversation_list to authenticated;

-- ---------------------------------------------------------------------
-- 4) REELS
-- ---------------------------------------------------------------------
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  video_path text not null check (char_length(video_path) between 5 and 300),
  caption text not null check (char_length(caption) between 3 and 300),
  category_id int references public.categories(id) on delete set null,
  status text not null default 'published' check (status in ('published','hidden')),
  likes_count int not null default 0,
  views_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists reels_feed_idx on public.reels (status, created_at desc);
create table if not exists public.reel_likes (
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);
alter table public.reels enable row level security;
alter table public.reel_likes enable row level security;

drop policy if exists reels_select on public.reels;
create policy reels_select on public.reels for select using (status = 'published' or scholar_id = auth.uid() or public.is_admin());
drop policy if exists reels_insert on public.reels;
create policy reels_insert on public.reels for insert
  with check (scholar_id = auth.uid() and public.is_scholar() and split_part(video_path, '/', 1) = auth.uid()::text);
drop policy if exists reels_delete on public.reels;
create policy reels_delete on public.reels for delete using (scholar_id = auth.uid());
drop policy if exists reel_likes_select on public.reel_likes;
create policy reel_likes_select on public.reel_likes for select using (user_id = auth.uid());
drop policy if exists reel_likes_insert on public.reel_likes;
create policy reel_likes_insert on public.reel_likes for insert
  with check (user_id = auth.uid() and exists (select 1 from public.reels r where r.id = reel_id and r.status = 'published'));
drop policy if exists reel_likes_delete on public.reel_likes;
create policy reel_likes_delete on public.reel_likes for delete using (user_id = auth.uid());

revoke all on public.reels, public.reel_likes from anon, authenticated;
grant select on public.reels to anon, authenticated;
grant insert (scholar_id, video_path, caption, category_id), delete on public.reels to authenticated;
grant select, insert, delete on public.reel_likes to authenticated;

create or replace function public.reels_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.status := 'published'; new.likes_count := 0; new.views_count := 0; new.caption := trim(new.caption);
  if new.video_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm)$' then raise exception 'BAD_VIDEO_PATH' using errcode = 'P0001'; end if;
  if public.contains_contact_info(new.caption) then raise exception 'CONTACT_INFO: captions must not contain phone, email or links' using errcode = 'P0001'; end if;
  if (select count(*) from public.reels where scholar_id = new.scholar_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMIT: too many reels today' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists reels_before_insert on public.reels;
create trigger reels_before_insert before insert on public.reels for each row execute function public.reels_before_insert();

create or replace function public.bump_reel_likes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.reels set likes_count = likes_count + 1 where id = new.reel_id; return new;
  else update public.reels set likes_count = greatest(likes_count - 1, 0) where id = old.reel_id; return old; end if;
end $$;
drop trigger if exists reel_likes_count on public.reel_likes;
create trigger reel_likes_count after insert or delete on public.reel_likes for each row execute function public.bump_reel_likes();
drop trigger if exists reel_likes_limit on public.reel_likes;
create trigger reel_likes_limit before insert on public.reel_likes for each row execute function public.limit_user_actions();

create or replace function public.reel_viewed(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.reels set views_count = views_count + 1 where id = p_id and status = 'published';
$$;
grant execute on function public.reel_viewed(uuid) to anon, authenticated;

create or replace view public.reel_feed as
select r.id, r.scholar_id, p.display_name as scholar_name, r.video_path, r.caption, r.category_id,
       r.likes_count, r.views_count, r.created_at
from public.reels r join public.scholars s on s.id = r.scholar_id join public.profiles p on p.id = r.scholar_id
where r.status = 'published' and s.verified and not p.suspended;
grant select on public.reel_feed to anon, authenticated;

-- public video bucket (max 30 MB, mp4 / webm). Only verified scholars upload, into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reels', 'reels', true, 31457280, array['video/mp4','video/webm'])
on conflict (id) do update set public = true, file_size_limit = 31457280, allowed_mime_types = array['video/mp4','video/webm'];
drop policy if exists reels_obj_insert on storage.objects;
create policy reels_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'reels' and (storage.foldername(name))[1] = auth.uid()::text and public.is_scholar());
drop policy if exists reels_obj_delete on storage.objects;
create policy reels_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'reels' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------
-- 5) ADMIN: hide reels, see reports about reels/conversations, consultations needing a refund
-- ---------------------------------------------------------------------
create or replace function public.admin_hide_content(p_type text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_type = 'question' then update public.questions set status = 'rejected' where id = p_id;
  elsif p_type = 'answer' then update public.answers set status = 'hidden' where id = p_id;
  elsif p_type = 'reel' then update public.reels set status = 'hidden' where id = p_id;
  else raise exception 'BAD_TYPE'; end if;
  insert into public.audit_logs (actor_id, action, target, meta)
    values (auth.uid(), 'hide_content', p_id::text, jsonb_build_object('type', p_type));
end $$;

create or replace function public.admin_reports() returns table (
  id uuid, target_type text, target_id uuid, reason text, status text, created_at timestamptz, snippet text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at,
           left(case r.target_type
             when 'question' then (select q.title from public.questions q where q.id = r.target_id)
             when 'answer' then (select a.body from public.answers a where a.id = r.target_id)
             when 'reel' then (select x.caption from public.reels x where x.id = r.target_id)
             else (select string_agg(m.b, ' | ' order by m.ca) from
                    (select x.body as b, x.created_at as ca from public.messages x where x.conversation_id = r.target_id order by x.created_at desc limit 6) m) end, 400)
    from public.reports r order by (r.status = 'open') desc, r.created_at desc limit 200;
end $$;

create or replace function public.admin_refund_done(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.consultations set refund_due = false where id = p_id;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'refund_marked_done', p_id::text);
end $$;
revoke execute on function public.admin_refund_done(uuid) from public, anon;
grant execute on function public.admin_refund_done(uuid) to authenticated;

-- A consultation payment can never be used to activate Premium (and the other way round).
create or replace function public.activate_premium(p_user uuid, p_order text, p_payment text, p_amount int,
                                                  p_currency text, p_provider text, p_days int default 30) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare pay public.payments; sub public.subscriptions; new_end timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'BAD_DAYS'; end if;
  select * into pay from public.payments where provider_order_id = p_order and purpose = 'premium' for update;
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

commit;
