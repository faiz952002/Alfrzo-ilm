-- =====================================================================
-- Alfrzo Ilm migration 008_profile_settings.sql
-- Profile + settings upgrade. ADDITIVE ONLY: no table, column, row or policy is removed, no existing data is changed.
--   * profiles.avatar_path   - optional profile photo, stored in a NEW PRIVATE storage bucket "avatars"
--                              (only the owner can upload / read / delete files in their own folder; 1 MB, jpeg/png/webp)
--   * profiles.notify_consult - "consultation updates and reminders" notification preference (default ON)
--   * a display name is checked by the database when it is CHANGED (trimmed, 1-60 characters, no invisible or
--     control characters, no phone numbers / emails / links). Existing names are never rewritten.
--   * a consultation notification ('consult') is not created for a person who switched notify_consult off.
--     Important account notifications ('system') and all other types are unchanged.
-- Payments, refunds and RLS rules of existing tables are NOT touched.
-- Run AFTER 007. Safe-run guard: refuses to run before 007 or a second time, and changes nothing when it refuses.
-- =====================================================================
begin;
do $$
begin
  if to_regclass('public.payment_refunds') is null
     or to_regprocedure('public.apply_payment_refund(text,text,integer)') is null then
    raise exception 'MISSING_PREVIOUS: run % first. Nothing was changed.', '007_premium_refund_correction.sql';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_path') then
    raise exception 'ALREADY_APPLIED: % was already run on this project. Nothing was changed. Do not run it again.', '008_profile_settings.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) new profile columns
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists notify_consult boolean not null default true;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_path_own') then
    -- a photo path always points into the owner's own folder of the avatars bucket
    alter table public.profiles add constraint profiles_avatar_path_own
      check (avatar_path is null or avatar_path ~ ('^' || id::text || '/avatar-[0-9]{10,16}\.(jpg|png|webp)$'));
  end if;
end $$;
grant update (avatar_path, notify_consult) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 2) display name check (only when the name is changed - existing names stay exactly as they are)
-- ---------------------------------------------------------------------
create or replace function public.profiles_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name then
    new.display_name := btrim(regexp_replace(coalesce(new.display_name, ''), '\s+', ' ', 'g'));
    if char_length(new.display_name) < 1 or char_length(new.display_name) > 60 then
      raise exception 'BAD_NAME' using errcode = 'P0001';
    end if;
    -- control characters, zero-width characters and text-direction overrides make a name look different from what it is
    if new.display_name ~ '[\u0001-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]' then
      raise exception 'BAD_NAME' using errcode = 'P0001';
    end if;
    if public.contains_contact_info(new.display_name) then
      raise exception 'CONTACT_INFO' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ---------------------------------------------------------------------
-- 3) consultation notifications follow the person's preference
-- ---------------------------------------------------------------------
create or replace function public.notifications_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'consult' and exists (select 1 from public.profiles where id = new.user_id and not notify_consult) then
    return null;   -- skipped: the person switched consultation notifications off
  end if;
  return new;
end $$;
drop trigger if exists notifications_before_insert on public.notifications;
create trigger notifications_before_insert before insert on public.notifications
  for each row execute function public.notifications_before_insert();

revoke execute on function public.profiles_before_update() from public, anon, authenticated;
revoke execute on function public.notifications_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) private storage bucket for profile photos (owner only)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists avatar_insert on storage.objects;
create policy avatar_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatar_select on storage.objects;
create policy avatar_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatar_delete on storage.objects;
create policy avatar_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
