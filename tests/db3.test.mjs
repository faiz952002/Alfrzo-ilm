// Real-PostgreSQL tests for supabase/patch_003.sql: private questions, consultations, messages, reels.
// Run after tests/reset-db.sh:  PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=askdeen node --test tests/db3.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const U = { admin: 'aaaaaaaa-0000-4000-8000-000000000001', sch: 'bbbbbbbb-0000-4000-8000-000000000001', sch2: 'bbbbbbbb-0000-4000-8000-000000000002', amy: 'cccccccc-0000-4000-8000-000000000001', ben: 'cccccccc-0000-4000-8000-000000000002' };
function run(script) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE || 'askdeen'], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}
const root = q => run(q + ';');
const pre = who => who === 'anon' ? 'set local role anon;' : who === 'service' ? 'set local role service_role;'
  : `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U[who]}","role":"authenticated"}', true) \\gset\n`;
const as = (who, q) => run(`begin;\n${pre(who)}\n${q};\ncommit;`);
const fails = (fn, re) => assert.throws(fn, e => re.test(e.message) || (console.error('unexpected:', e.message), false));
let CAT, slotFree, slotPaid, slotPaid2;

before(() => {
  root(`truncate auth.users cascade; truncate audit_logs, payments restart identity cascade; delete from storage.objects`);
  for (const [k, id] of Object.entries(U)) root(`insert into auth.users(id,email,raw_user_meta_data) values('${id}','${k}@example.test','{"display_name":"${k.toUpperCase()}"}')`);
  root(`update profiles set role='admin' where id='${U.admin}'`);
  root(`update profiles set role='scholar' where id in ('${U.sch}','${U.sch2}')`);
  root(`insert into scholars(id,verified,verified_at) values('${U.sch}',true,now()),('${U.sch2}',false,null)`);
  root(`update profiles set default_anonymous=false where id='${U.ben}'`);
  CAT = root(`select id from categories where slug='namaz'`);
});

// ------------------------------ private questions ------------------------------
let qPriv, qPub;
test('private question: never in the public feed, visible to asker, queue shows it to verified scholars without identity', () => {
  qPriv = as('amy', `insert into questions(user_id,category_id,title,body,visibility) values('${U.amy}',${CAT},'A private family matter question','details here','private') returning id`);
  qPub = as('amy', `insert into questions(user_id,category_id,title,body) values('${U.amy}',${CAT},'A public question about wudu','details here') returning id`);
  as('admin', `select moderate_question('${qPriv}','open'); select moderate_question('${qPub}','open')`);
  assert.equal(as('anon', `select count(*) from question_feed where id='${qPriv}'`), '0');
  assert.equal(as('ben', `select count(*) from question_feed where id='${qPriv}'`), '0');
  assert.equal(as('anon', `select count(*) from question_feed where id='${qPub}'`), '1');
  assert.equal(as('amy', `select visibility from questions where id='${qPriv}'`), 'private');
  assert.equal(as('ben', `select count(*) from questions where id='${qPriv}'`), '0');
  assert.equal(as('sch', `select visibility from scholar_queue where id='${qPriv}'`), 'private');
  assert.equal(as('sch2', `select count(*) from scholar_queue`), '0');                       // unverified scholar sees nothing
  assert.ok(!/user_id/.test(as('sch', `select row_to_json(q) from scholar_queue q where id='${qPriv}'`)));
});
test('private answer: only asker, its author and admin can read it; followers are not notified', () => {
  as('ben', `insert into scholar_followers(user_id,scholar_id) values('${U.ben}','${U.sch}')`);
  as('sch', `insert into answers(question_id,scholar_id,body) values('${qPriv}','${U.sch}','This is the private answer text.')`);
  assert.equal(as('amy', `select count(*) from answers where question_id='${qPriv}'`), '1');
  assert.equal(as('sch', `select count(*) from answers where question_id='${qPriv}'`), '1');
  assert.equal(as('admin', `select count(*) from answers where question_id='${qPriv}'`), '1');
  assert.equal(as('ben', `select count(*) from answers where question_id='${qPriv}'`), '0');
  assert.equal(as('anon', `select count(*) from answers where question_id='${qPriv}'`), '0');
  assert.equal(root(`select count(*) from notifications where user_id='${U.ben}' and type='followed'`), '0');
  assert.equal(root(`select count(*) from notifications where user_id='${U.amy}' and type='answer'`), '1');
  assert.equal(as('sch', `select status from scholar_queue where id='${qPriv}'`), 'answered');   // author can still open it to edit
  fails(() => as('ben', `insert into question_likes(user_id,question_id) values('${U.ben}','${qPriv}')`), /row-level security/);
  as('sch', `insert into answers(question_id,scholar_id,body) values('${qPub}','${U.sch}','A public answer text here.')`);
  assert.equal(root(`select count(*) from notifications where user_id='${U.ben}' and type='followed'`), '1');
});

// ------------------------------ consultations ------------------------------
test('services and slots: only a verified scholar manages their own; public sees active services and open future slots', () => {
  as('sch', `insert into scholar_services(scholar_id,kind,price_paise,duration_min) values('${U.sch}','chat',0,30),('${U.sch}','video',39900,30)`);
  fails(() => as('sch2', `insert into scholar_services(scholar_id,kind,price_paise) values('${U.sch2}','chat',0)`), /row-level security/);
  fails(() => as('amy', `insert into scholar_services(scholar_id,kind,price_paise) values('${U.sch}','audio',1)`), /row-level security/);
  fails(() => as('sch', `insert into scholar_services(scholar_id,kind,price_paise) values('${U.sch}','audio',-5)`), /check constraint/);
  slotFree = as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}', now() + interval '2 days') returning id`);
  slotPaid = as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}', now() + interval '3 days') returning id`);
  slotPaid2 = as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}', now() + interval '4 days') returning id`);
  fails(() => as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}', now() - interval '1 hour')`), /row-level security/);
  fails(() => as('amy', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}', now() + interval '5 days')`), /row-level security/);
  assert.equal(as('anon', `select count(*) from scholar_slots where scholar_id='${U.sch}'`), '3');
  assert.equal(as('anon', `select count(*) from scholar_services where scholar_id='${U.sch}'`), '2');
});
let cFree, cPaid;
test('booking a FREE service confirms at once: slot booked, thread opened, both notified, meeting room set', () => {
  fails(() => as('amy', `select book_consultation('${slotFree}','chat','call me on 9876543210')`), /CONTACT_INFO/);
  fails(() => as('amy', `select book_consultation('${slotFree}','audio','')`), /SERVICE_UNAVAILABLE/);
  fails(() => as('sch', `select book_consultation('${slotFree}','chat','')`), /CANNOT_BOOK_SELF/);
  fails(() => as('anon', `select book_consultation('${slotFree}','chat','')`), /permission denied/);
  cFree = as('amy', `select book_consultation('${slotFree}','chat','Question about inheritance')`);
  assert.equal(root(`select status||'/'||(meeting_room is not null) from consultations where id='${cFree}'`), 'confirmed/true');
  assert.equal(root(`select status from scholar_slots where id='${slotFree}'`), 'booked');
  assert.equal(root(`select count(*) from conversations where consultation_id='${cFree}'`), '1');
  assert.equal(root(`select count(*) from notifications where type='consult' and user_id in ('${U.amy}','${U.sch}')`), '2');
  fails(() => as('ben', `select book_consultation('${slotFree}','chat','')`), /SLOT_TAKEN/);
  assert.equal(as('anon', `select count(*) from scholar_slots where id='${slotFree}'`), '0');   // no longer offered
});
test('a PAID booking stays pending: the client cannot confirm it, only the server (service role) can', () => {
  cPaid = as('ben', `select book_consultation('${slotPaid}','video','Business question')`);
  assert.equal(root(`select status||'/'||price_paise||'/'||coalesce(meeting_room,'none') from consultations where id='${cPaid}'`), 'pending_payment/39900/none');
  assert.equal(root(`select status from scholar_slots where id='${slotPaid}'`), 'held');
  fails(() => as('ben', `update consultations set status='confirmed' where id='${cPaid}'`), /permission denied/);
  fails(() => as('ben', `select confirm_consultation_internal('${cPaid}')`), /permission denied/);
  fails(() => as('ben', `select confirm_consultation_payment('${U.ben}','order_X','pay_X',39900,'INR')`), /permission denied/);
  fails(() => as('ben', `select record_consultation_order('${U.ben}','${cPaid}','order_X',39900,'INR','razorpay')`), /permission denied/);
  fails(() => as('service', `select record_consultation_order('${U.ben}','${cPaid}','order_A1',100,'INR','razorpay')`), /AMOUNT_MISMATCH/);
  fails(() => as('service', `select record_consultation_order('${U.amy}','${cPaid}','order_A1',39900,'INR','razorpay')`), /CONSULTATION_NOT_FOUND/);
  as('service', `select record_consultation_order('${U.ben}','${cPaid}','order_A1',39900,'INR','razorpay')`);
  fails(() => as('service', `select confirm_consultation_payment('${U.amy}','order_A1','pay_A1',39900,'INR')`), /USER_MISMATCH/);
  fails(() => as('service', `select confirm_consultation_payment('${U.ben}','order_A1','pay_A1',100,'INR')`), /AMOUNT_MISMATCH/);
  as('service', `select confirm_consultation_payment('${U.ben}','order_A1','pay_A1',39900,'INR')`);
  as('service', `select confirm_consultation_payment('${U.ben}','order_A1','pay_A1',39900,'INR')`);   // replay
  assert.equal(root(`select status from consultations where id='${cPaid}'`), 'confirmed');
  assert.equal(root(`select count(*) from conversations where consultation_id='${cPaid}'`), '1');
  assert.equal(root(`select status||'/'||purpose from payments where provider_order_id='order_A1'`), 'paid/consultation');
  fails(() => as('service', `select activate_premium('${U.ben}','order_A1','pay_A1',39900,'INR','razorpay',30)`), /ORDER_NOT_FOUND/);   // never Premium
  assert.equal(root(`select count(*) from subscriptions where user_id='${U.ben}'`), '0');
});
test('privacy: participants only; scholar sees a name only when the user is not anonymous; never an email', () => {
  assert.equal(as('amy', `select count(*) from consultation_list`), '1');
  assert.equal(as('ben', `select count(*) from consultation_list`), '1');
  assert.equal(as('sch2', `select count(*) from consultation_list`), '0');
  const rows = as('sch', `select coalesce(client_name,'<hidden>') from consultation_list order by starts_at`).split('\n');
  assert.deepEqual(rows, ['<hidden>', 'BEN']);                        // amy is anonymous by default, ben opted out
  assert.ok(!/@example/.test(as('sch', `select row_to_json(c) from consultation_list c`)));
  assert.equal(as('amy', `select count(*) from consultations where id='${cPaid}'`), '0');
});
let conv;
test('messages: only participants, only while confirmed; contact details blocked; one notification per thread', () => {
  conv = root(`select id from conversations where consultation_id='${cFree}'`);
  as('amy', `insert into messages(conversation_id,sender_id,body) values('${conv}','${U.amy}','Assalamu alaikum, my question is ...')`);
  as('amy', `insert into messages(conversation_id,sender_id,body) values('${conv}','${U.amy}','second message')`);
  assert.equal(root(`select count(*) from notifications where type='message' and user_id='${U.sch}'`), '1');
  fails(() => as('sch', `insert into messages(conversation_id,sender_id,body) values('${conv}','${U.sch}','WhatsApp me on +91 98765 43210')`), /CONTACT_INFO/);
  fails(() => as('ben', `insert into messages(conversation_id,sender_id,body) values('${conv}','${U.ben}','let me in')`), /row-level security/);
  fails(() => as('sch', `insert into messages(conversation_id,sender_id,body) values('${conv}','${U.amy}','impersonation')`), /row-level security/);
  assert.equal(as('ben', `select count(*) from messages where conversation_id='${conv}'`), '0');
  assert.equal(as('sch', `select unread from conversation_list where id='${conv}'`), '2');
  as('sch', `select mark_conversation_read('${conv}')`);
  assert.equal(as('sch', `select unread from conversation_list where id='${conv}'`), '0');
  assert.equal(root(`select count(*) from notifications where type='message' and user_id='${U.sch}' and not read`), '0');
  fails(() => as('ben', `select mark_conversation_read('${conv}')`), /FORBIDDEN/);
  assert.equal(as('sch', `select coalesce(other_name,'<hidden>') from conversation_list where id='${conv}'`), '<hidden>');
  assert.equal(as('amy', `select other_name from conversation_list where id='${conv}'`), 'SCH');
});
test('cancel: frees the slot, closes the thread, flags a refund for a paid booking; strangers cannot cancel', () => {
  fails(() => as('amy', `select cancel_consultation('${cPaid}')`), /FORBIDDEN/);
  as('ben', `select cancel_consultation('${cPaid}')`);
  assert.equal(root(`select status||'/'||refund_due from consultations where id='${cPaid}'`), 'cancelled/true');
  assert.equal(root(`select status from scholar_slots where id='${slotPaid}'`), 'open');
  const c2 = root(`select id from conversations where consultation_id='${cPaid}'`);
  fails(() => as('ben', `insert into messages(conversation_id,sender_id,body) values('${c2}','${U.ben}','after cancel')`), /row-level security/);
  fails(() => as('ben', `select admin_refund_done('${cPaid}')`), /FORBIDDEN/);
  as('admin', `select admin_refund_done('${cPaid}')`);
  assert.equal(root(`select refund_due from consultations where id='${cPaid}'`), 'f');
  fails(() => as('sch', `select complete_consultation('${cFree}')`), /NOT_COMPLETABLE/);   // has not started yet
  root(`update consultations set starts_at = now() - interval '1 hour' where id='${cFree}'`);
  fails(() => as('amy', `select complete_consultation('${cFree}')`), /NOT_COMPLETABLE/);
  as('sch', `select complete_consultation('${cFree}')`);
  fails(() => as('amy', `insert into messages(conversation_id,sender_id,body) values('${conv}','${U.amy}','after completion')`), /row-level security/);
});
test('an unpaid hold expires after 15 minutes and the slot becomes bookable again', () => {
  const c = as('ben', `select book_consultation('${slotPaid2}','video','')`);
  root(`update consultations set created_at = now() - interval '20 minutes' where id='${c}'`);
  const c2 = as('amy', `select book_consultation('${slotPaid2}','video','')`);
  assert.equal(root(`select status from consultations where id='${c}'`), 'cancelled');
  assert.equal(root(`select status from consultations where id='${c2}'`), 'pending_payment');
});

// ------------------------------ reels ------------------------------
let reel;
test('reels: only verified scholars post, into their own folder; captions are checked; likes are counted', () => {
  const path = id => `${id}/dddddddd-0000-4000-8000-00000000000${Math.floor(Math.random() * 9)}.mp4`;
  reel = as('sch', `insert into reels(scholar_id,video_path,caption,category_id) values('${U.sch}','${U.sch}/dddddddd-0000-4000-8000-000000000001.mp4','The purpose of the five prayers',${CAT}) returning id`);
  fails(() => as('sch2', `insert into reels(scholar_id,video_path,caption) values('${U.sch2}','${path(U.sch2)}','unverified upload')`), /row-level security/);
  fails(() => as('amy', `insert into reels(scholar_id,video_path,caption) values('${U.amy}','${path(U.amy)}','not a scholar')`), /row-level security/);
  fails(() => as('sch', `insert into reels(scholar_id,video_path,caption) values('${U.sch}','${path(U.amy)}','someone else folder')`), /row-level security/);
  fails(() => as('sch', `insert into reels(scholar_id,video_path,caption) values('${U.sch}','${U.sch}/../../etc/passwd','bad path here')`), /BAD_VIDEO_PATH/);
  fails(() => as('sch', `insert into reels(scholar_id,video_path,caption) values('${U.sch}','${path(U.sch)}','visit www.example.com now')`), /CONTACT_INFO/);
  assert.equal(as('anon', `select scholar_name from reel_feed where id='${reel}'`), 'SCH');
  as('amy', `insert into reel_likes(reel_id,user_id) values('${reel}','${U.amy}')`);
  fails(() => as('amy', `insert into reel_likes(reel_id,user_id) values('${reel}','${U.ben}')`), /row-level security/);
  as('anon', `select reel_viewed('${reel}')`);
  assert.equal(root(`select likes_count||'/'||views_count from reels where id='${reel}'`), '1/1');
  fails(() => as('amy', `update reels set likes_count=999 where id='${reel}'`), /permission denied/);
});
test('reels moderation: report, admin hides it, it leaves the feed; a non-admin cannot hide', () => {
  as('amy', `insert into reports(reporter_id,target_type,target_id,reason) values('${U.amy}','reel','${reel}','misleading content')`);
  fails(() => as('amy', `select admin_hide_content('reel','${reel}')`), /FORBIDDEN/);
  assert.match(as('admin', `select snippet from admin_reports() where target_type='reel'`), /five prayers/);
  as('admin', `select admin_hide_content('reel','${reel}')`);
  assert.equal(as('anon', `select count(*) from reel_feed`), '0');
  assert.equal(as('sch', `select status from reels where id='${reel}'`), 'hidden');
});
test('deleting an account removes its consultations, threads and messages', () => {
  as('amy', `select delete_my_account()`);
  assert.equal(root(`select count(*) from consultations where user_id='${U.amy}'`), '0');
  assert.equal(root(`select count(*) from messages where sender_id='${U.amy}'`), '0');
  assert.equal(root(`select count(*) from conversations where user_id='${U.amy}'`), '0');
});
