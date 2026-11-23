-- =====================================================================
-- Alfrzo Ilm - DATABASE HEALTH CHECK  (READ-ONLY: it only reads, it changes nothing)
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- Every row must show ok = true. The last row is the overall result.
-- Expected values were generated from the tested migrations 001-005.
-- =====================================================================
with
f as (select p.oid, p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
fnames as (select distinct proname from f where (select prorettype from pg_proc where oid = f.oid) <> 'trigger'::regtype),
exp_priv(kind, obj, role, priv) as (values
    ('column','answers.body','authenticated','INSERT'),
    ('column','answers.body','authenticated','UPDATE'),
    ('column','answers.hadith_refs','authenticated','INSERT'),
    ('column','answers.hadith_refs','authenticated','UPDATE'),
    ('column','answers.question_id','authenticated','INSERT'),
    ('column','answers.quran_refs','authenticated','INSERT'),
    ('column','answers.quran_refs','authenticated','UPDATE'),
    ('column','answers.scholar_id','authenticated','INSERT'),
    ('column','messages.body','authenticated','INSERT'),
    ('column','messages.conversation_id','authenticated','INSERT'),
    ('column','messages.sender_id','authenticated','INSERT'),
    ('column','notifications.read','authenticated','UPDATE'),
    ('column','profiles.default_anonymous','authenticated','UPDATE'),
    ('column','profiles.display_name','authenticated','UPDATE'),
    ('column','profiles.language','authenticated','UPDATE'),
    ('column','profiles.notify_answers','authenticated','UPDATE'),
    ('column','profiles.notify_followed','authenticated','UPDATE'),
    ('column','reels.caption','authenticated','INSERT'),
    ('column','reels.category_id','authenticated','INSERT'),
    ('column','reels.scholar_id','authenticated','INSERT'),
    ('column','reels.video_path','authenticated','INSERT'),
    ('column','scholar_applications.bio','authenticated','INSERT'),
    ('column','scholar_applications.credentials_note','authenticated','INSERT'),
    ('column','scholar_applications.qualifications','authenticated','INSERT'),
    ('column','scholar_applications.specialties','authenticated','INSERT'),
    ('column','scholar_applications.user_id','authenticated','INSERT'),
    ('column','scholar_services.active','authenticated','INSERT'),
    ('column','scholar_services.active','authenticated','UPDATE'),
    ('column','scholar_services.duration_min','authenticated','INSERT'),
    ('column','scholar_services.duration_min','authenticated','UPDATE'),
    ('column','scholar_services.kind','authenticated','INSERT'),
    ('column','scholar_services.price_paise','authenticated','INSERT'),
    ('column','scholar_services.price_paise','authenticated','UPDATE'),
    ('column','scholar_services.scholar_id','authenticated','INSERT'),
    ('column','scholar_slots.scholar_id','authenticated','INSERT'),
    ('column','scholar_slots.starts_at','authenticated','INSERT'),
    ('column','scholars.bio','authenticated','UPDATE'),
    ('column','scholars.qualifications','authenticated','UPDATE'),
    ('column','scholars.specialties','authenticated','UPDATE'),
    ('table','answer_helpful','authenticated','DELETE'),
    ('table','answer_helpful','authenticated','INSERT'),
    ('table','answer_helpful','authenticated','SELECT'),
    ('table','answers','anon','SELECT'),
    ('table','answers','authenticated','SELECT'),
    ('table','audit_logs','authenticated','SELECT'),
    ('table','categories','anon','SELECT'),
    ('table','categories','authenticated','DELETE'),
    ('table','categories','authenticated','INSERT'),
    ('table','categories','authenticated','SELECT'),
    ('table','categories','authenticated','UPDATE'),
    ('table','consultation_list','authenticated','SELECT'),
    ('table','consultations','authenticated','SELECT'),
    ('table','conversation_list','authenticated','SELECT'),
    ('table','conversations','authenticated','SELECT'),
    ('table','messages','authenticated','SELECT'),
    ('table','notifications','authenticated','DELETE'),
    ('table','notifications','authenticated','SELECT'),
    ('table','payments','authenticated','SELECT'),
    ('table','profiles','authenticated','SELECT'),
    ('table','question_feed','anon','SELECT'),
    ('table','question_feed','authenticated','SELECT'),
    ('table','question_likes','authenticated','DELETE'),
    ('table','question_likes','authenticated','INSERT'),
    ('table','question_likes','authenticated','SELECT'),
    ('table','questions','authenticated','DELETE'),
    ('table','questions','authenticated','INSERT'),
    ('table','questions','authenticated','SELECT'),
    ('table','reel_feed','anon','SELECT'),
    ('table','reel_feed','authenticated','SELECT'),
    ('table','reel_likes','authenticated','DELETE'),
    ('table','reel_likes','authenticated','INSERT'),
    ('table','reel_likes','authenticated','SELECT'),
    ('table','reels','anon','SELECT'),
    ('table','reels','authenticated','DELETE'),
    ('table','reels','authenticated','SELECT'),
    ('table','reports','authenticated','INSERT'),
    ('table','reports','authenticated','SELECT'),
    ('table','saved_answers','authenticated','DELETE'),
    ('table','saved_answers','authenticated','INSERT'),
    ('table','saved_answers','authenticated','SELECT'),
    ('table','scholar_applications','authenticated','DELETE'),
    ('table','scholar_applications','authenticated','SELECT'),
    ('table','scholar_directory','anon','SELECT'),
    ('table','scholar_directory','authenticated','SELECT'),
    ('table','scholar_followers','authenticated','DELETE'),
    ('table','scholar_followers','authenticated','INSERT'),
    ('table','scholar_followers','authenticated','SELECT'),
    ('table','scholar_queue','authenticated','SELECT'),
    ('table','scholar_services','anon','SELECT'),
    ('table','scholar_services','authenticated','DELETE'),
    ('table','scholar_services','authenticated','SELECT'),
    ('table','scholar_slots','anon','SELECT'),
    ('table','scholar_slots','authenticated','DELETE'),
    ('table','scholar_slots','authenticated','SELECT'),
    ('table','scholars','authenticated','SELECT'),
    ('table','subscriptions','authenticated','SELECT'),
    ('sequence','categories_id_seq','authenticated','USAGE')),
act_priv as (
  select 'table'::text as kind, c.relname::text as obj, a.grantee::regrole::text as role, a.privilege_type::text as priv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relkind in ('r','v') and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  union all
  select 'column', c.relname || '.' || att.attname, a.grantee::regrole::text, a.privilege_type
    from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(att.attacl) a
   where n.nspname = 'public' and att.attacl is not null and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  union all
  select 'sequence', c.relname, a.grantee::regrole::text, a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relkind = 'S' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)),
missing_priv as (select * from exp_priv except select * from act_priv),
extra_priv   as (select * from act_priv except select * from exp_priv),
can as (select f.proname, has_function_privilege('anon', f.oid, 'execute') as anon,
               has_function_privilege('authenticated', f.oid, 'execute') as authd,
               has_function_privilege('service_role', f.oid, 'execute') as svc
          from f where (select prorettype from pg_proc where oid = f.oid) <> 'trigger'::regtype),
miss(nr, area, item, list) as (values
 (1,  'structure', '22 tables exist', array(select unnest(array['answer_helpful','answers','audit_logs','categories','consultations','conversations','messages','notifications','payments','profiles','question_likes','questions','reel_likes','reels','reports','saved_answers','scholar_applications','scholar_followers','scholar_services','scholar_slots','scholars','subscriptions']) except select tablename::text from pg_tables where schemaname = 'public')),
 (2,  'structure', '6 views exist', array(select unnest(array['consultation_list','conversation_list','question_feed','reel_feed','scholar_directory','scholar_queue']) except select viewname::text from pg_views where schemaname = 'public')),
 (3,  'structure', '37 functions exist', array(select unnest(array['activate_premium','admin_hide_content','admin_list_applications','admin_list_scholars','admin_list_users','admin_make_scholar','admin_refund_done','admin_reports','admin_review_application','admin_set_premium','admin_set_role','admin_set_suspended','admin_set_verified','admin_stats','book_consultation','cancel_consultation','complete_consultation','confirm_consultation_internal','confirm_consultation_payment','contains_contact_info','conversation_open','conversation_role','delete_my_account','fail_payment','is_admin','is_premium','is_scholar','mark_conversation_read','mark_payment_refunded','moderate_question','question_is_public','question_owned_by_me','record_consultation_order','record_payment_order','reel_viewed','resolve_report','scholar_is_verified']) except select proname::text from fnames)),
 (4,  'structure', '19 triggers exist (incl. new-user profile trigger)', array(select unnest(array['answer_helpful_count|answer_helpful','answer_helpful_limit|answer_helpful','answers_after_insert|answers','answers_before_insert|answers','answers_before_update|answers','messages_before_insert|messages','on_auth_user_created|users','question_likes_count|question_likes','question_likes_limit|question_likes','questions_before_insert|questions','reel_likes_count|reel_likes','reel_likes_limit|reel_likes','reels_before_insert|reels','reports_before_insert|reports','saved_answers_limit|saved_answers','scholar_applications_before_insert|scholar_applications','scholar_followers_limit|scholar_followers','scholar_slots_before_insert|scholar_slots','scholars_before_update|scholars']) except
        select t.tgname || '|' || c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal)),
 (5,  'structure', '47 indexes exist', array(select unnest(array['answer_helpful_pkey','answers_one_per_scholar','answers_pkey','answers_question_idx','answers_scholar_idx','audit_logs_pkey','categories_pkey','categories_slug_key','consultations_pkey','consultations_scholar_idx','consultations_user_idx','conversations_consultation_id_key','conversations_pkey','messages_conv_idx','messages_pkey','notifications_pkey','notifications_user_idx','payments_pkey','payments_provider_order_uidx','payments_provider_payment_id_key','payments_user_idx','profiles_pkey','question_likes_pkey','questions_category_idx','questions_pkey','questions_status_created_idx','questions_user_id_body_hash_key','questions_user_idx','reel_likes_pkey','reels_feed_idx','reels_pkey','reports_pkey','reports_reporter_id_target_type_target_id_key','saved_answers_pkey','scholar_applications_one_pending','scholar_applications_pkey','scholar_applications_status_idx','scholar_followers_pkey','scholar_followers_scholar_idx','scholar_services_pkey','scholar_services_scholar_id_kind_key','scholar_slots_open_idx','scholar_slots_pkey','scholar_slots_scholar_id_starts_at_key','scholars_pkey','subscriptions_one_active','subscriptions_pkey']) except select indexname::text from pg_indexes where schemaname = 'public')),
 (6,  'data', '10 starting categories exist', array(select unnest(array['aqeedah','namaz','roza','zakat','nikah','family','halal-haram','hajj','akhlaq','quran-hadith']) except select slug from public.categories)),
 (7,  'security', 'Row Level Security is ON for every table', array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)),
 (8,  'security', '55 security policies exist (public + storage)', array(select unnest(array['public|answer_helpful|helpful_delete','public|answer_helpful|helpful_insert','public|answer_helpful|helpful_select','public|answers|answers_insert_scholar','public|answers|answers_select','public|answers|answers_update_own','public|audit_logs|audit_select','public|categories|categories_admin_write','public|categories|categories_read','public|consultations|consult_select','public|conversations|conv_select','public|messages|msg_insert','public|messages|msg_select','public|notifications|notif_delete','public|notifications|notif_select','public|notifications|notif_update','public|payments|pay_select','public|profiles|profiles_select','public|profiles|profiles_update_own','public|question_likes|likes_delete','public|question_likes|likes_insert','public|question_likes|likes_select','public|questions|questions_delete_own','public|questions|questions_insert_own','public|questions|questions_select_own','public|reel_likes|reel_likes_delete','public|reel_likes|reel_likes_insert','public|reel_likes|reel_likes_select','public|reels|reels_delete','public|reels|reels_insert','public|reels|reels_select','public|reports|reports_insert','public|reports|reports_select','public|saved_answers|saved_delete','public|saved_answers|saved_insert','public|saved_answers|saved_select','public|scholar_applications|sapp_delete','public|scholar_applications|sapp_insert','public|scholar_applications|sapp_select','public|scholar_followers|follow_delete','public|scholar_followers|follow_insert','public|scholar_followers|follow_select','public|scholar_services|svc_select','public|scholar_services|svc_write','public|scholar_slots|slot_delete','public|scholar_slots|slot_insert','public|scholar_slots|slot_select','public|scholars|scholars_select','public|scholars|scholars_update_own','public|subscriptions|subs_select','storage|objects|qimg_delete','storage|objects|qimg_insert','storage|objects|qimg_select','storage|objects|reels_obj_delete','storage|objects|reels_obj_insert']) except
        select schemaname || '|' || tablename || '|' || policyname from pg_policies)),
 (9,  'security', 'no MISSING table/view/column permissions', array(select kind || ':' || obj || ':' || role || ':' || priv from missing_priv)),
 (10, 'security', 'no EXTRA table/view/column permissions for visitors/users', array(select kind || ':' || obj || ':' || role || ':' || priv from extra_priv)),
 (11, 'security', 'visitors cannot read private tables', array(select t from unnest(array['profiles','questions','messages','conversations','consultations','payments','subscriptions','scholar_applications','notifications','audit_logs','reports','scholars','saved_answers','question_likes','answer_helpful','scholar_followers','reel_likes']) t
        where has_table_privilege('anon', 'public.' || t, 'select'))),
 (12, 'functions', 'visitors may run exactly: 7 helpers + reel_viewed', array(
        (select proname::text from can where anon) except (select unnest(array['conversation_open','conversation_role','is_admin','is_scholar','question_is_public','question_owned_by_me','scholar_is_verified','reel_viewed']))
        union (select unnest(array['conversation_open','conversation_role','is_admin','is_scholar','question_is_public','question_owned_by_me','scholar_is_verified','reel_viewed']) except select proname::text from can where anon))),
 (13, 'functions', 'logged-in users may run exactly: helpers + reel_viewed + 20 app actions', array(
        (select proname::text from can where authd) except (select unnest(array['conversation_open','conversation_role','is_admin','is_scholar','question_is_public','question_owned_by_me','scholar_is_verified','reel_viewed','admin_hide_content','admin_list_applications','admin_list_scholars','admin_list_users','admin_make_scholar','admin_refund_done','admin_reports','admin_review_application','admin_set_premium','admin_set_role','admin_set_suspended','admin_set_verified','admin_stats','book_consultation','cancel_consultation','complete_consultation','delete_my_account','mark_conversation_read','moderate_question','resolve_report']))
        union (select unnest(array['conversation_open','conversation_role','is_admin','is_scholar','question_is_public','question_owned_by_me','scholar_is_verified','reel_viewed','admin_hide_content','admin_list_applications','admin_list_scholars','admin_list_users','admin_make_scholar','admin_refund_done','admin_reports','admin_review_application','admin_set_premium','admin_set_role','admin_set_suspended','admin_set_verified','admin_stats','book_consultation','cancel_consultation','complete_consultation','delete_my_account','mark_conversation_read','moderate_question','resolve_report']) except select proname::text from can where authd))),
 (14, 'functions', '6 payment functions: server (service_role) only', array(select proname::text from can
        where proname = any(array['activate_premium','confirm_consultation_payment','fail_payment','mark_payment_refunded','record_consultation_order','record_payment_order']) and (anon or authd or not svc))),
 (15, 'functions', '3 internal functions: no client access', array(select proname::text from can where proname = any(array['confirm_consultation_internal','contains_contact_info','is_premium']) and (anon or authd))),
 (16, 'versions', 'newest security functions in place (private questions, suspension, image paths)', array(select x from (values
        ('question_feed hides private', coalesce((select pg_get_viewdef('public.question_feed'::regclass) like '%visibility%'), false)),
        ('question_is_public checks visibility', coalesce((select def like '%visibility%' from f where proname = 'question_is_public'), false)),
        ('is_scholar blocks suspended', coalesce((select def like '%suspended%' from f where proname = 'is_scholar'), false)),
        ('answers_after_insert: private not sent to followers', coalesce((select def like '%vis%' from f where proname = 'answers_after_insert'), false)),
        ('questions_before_insert: suspension + image path', coalesce((select def like '%BAD_IMAGE_PATH%' and def like '%SUSPENDED%' from f where proname = 'questions_before_insert'), false))
      ) v(x, good) where not good)),
 (17, 'storage', 'bucket question-images: PRIVATE, 2 MB, jpeg/png/webp', array(select 'question-images' where not exists (
        select 1 from storage.buckets where id = 'question-images' and not public and file_size_limit = 2097152
           and allowed_mime_types @> array['image/jpeg','image/png','image/webp'] and cardinality(allowed_mime_types) = 3))),
 (18, 'storage', 'bucket reels: public, 30 MB, mp4/webm', array(select 'reels' where not exists (
        select 1 from storage.buckets where id = 'reels' and public and file_size_limit = 31457280
           and allowed_mime_types @> array['video/mp4','video/webm'] and cardinality(allowed_mime_types) = 2))),
 (19, 'auth', 'every signed-up user has a profile', array(select u.id::text from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id))),
 (20, 'auth', 'nobody can make themselves admin (role column not writable by users)', array(select 'profiles.role writable' where
        has_column_privilege('authenticated', 'public.profiles', 'role', 'update') or has_column_privilege('anon', 'public.profiles', 'role', 'update')))
),
rows as (select nr, area, item, coalesce(cardinality(list), 0) = 0 as ok,
                case when coalesce(cardinality(list), 0) = 0 then '' else 'problem: ' || left(array_to_string(list, ', '), 300) end as details from miss)
select nr, area, item, ok, details from rows
union all
select 99, 'RESULT', (select count(*) filter (where ok) from rows) || ' of ' || (select count(*) from rows) || ' checks passed',
       bool_and(ok), '' from rows
order by nr;
