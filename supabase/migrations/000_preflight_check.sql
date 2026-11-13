-- =====================================================================
-- Alfrzo Ilm migration 000_preflight_check.sql   (READ-ONLY: it only reads, it changes nothing)
-- Run this FIRST on a new project. For a fresh setup every number must be 0.
-- If any number is not 0, stop and ask before running 001-005.
-- =====================================================================
select
  (select count(*) from pg_tables where schemaname = 'public')                        as public_tables,
  (select count(*) from pg_views  where schemaname = 'public')                        as public_views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public')                                                      as public_functions,
  (select count(*) from auth.users)                                                   as auth_users,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal)         as auth_user_triggers,
  (select count(*) from storage.buckets)                                              as storage_buckets,
  (select count(*) from pg_policies where schemaname = 'storage')                     as storage_policies;
