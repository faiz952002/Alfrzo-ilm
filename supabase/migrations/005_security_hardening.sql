-- =====================================================================
-- Alfrzo Ilm migration 005_security_hardening.sql   (NEW - not in the old patch files)
-- Makes permissions EXACT and independent of the Supabase project's default privileges:
--   1. visitors (anon) and users (authenticated) get exactly the intended table/view/column rights
--      (Supabase otherwise auto-grants extra rights on the 3 views created by patch_003)
--   2. database functions: explicit allow-list (helpers for security rules, app actions, server-only payments)
--   3. users who signed up before the schema existed get their missing profile row
-- Nothing is deleted. Safe to run again (it always ends in the same state).
-- =====================================================================
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'questions' and column_name = 'visibility') then raise exception 'MISSING_PREVIOUS: run % first. Nothing was changed.', '004_private_questions_consultations_chat_reels.sql'; end if;
end $$;

-- 1) TABLE / VIEW / COLUMN PRIVILEGES ------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant delete, insert, select on public.answer_helpful to authenticated;
grant select on public.answers to anon;
grant select on public.answers to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.categories to anon;
grant delete, insert, select, update on public.categories to authenticated;
grant select on public.consultation_list to authenticated;
grant select on public.consultations to authenticated;
grant select on public.conversation_list to authenticated;
grant select on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant delete, select on public.notifications to authenticated;
grant select on public.payments to authenticated;
grant select on public.profiles to authenticated;
grant select on public.question_feed to anon;
grant select on public.question_feed to authenticated;
grant delete, insert, select on public.question_likes to authenticated;
grant delete, insert, select on public.questions to authenticated;
grant select on public.reel_feed to anon;
grant select on public.reel_feed to authenticated;
grant delete, insert, select on public.reel_likes to authenticated;
grant select on public.reels to anon;
grant delete, select on public.reels to authenticated;
grant insert, select on public.reports to authenticated;
grant delete, insert, select on public.saved_answers to authenticated;
grant delete, select on public.scholar_applications to authenticated;
grant select on public.scholar_directory to anon;
grant select on public.scholar_directory to authenticated;
grant delete, insert, select on public.scholar_followers to authenticated;
grant select on public.scholar_queue to authenticated;
grant select on public.scholar_services to anon;
grant delete, select on public.scholar_services to authenticated;
grant select on public.scholar_slots to anon;
grant delete, select on public.scholar_slots to authenticated;
grant select on public.scholars to authenticated;
grant select on public.subscriptions to authenticated;
grant insert (body, hadith_refs, question_id, quran_refs, scholar_id) on public.answers to authenticated;
grant update (body, hadith_refs, quran_refs) on public.answers to authenticated;
grant insert (body, conversation_id, sender_id) on public.messages to authenticated;
grant update (read) on public.notifications to authenticated;
grant update (default_anonymous, display_name, language, notify_answers, notify_followed) on public.profiles to authenticated;
grant insert (caption, category_id, scholar_id, video_path) on public.reels to authenticated;
grant insert (bio, credentials_note, qualifications, specialties, user_id) on public.scholar_applications to authenticated;
grant insert (active, duration_min, kind, price_paise, scholar_id) on public.scholar_services to authenticated;
grant update (active, duration_min, price_paise) on public.scholar_services to authenticated;
grant insert (scholar_id, starts_at) on public.scholar_slots to authenticated;
grant update (bio, qualifications, specialties) on public.scholars to authenticated;
grant usage on sequence public.categories_id_seq to authenticated;

-- 2) FUNCTION PERMISSIONS (allow-list) --------------------------------------------
-- First remove EXECUTE from everyone on every app function in schema public (extension functions are skipped).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
-- a) helpers used inside security rules and views: needed by visitors and users
grant execute on function public.is_admin(),
  public.is_scholar(),
  public.question_is_public(qid uuid),
  public.question_owned_by_me(qid uuid),
  public.scholar_is_verified(sid uuid),
  public.conversation_role(cid uuid),
  public.conversation_open(cid uuid)
to anon, authenticated, service_role;
-- b) counts a reel view (visitors too, as the app does today)
grant execute on function public.reel_viewed(p_id uuid) to anon, authenticated;
-- c) app actions called from the website by logged-in users (each one checks the caller's rights inside)
grant execute on function public.admin_hide_content(p_type text, p_id uuid),
  public.admin_list_applications(),
  public.admin_list_scholars(),
  public.admin_list_users(),
  public.admin_make_scholar(p_email text),
  public.admin_refund_done(p_id uuid),
  public.admin_reports(),
  public.admin_review_application(p_id uuid, p_approve boolean, p_note text),
  public.admin_set_premium(p_id uuid, p_days integer),
  public.admin_set_role(p_id uuid, p_role text),
  public.admin_set_suspended(p_id uuid, p_suspended boolean),
  public.admin_set_verified(p_id uuid, p_verified boolean),
  public.admin_stats(),
  public.book_consultation(p_slot uuid, p_kind text, p_topic text),
  public.cancel_consultation(p_id uuid),
  public.complete_consultation(p_id uuid),
  public.delete_my_account(),
  public.mark_conversation_read(p_id uuid),
  public.moderate_question(p_id uuid, p_status text),
  public.resolve_report(p_id uuid, p_status text)
to authenticated;
-- d) payments: ONLY the server (service_role key, never in the browser)
grant execute on function public.activate_premium(p_user uuid, p_order text, p_payment text, p_amount integer, p_currency text, p_provider text, p_days integer),
  public.confirm_consultation_payment(p_user uuid, p_order text, p_payment text, p_amount integer, p_currency text),
  public.fail_payment(p_order text, p_payment text),
  public.mark_payment_refunded(p_payment text),
  public.record_consultation_order(p_user uuid, p_consultation uuid, p_order text, p_amount integer, p_currency text, p_provider text),
  public.record_payment_order(p_user uuid, p_order text, p_amount integer, p_currency text, p_provider text)
to service_role;
-- e) internal only (used inside other functions/triggers): confirm_consultation_internal, contains_contact_info, is_premium -> no client grant

-- 3) PROFILES FOR USERS WHO SIGNED UP BEFORE THE SCHEMA EXISTED ------------------
insert into public.profiles (id, display_name)
select u.id, left(coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), 'User'), 60)
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

commit;
