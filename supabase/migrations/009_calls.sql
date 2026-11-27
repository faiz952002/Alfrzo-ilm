-- =====================================================================
-- Alfrzo Ilm migration 009_calls.sql            *** DRAFT FOR REVIEW - NOT RUN ON PRODUCTION ***
-- In-app voice / video calls (LiveKit) and group sessions. ADDITIVE ONLY: nothing is removed or rewritten.
--
-- Who may call whom (approved booking-restricted model):
--   * one-to-one calls only between the client and the scholar of ONE consultation, started from it
--   * the consultation must be 'confirmed', inside its time window (10 min before start .. 15 min after its end),
--     of kind 'audio' (voice only) or 'video' (voice or video) - a 'chat' booking never becomes a call
--   * a paid consultation also needs a verified, not refunded payment for it (no bypass of the payment rules)
--   * group calls only inside a FREE group session hosted by a verified, non-suspended scholar or a non-suspended admin;
--     every member is explicitly invited through a confirmed/completed consultation they had WITH THAT HOST (no
--     unrelated bookings) AND has accepted that session; the host is re-checked at every host action
--   * nobody can write the call tables directly; every change goes through the functions below, which take the
--     caller from auth.uid() (never from a parameter). Other people are never shown by user id, only by the same
--     name rule as the existing chat (a client who keeps questions anonymous stays anonymous).
--   * no media tokens, API keys or secrets are stored here; LiveKit tokens are made by the server for one call,
--     for a few minutes, after call_join() has confirmed that the person belongs to that call.
-- Run AFTER 008. Safe-run guard: refuses before 008 or a second time and changes nothing when it refuses.
-- =====================================================================
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_path') then
    raise exception 'MISSING_PREVIOUS: run % first. Nothing was changed.', '008_profile_settings.sql';
  end if;
  if to_regclass('public.calls') is not null then
    raise exception 'ALREADY_APPLIED: % was already run on this project. Nothing was changed. Do not run it again.', '009_calls.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) tables (no direct client access at all - see PERMISSIONS)
-- ---------------------------------------------------------------------
create table public.group_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  video boolean not null default true,
  starts_at timestamptz not null,
  duration_min int not null check (duration_min between 15 and 180),
  capacity int not null check (capacity between 2 and 50),          -- the server may enforce a lower limit (plan / config)
  status text not null default 'scheduled' check (status in ('scheduled','ended','cancelled')),
  created_at timestamptz not null default now()
);
create index group_sessions_host_idx on public.group_sessions (host_id, starts_at desc);

create table public.group_session_members (
  session_id uuid not null references public.group_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  via_consultation uuid references public.consultations(id) on delete set null,   -- the booking that authorised the invitation
  status text not null default 'invited' check (status in ('invited','accepted','declined','removed')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (session_id, user_id)
);
create index group_session_members_user_idx on public.group_session_members (user_id, status);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  room_name text not null unique default ('c_' || replace(gen_random_uuid()::text, '-', '')),   -- not guessable
  video boolean not null,
  consultation_id uuid references public.consultations(id) on delete cascade,
  group_session_id uuid references public.group_sessions(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,    -- caller (1:1) or session host (group)
  status text not null default 'ringing' check (status in ('ringing','active','ended','missed','declined','cancelled')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  constraint calls_one_origin check ((consultation_id is null) <> (group_session_id is null))
);
create index calls_consultation_idx on public.calls (consultation_id) where consultation_id is not null;
create index calls_session_idx on public.calls (group_session_id) where group_session_id is not null;
create index calls_live_idx on public.calls (status, created_at) where status in ('ringing','active');

create table public.call_participants (
  id uuid primary key default gen_random_uuid(),            -- also used (hashed by the server) as the media identity
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('host','guest')),
  status text not null check (status in ('ringing','joined','declined','missed','left','removed')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  unique (call_id, user_id)
);
create index call_participants_user_idx on public.call_participants (user_id, status);

alter table public.group_sessions enable row level security;
alter table public.group_session_members enable row level security;
alter table public.calls enable row level security;
alter table public.call_participants enable row level security;
-- no policies on purpose: clients use the views and functions below only

-- missed calls and group invitations become in-app notifications
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('answer','followed','status','system','message','consult','call'));

-- ---------------------------------------------------------------------
-- 2) internal helpers
-- ---------------------------------------------------------------------
-- the name another person may see: scholars by name; a client only if they do not keep questions anonymous
create or replace function public.call_label(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from public.scholars s where s.id = p_user) then p.display_name
              when p.default_anonymous then null else p.display_name end
    from public.profiles p where p.id = p_user;
$$;

-- a consultation may be used for a call right now (status, window, kind, payment, nobody suspended).
-- Payment (004/007 schema): a paid booking needs a payments row for THIS booking (purpose 'consultation', ref_id),
-- by its client, status 'paid' (a fully refunded payment has status 'refunded'), for at least the booking price,
-- and not fully refunded (refunded_paise < amount_paise).
create or replace function public.consultation_callable(k public.consultations, p_video boolean) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select k.status = 'confirmed'
     and now() between k.starts_at - interval '10 minutes' and k.starts_at + make_interval(mins => k.duration_min) + interval '15 minutes'
     and (k.kind = 'video' or (k.kind = 'audio' and not p_video))
     and (k.price_paise = 0 or exists (select 1 from public.payments y
            where y.purpose = 'consultation' and y.ref_id = k.id and y.user_id = k.user_id and y.status = 'paid'
              and y.amount_paise >= k.price_paise and y.refunded_paise < y.amount_paise))
     and exists (select 1 from public.scholars s where s.id = k.scholar_id and s.verified)
     and not exists (select 1 from public.profiles p where p.id in (k.user_id, k.scholar_id) and p.suspended);
$$;

-- may the signed-in person host group sessions right now? verified + not suspended scholar (is_scholar() from 002),
-- or an admin (is_admin() from 001 does not look at suspension, so it is checked here)
create or replace function public.group_host_ok() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_scholar()
      or (public.is_admin() and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.suspended));
$$;

-- unanswered calls become 'missed' after 45 seconds; calls end when their window is over
create or replace function public.call_housekeeping() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in
    update public.call_participants p set status = 'missed'
      from public.calls c
     where c.id = p.call_id and p.status = 'ringing' and p.role = 'guest' and c.created_at < now() - interval '45 seconds'
     returning p.user_id, c.id, c.video, c.group_session_id
  loop
    insert into public.notifications (user_id, type, data, link)
      values (r.user_id, 'call', jsonb_build_object('msg', 'missed', 'video', r.video, 'group', r.group_session_id is not null), '/calls');
  end loop;
  update public.calls c set status = 'missed', ended_at = now()
   where c.status = 'ringing' and c.created_at < now() - interval '45 seconds'
     and not exists (select 1 from public.call_participants p where p.call_id = c.id and p.role = 'guest' and p.status = 'joined');
  update public.calls c set status = 'ended', ended_at = now()
   where c.status in ('ringing','active') and (
         (c.consultation_id is not null and not exists (select 1 from public.consultations k where k.id = c.consultation_id
            and now() < k.starts_at + make_interval(mins => k.duration_min) + interval '15 minutes' and k.status = 'confirmed'))
      or (c.group_session_id is not null and not exists (select 1 from public.group_sessions g where g.id = c.group_session_id
            and g.status = 'scheduled' and now() < g.starts_at + make_interval(mins => g.duration_min) + interval '15 minutes')));
  update public.call_participants p set status = 'left', left_at = coalesce(left_at, now())
    from public.calls c where c.id = p.call_id and c.status in ('ended','missed','declined','cancelled') and p.status in ('ringing','joined');
end $$;

-- ---------------------------------------------------------------------
-- 3) one-to-one calls from a consultation
-- ---------------------------------------------------------------------
create or replace function public.call_start(p_consultation uuid, p_video boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); k public.consultations; other uuid; cid uuid;
begin
  if me is null then raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001'; end if;
  perform public.call_housekeeping();
  select * into k from public.consultations where id = p_consultation for update;
  if not found or me not in (k.user_id, k.scholar_id) then raise exception 'CALL_NOT_ALLOWED' using errcode = 'P0001'; end if;
  if not public.consultation_callable(k, coalesce(p_video, false)) then raise exception 'CALL_NOT_ALLOWED' using errcode = 'P0001'; end if;
  if (select count(*) from public.calls where host_id = me and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'RATE_LIMIT' using errcode = 'P0001';
  end if;
  other := case when me = k.user_id then k.scholar_id else k.user_id end;
  if exists (select 1 from public.call_participants p join public.calls c on c.id = p.call_id
              where p.user_id in (me, other) and p.status in ('ringing','joined') and c.status in ('ringing','active')) then
    raise exception 'BUSY' using errcode = 'P0001';
  end if;
  insert into public.calls (video, consultation_id, host_id) values (coalesce(p_video, false), k.id, me) returning id into cid;
  insert into public.call_participants (call_id, user_id, role, status, joined_at) values (cid, me, 'host', 'joined', now()), (cid, other, 'guest', 'ringing', null);
  return cid;
end $$;

-- the invited person answers (accept / decline)
create or replace function public.call_answer(p_call uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); c public.calls;
begin
  perform public.call_housekeeping();
  select * into c from public.calls where id = p_call for update;
  if not found or not exists (select 1 from public.call_participants where call_id = p_call and user_id = me and status = 'ringing') then
    return 'gone';                                         -- already missed, cancelled, ended or not mine
  end if;
  if p_accept then
    update public.call_participants set status = 'joined', joined_at = now() where call_id = p_call and user_id = me;
    update public.calls set status = 'active', started_at = coalesce(started_at, now()) where id = p_call;
    return 'joined';
  end if;
  update public.call_participants set status = 'declined', left_at = now() where call_id = p_call and user_id = me;
  if c.consultation_id is not null then update public.calls set status = 'declined', ended_at = now() where id = p_call; end if;
  return 'declined';
end $$;

-- leave / cancel / hang up. In a one-to-one call either side ends it for both; in a group only the host does (call_end_all)
create or replace function public.call_hangup(p_call uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); c public.calls;
begin
  select * into c from public.calls where id = p_call for update;
  if not found or not exists (select 1 from public.call_participants where call_id = p_call and user_id = me) then return 'gone'; end if;
  if c.status not in ('ringing','active') then return 'gone'; end if;
  if c.consultation_id is not null then
    update public.calls set status = case when status = 'ringing' then 'cancelled' else 'ended' end, ended_at = now() where id = p_call;
    update public.call_participants set status = case when status = 'ringing' then 'missed' else 'left' end, left_at = now()
     where call_id = p_call and status in ('ringing','joined');
    return 'ended';
  end if;
  update public.call_participants set status = 'left', left_at = now() where call_id = p_call and user_id = me and status in ('ringing','joined');
  return 'left';
end $$;

-- ---------------------------------------------------------------------
-- 4) group sessions and group calls
-- ---------------------------------------------------------------------
create or replace function public.group_session_create(p_title text, p_starts_at timestamptz, p_duration_min int, p_video boolean, p_capacity int) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid;
begin
  if not public.group_host_ok() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '5 minutes' then raise exception 'BAD_TIME' using errcode = 'P0001'; end if;
  if public.contains_contact_info(coalesce(p_title, '')) then raise exception 'CONTACT_INFO' using errcode = 'P0001'; end if;
  insert into public.group_sessions (host_id, title, video, starts_at, duration_min, capacity)
    values (auth.uid(), btrim(p_title), coalesce(p_video, true), p_starts_at, p_duration_min, p_capacity) returning id into sid;
  insert into public.group_session_members (session_id, user_id, status, responded_at) values (sid, auth.uid(), 'accepted', now());
  return sid;
end $$;

-- the host invites the client of one of THEIR OWN confirmed / completed consultations (the client is never chosen by
-- user id). A notification is sent only when an invitation is really created or a declined one is renewed.
-- A removed member is never re-invited; an already invited / accepted member is left as is.
create or replace function public.group_session_invite(p_session uuid, p_consultation uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.group_sessions; k public.consultations; cur text; n int;
begin
  if not public.group_host_ok() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select * into g from public.group_sessions where id = p_session for update;
  if not found or g.host_id <> auth.uid() or g.status <> 'scheduled'
     or now() > g.starts_at + make_interval(mins => g.duration_min) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select * into k from public.consultations where id = p_consultation;
  if not found or k.status not in ('confirmed','completed') or k.scholar_id <> g.host_id or k.user_id = g.host_id then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select status into cur from public.group_session_members where session_id = p_session and user_id = k.user_id;
  if cur in ('invited','accepted') then return 'already'; end if;
  if cur = 'removed' then raise exception 'MEMBER_REMOVED' using errcode = 'P0001'; end if;
  if (select count(*) from public.group_session_members where session_id = p_session and status in ('invited','accepted')) >= g.capacity then
    raise exception 'SESSION_FULL' using errcode = 'P0001';
  end if;
  if cur is null then
    insert into public.group_session_members (session_id, user_id, via_consultation) values (p_session, k.user_id, k.id);
  else   -- 'declined' -> invited again
    update public.group_session_members set status = 'invited', via_consultation = k.id, invited_at = now(), responded_at = null
     where session_id = p_session and user_id = k.user_id and status = 'declined';
  end if;
  get diagnostics n = row_count;
  if n <> 1 then return 'already'; end if;
  insert into public.notifications (user_id, type, data, link)
    values (k.user_id, 'call', jsonb_build_object('msg', 'group_invite', 'title', g.title, 'at', g.starts_at), '/calls');
  return 'invited';
end $$;

create or replace function public.group_session_respond(p_session uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.group_sessions;
begin
  select * into g from public.group_sessions where id = p_session;
  if not found or g.status <> 'scheduled' or now() > g.starts_at + make_interval(mins => g.duration_min) or g.host_id = auth.uid() then
    return 'gone';                                         -- cancelled, ended, over, unknown, or the host itself
  end if;
  update public.group_session_members set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end, responded_at = now()
   where session_id = p_session and user_id = auth.uid() and status in ('invited','accepted','declined');   -- never 'removed'
  return case when not found then 'gone' when coalesce(p_accept, false) then 'accepted' else 'declined' end;
end $$;

create or replace function public.group_session_remove(p_session uuid, p_member_label_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin   -- p_member_label_id is the member's call_participants.id or the consultation that invited them; never a user id
  if not public.group_host_ok() or not exists (select 1 from public.group_sessions where id = p_session and host_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.group_session_members m set status = 'removed', responded_at = now()
   where m.session_id = p_session and m.user_id <> auth.uid()
     and (m.via_consultation = p_member_label_id
          or m.user_id = (select p.user_id from public.call_participants p join public.calls c on c.id = p.call_id where p.id = p_member_label_id and c.group_session_id = p_session));
  return case when found then 'removed' else 'gone' end;
end $$;

create or replace function public.group_call_start(p_session uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.group_sessions; cid uuid;
begin
  perform public.call_housekeeping();
  select * into g from public.group_sessions where id = p_session for update;
  if not found or g.host_id <> auth.uid() or g.status <> 'scheduled' or not public.group_host_ok()
     or now() not between g.starts_at - interval '10 minutes' and g.starts_at + make_interval(mins => g.duration_min) then
    raise exception 'CALL_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  select id into cid from public.calls where group_session_id = p_session and status in ('ringing','active');
  if cid is not null then return cid; end if;                     -- one live call per session
  insert into public.calls (video, group_session_id, host_id, status, started_at) values (g.video, g.id, g.host_id, 'active', now()) returning id into cid;
  insert into public.call_participants (call_id, user_id, role, status, joined_at)
    select cid, m.user_id, case when m.user_id = g.host_id then 'host' else 'guest' end,
           case when m.user_id = g.host_id then 'joined' else 'ringing' end, case when m.user_id = g.host_id then now() end
      from public.group_session_members m where m.session_id = g.id and m.status = 'accepted';
  return cid;
end $$;

-- host ends a group call for everyone (the server then closes the media room)
create or replace function public.call_end_all(p_call uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.calls;
begin
  select * into c from public.calls where id = p_call for update;
  if not found or c.host_id <> auth.uid() or c.group_session_id is null then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if c.status in ('ringing','active') then
    update public.calls set status = 'ended', ended_at = now() where id = p_call;
    update public.call_participants set status = case when status = 'ringing' then 'missed' else 'left' end, left_at = now()
     where call_id = p_call and status in ('ringing','joined');
  end if;
  return c.room_name;
end $$;

-- host removes one participant from a live group call (and from the session). Returns the participant id for the server.
create or replace function public.call_remove(p_call uuid, p_participant uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.calls; p public.call_participants;
begin
  select * into c from public.calls where id = p_call for update;
  if not found or c.host_id <> auth.uid() or c.group_session_id is null or c.status not in ('ringing','active') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into p from public.call_participants where id = p_participant and call_id = p_call and role = 'guest' and status in ('ringing','joined');
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  update public.call_participants set status = 'removed', left_at = now() where id = p.id;
  update public.group_session_members set status = 'removed', responded_at = now() where session_id = c.group_session_id and user_id = p.user_id;
  return p.id;
end $$;

-- ---------------------------------------------------------------------
-- 5) joining: the ONLY way to get media access. The server calls it with the person's own login token,
--    then signs a short LiveKit token for exactly this room, identity and permissions.
-- ---------------------------------------------------------------------
create or replace function public.call_join(p_call uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); c public.calls; p public.call_participants; k public.consultations; n int;
begin
  perform public.call_housekeeping();
  select * into c from public.calls where id = p_call for update;
  select * into p from public.call_participants where call_id = p_call and user_id = me;
  -- a group member who accepted the session after its call started joins the running call (capacity checked below)
  if c.id is not null and p.id is null and c.group_session_id is not null and c.status in ('ringing','active')
     and exists (select 1 from public.group_session_members where session_id = c.group_session_id and user_id = me and status = 'accepted') then
    insert into public.call_participants (call_id, user_id, role, status) values (c.id, me, 'guest', 'ringing') returning * into p;
  end if;
  -- an accepted group member who declined the ring, missed it or left may (re)join while the call runs; 'removed' never
  if p.id is not null and c.group_session_id is not null and p.status in ('declined','missed','left') and c.status in ('ringing','active')
     and exists (select 1 from public.group_session_members where session_id = c.group_session_id and user_id = me and status = 'accepted') then
    update public.call_participants set status = 'ringing', left_at = null where id = p.id returning * into p;
  end if;
  if c.id is null or p.id is null or c.status not in ('ringing','active') or p.status not in ('joined','ringing') then
    raise exception 'CALL_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p.status = 'ringing' and c.group_session_id is null then raise exception 'CALL_NOT_ALLOWED' using errcode = 'P0001'; end if;   -- answer first
  if c.consultation_id is not null then                       -- the booking must still allow the call (cancelled, refunded, expired...)
    select * into k from public.consultations where id = c.consultation_id;
    if not public.consultation_callable(k, c.video) then raise exception 'CALL_NOT_ALLOWED' using errcode = 'P0001'; end if;
  else
    if not exists (select 1 from public.group_session_members where session_id = c.group_session_id and user_id = me and status = 'accepted')
       or not exists (select 1 from public.group_sessions g join public.profiles hp on hp.id = g.host_id
                       where g.id = c.group_session_id and g.status = 'scheduled' and not hp.suspended) then
      raise exception 'CALL_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    select count(*) into n from public.call_participants where call_id = p_call and status = 'joined';
    if p.status = 'ringing' and n >= (select capacity from public.group_sessions where id = c.group_session_id) then raise exception 'SESSION_FULL' using errcode = 'P0001'; end if;
  end if;
  if p.status = 'ringing' then update public.call_participants set status = 'joined', joined_at = now() where id = p.id; end if;
  if c.status = 'ringing' and c.group_session_id is not null then update public.calls set status = 'active', started_at = now() where id = c.id; end if;
  -- the server turns this into a LiveKit token: this room only, short expiry, camera allowed only for video calls
  -- and OFF at start in group calls ('camera_on_start'), identity derived from the participant id (not the user id)
  return jsonb_build_object('room', c.room_name, 'participant', p.id, 'video', c.video, 'host', p.role = 'host',
                            'group', c.group_session_id is not null, 'camera_on_start', c.video and c.group_session_id is null,
                            'name', coalesce(public.call_label(me), ''));
end $$;

-- ---------------------------------------------------------------------
-- 6) what the app reads (no user ids of other people anywhere)
-- ---------------------------------------------------------------------
-- calls that are ringing for me right now (the app checks this while it is open)
create or replace function public.call_incoming() returns table (call_id uuid, video boolean, is_group boolean, caller_name text, title text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.call_housekeeping();
  return query
    select c.id, c.video, c.group_session_id is not null, public.call_label(c.host_id), g.title, c.created_at
      from public.call_participants p join public.calls c on c.id = p.call_id left join public.group_sessions g on g.id = c.group_session_id
     where p.user_id = auth.uid() and p.status = 'ringing' and c.status in ('ringing','active')
     order by c.created_at desc limit 5;
end $$;

-- current state of one call for its participants (status, people with their labels and states)
create or replace function public.call_state(p_call uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.calls;
begin
  select * into c from public.calls where id = p_call;
  if not found or not exists (select 1 from public.call_participants where call_id = p_call and user_id = auth.uid()) then return null; end if;
  return jsonb_build_object('status', c.status, 'video', c.video, 'group', c.group_session_id is not null, 'started_at', c.started_at,
    'i_am_host', c.host_id = auth.uid(),
    'people', (select jsonb_agg(jsonb_build_object('id', p.id, 'me', p.user_id = auth.uid(), 'host', p.role = 'host', 'status', p.status,
                                                   'name', public.call_label(p.user_id)) order by p.role, p.invited_at)
                 from public.call_participants p where p.call_id = p_call));
end $$;

-- my call history (one row per call I was part of). Names follow the chat rule; written as joins because a function
-- inside a view is checked against the reader, and the name helper is not open to clients.
create or replace view public.call_history as
select c.id, c.video, c.group_session_id is not null as is_group, c.status, c.created_at, c.started_at, c.ended_at,
       (c.host_id = auth.uid()) as i_started, p.status as my_status,
       case when c.group_session_id is not null then g.title
            when os.id is not null then op.display_name
            when op.default_anonymous then null else op.display_name end as other_name,
       c.consultation_id, c.group_session_id
  from public.calls c
  join public.call_participants p on p.call_id = c.id and p.user_id = auth.uid()
  left join public.call_participants o on o.call_id = c.id and o.user_id <> auth.uid() and c.group_session_id is null
  left join public.profiles op on op.id = o.user_id
  left join public.scholars os on os.id = o.user_id
  left join public.group_sessions g on g.id = c.group_session_id;

-- my group sessions (as host or invited member)
create or replace view public.group_session_list as
select g.id, g.title, g.video, g.starts_at, g.duration_min, g.capacity, g.status, (g.host_id = auth.uid()) as i_am_host,
       case when hs.id is not null then hp.display_name when hp.default_anonymous then null else hp.display_name end as host_name,
       m.status as my_status,
       (select count(*) from public.group_session_members x where x.session_id = g.id and x.status = 'accepted')::int as accepted_count
  from public.group_sessions g
  join public.group_session_members m on m.session_id = g.id and m.user_id = auth.uid()
  join public.profiles hp on hp.id = g.host_id
  left join public.scholars hs on hs.id = g.host_id;

-- ---------------------------------------------------------------------
-- PERMISSIONS
-- ---------------------------------------------------------------------
revoke all on public.calls, public.call_participants, public.group_sessions, public.group_session_members from public, anon, authenticated;
revoke all on public.call_history, public.group_session_list from public, anon, authenticated;
grant select on public.call_history, public.group_session_list to authenticated;
revoke execute on function public.call_label(uuid), public.consultation_callable(public.consultations, boolean), public.call_housekeeping(),
  public.group_host_ok() from public, anon, authenticated;
revoke execute on function public.call_start(uuid, boolean), public.call_answer(uuid, boolean), public.call_hangup(uuid), public.call_join(uuid),
  public.call_incoming(), public.call_state(uuid), public.call_end_all(uuid), public.call_remove(uuid, uuid),
  public.group_session_create(text, timestamptz, int, boolean, int), public.group_session_invite(uuid, uuid),
  public.group_session_respond(uuid, boolean), public.group_session_remove(uuid, uuid), public.group_call_start(uuid) from public, anon;
grant execute on function public.call_start(uuid, boolean), public.call_answer(uuid, boolean), public.call_hangup(uuid), public.call_join(uuid),
  public.call_incoming(), public.call_state(uuid), public.call_end_all(uuid), public.call_remove(uuid, uuid),
  public.group_session_create(text, timestamptz, int, boolean, int), public.group_session_invite(uuid, uuid),
  public.group_session_respond(uuid, boolean), public.group_session_remove(uuid, uuid), public.group_call_start(uuid) to authenticated;

commit;
