// Real-PostgreSQL tests for supabase/patch_004.sql (Phase 1 stability fixes).
// Run after tests/reset-db.sh:  PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=askdeen node --test tests/db4.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const U = { admin: 'aaaaaaaa-0000-4000-8000-000000000001', sch: 'bbbbbbbb-0000-4000-8000-000000000001', amy: 'cccccccc-0000-4000-8000-000000000001', ben: 'cccccccc-0000-4000-8000-000000000002', del: 'cccccccc-0000-4000-8000-000000000003' };
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
// a consultation row written directly (bypasses booking) at a time relative to now
const consult = (start, { status = 'confirmed', price = 0, dur = 30, user = 'amy' } = {}) =>
  root(`insert into consultations(user_id,scholar_id,kind,price_paise,duration_min,starts_at,status) values('${U[user]}','${U.sch}','audio',${price},${dur},now()+interval '${start}','${status}') returning id`);
const statusOf = id => root(`select status||'/'||refund_due from consultations where id='${id}'`);
let CAT;

before(() => {
  root(`truncate auth.users cascade; truncate audit_logs, payments restart identity cascade; delete from storage.objects`);
  for (const [k, id] of Object.entries(U)) root(`insert into auth.users(id,email,raw_user_meta_data) values('${id}','${k}@example.test','{"display_name":"${k.toUpperCase()}"}')`);
  root(`update profiles set role='admin' where id='${U.admin}'`);
  root(`update profiles set role='scholar' where id='${U.sch}'`);
  root(`insert into scholars(id,verified,verified_at) values('${U.sch}',true,now())`);
  CAT = root(`select id from categories where slug='namaz'`);
});

// ------------------------------ H1: refunds ------------------------------
test('H1: refunding a consultation never cancels Premium; refunding Premium never touches a consultation', () => {
  as('service', `select record_payment_order('${U.amy}','order_PREMIUM00001',9900,'INR','razorpay')`);
  as('service', `select activate_premium('${U.amy}','order_PREMIUM00001','pay_PREMIUM00001',9900,'INR','razorpay',30)`);
  const k = consult('3 days', { status: 'pending_payment', price: 19900 });
  as('service', `select record_consultation_order('${U.amy}','${k}','order_CONSULT00001',19900,'INR','razorpay')`);
  as('service', `select confirm_consultation_payment('${U.amy}','order_CONSULT00001','pay_CONSULT00001',19900,'INR')`);
  assert.equal(statusOf(k), 'confirmed/false');

  as('service', `select mark_payment_refunded('pay_CONSULT00001')`);
  assert.equal(root(`select status from subscriptions where user_id='${U.amy}'`), 'active', 'Premium must survive a consultation refund');
  assert.equal(statusOf(k), 'cancelled/false', 'a refunded booking is cancelled and needs no further refund');
  assert.equal(root(`select count(*) from notifications where type='consult' and data->>'msg'='cancelled'`), '2');   // both sides told
  as('service', `select mark_payment_refunded('pay_CONSULT00001')`);                                              // replay: harmless
  assert.equal(root(`select count(*) from notifications where type='consult' and data->>'msg'='cancelled'`), '2');

  const k2 = consult('-2 days', { status: 'completed', price: 19900 });
  root(`update consultations set refund_due=true where id='${k2}'`);
  as('service', `select record_payment_order('${U.amy}','order_PREMIUM00002',9900,'INR','razorpay')`);
  as('service', `select mark_payment_refunded('pay_PREMIUM00001')`);
  assert.equal(root(`select status from subscriptions where user_id='${U.amy}'`), 'cancelled');
  assert.equal(statusOf(k2), 'completed/true', 'a Premium refund never touches a consultation');
  assert.equal(root(`select count(*) from payments where status='refunded'`), '2');
  assert.throws(() => as('amy', `select mark_payment_refunded('pay_PREMIUM00001')`), /permission denied/);           // server only
});
test('H1: a payment that arrives after the hold expired is flagged "refund due"; the refund clears the flag', () => {
  const k = consult('4 days', { status: 'pending_payment', price: 29900, user: 'ben' });
  as('service', `select record_consultation_order('${U.ben}','${k}','order_LATEPAY00001',29900,'INR','razorpay')`);
  root(`update consultations set created_at = now() - interval '20 minutes' where id='${k}'`);
  as('anon', `select consultation_housekeeping()`);                                                   // hold expires
  as('service', `select confirm_consultation_payment('${U.ben}','order_LATEPAY00001','pay_LATEPAY00001',29900,'INR')`);
  assert.equal(statusOf(k), 'cancelled/true');
  as('service', `select mark_payment_refunded('pay_LATEPAY00001')`);
  assert.equal(statusOf(k), 'cancelled/false');
});

// ------------------------------ H2: cancellation rules ------------------------------
test('H2: the client can cancel until 2 hours before the start, not later; can_cancel says the same', () => {
  const early = consult('1 day', { price: 19900 }), late = consult('90 minutes', { price: 19900 }), started = consult('-10 minutes', { price: 19900 });
  const can = id => as('amy', `select can_cancel from consultation_list where id='${id}'`);
  assert.deepEqual([can(early), can(late), can(started)], ['t', 'f', 'f']);
  fails(() => as('amy', `select cancel_consultation('${late}')`), /TOO_LATE_TO_CANCEL/);
  fails(() => as('amy', `select cancel_consultation('${started}')`), /TOO_LATE_TO_CANCEL/);
  as('amy', `select cancel_consultation('${early}')`);
  assert.equal(statusOf(early), 'cancelled/true');                       // paid + confirmed -> refund due
  assert.deepEqual([statusOf(late), statusOf(started)], ['confirmed/false', 'confirmed/false']);
});
test('H2: an unpaid hold can always be cancelled by the client', () => {
  const k = consult('30 minutes', { status: 'pending_payment', price: 19900 });
  as('amy', `select cancel_consultation('${k}')`);
  assert.equal(statusOf(k), 'cancelled/false');
});
test('H2: the scholar can cancel until the session ends (client refunded); the admin at any time', () => {
  const soon = consult('30 minutes', { price: 19900 }), ended = consult('-35 minutes', { price: 19900, dur: 30 }), any = consult('-5 minutes', { price: 19900 });
  assert.equal(as('sch', `select can_cancel from consultation_list where id='${soon}'`), 't');
  as('sch', `select cancel_consultation('${soon}')`);
  assert.equal(statusOf(soon), 'cancelled/true');
  fails(() => as('sch', `select cancel_consultation('${ended}')`), /TOO_LATE_TO_CANCEL/);
  assert.equal(as('admin', `select can_cancel from consultation_list where id='${any}'`), 't');
  as('admin', `select cancel_consultation('${any}')`);
  assert.equal(statusOf(any), 'cancelled/true');
});
test('H2/M2: housekeeping completes finished sessions and releases unpaid holds (anyone may trigger it)', () => {
  const done = consult('-2 hours', { dur: 30 }), running = consult('-10 minutes', { dur: 30 });
  const slot = root(`insert into scholar_slots(scholar_id,starts_at) values('${U.sch}',now()+interval '5 days') returning id`);
  const hold = root(`insert into consultations(user_id,scholar_id,slot_id,kind,price_paise,duration_min,starts_at,status,created_at)
                     values('${U.amy}','${U.sch}','${slot}','audio',19900,30,now()+interval '5 days','pending_payment',now()-interval '20 minutes') returning id`);
  root(`update scholar_slots set status='held' where id='${slot}'`);
  assert.equal(as('anon', `select count(*) from scholar_slots where id='${slot}'`), '0');          // hidden while held
  as('anon', `select consultation_housekeeping()`);
  assert.equal(statusOf(done), 'completed/false');
  assert.equal(statusOf(running), 'confirmed/false');
  assert.equal(statusOf(hold), 'cancelled/false');
  assert.equal(as('anon', `select status from scholar_slots where id='${slot}'`), 'open');          // bookable again
  fails(() => as('amy', `select cancel_consultation('${done}')`), /NOT_CANCELLABLE/);
});

// ------------------------------ M1: overlaps ------------------------------
test('M1: open times may not overlap; overlapping bookings of one scholar are refused', () => {
  root(`delete from scholar_slots`); root(`delete from consultations`);
  as('sch', `insert into scholar_services(scholar_id,kind,price_paise,duration_min) values('${U.sch}','audio',0,15)`);
  const t = `date_trunc('hour', now()) + interval '10 days'`;
  const a = as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}',${t}) returning id`);
  fails(() => as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}',${t} + interval '10 minutes')`), /SLOT_OVERLAP/);
  const b = as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}',${t} + interval '30 minutes') returning id`);
  // the scholar later offers a 60-minute video call: two old slots 30 minutes apart now overlap for it
  as('sch', `insert into scholar_services(scholar_id,kind,price_paise,duration_min) values('${U.sch}','video',0,60)`);
  fails(() => as('sch', `insert into scholar_slots(scholar_id,starts_at) values('${U.sch}',${t} + interval '75 minutes')`), /SLOT_OVERLAP/);
  as('amy', `select book_consultation('${a}','video','')`);
  fails(() => as('ben', `select book_consultation('${b}','video','')`), /SLOT_TAKEN/);                // would double-book 10:30
  assert.equal(root(`select count(*) from consultations where status='confirmed'`), '1');
});

// ------------------------------ M3: reel views ------------------------------
test('M3: reel views count once per logged-in person; anonymous calls are refused', () => {
  const path = `${U.sch}/${'d'.repeat(8)}-0000-4000-8000-000000000001.mp4`;
  const reel = as('sch', `insert into reels(scholar_id,video_path,caption) values('${U.sch}','${path}','A short reminder') returning id`);
  fails(() => as('anon', `select reel_viewed('${reel}')`), /permission denied/);
  as('amy', `select reel_viewed('${reel}')`); as('amy', `select reel_viewed('${reel}')`); as('amy', `select reel_viewed('${reel}')`);
  as('ben', `select reel_viewed('${reel}')`);
  assert.equal(root(`select views_count from reels where id='${reel}'`), '2');
  fails(() => as('amy', `select * from reel_views`), /permission denied/);
});

// ------------------------------ L1/L2 + M6: answers and questions ------------------------------
let q1;
test('L1/L2: hiding an answer fixes the scholar counter and re-opens the question', () => {
  q1 = as('amy', `insert into questions(user_id,category_id,title,body) values('${U.amy}',${CAT},'How many rakats in Maghrib?','details') returning id`);
  as('admin', `select moderate_question('${q1}','open')`);
  const ans = as('sch', `insert into answers(question_id,scholar_id,body) values('${q1}','${U.sch}','Three rakats are fard in Maghrib.') returning id`);
  assert.equal(root(`select answers_count from scholars where id='${U.sch}'`), '1');
  assert.equal(root(`select status from questions where id='${q1}'`), 'answered');
  as('admin', `select admin_hide_content('answer','${ans}')`);
  assert.equal(root(`select answers_count from scholars where id='${U.sch}'`), '0');
  assert.equal(root(`select status from questions where id='${q1}'`), 'open');
  root(`update answers set status='published' where id='${ans}'`);                                   // restored by support
  assert.equal(root(`select status||'/'||(select answers_count from scholars where id='${U.sch}') from questions where id='${q1}'`), 'answered/1');
});
test('M6: the asker cannot delete an answered question, but can delete an unanswered one', () => {
  fails(() => as('amy', `delete from questions where id='${q1}'`), /QUESTION_HAS_ANSWERS/);
  assert.equal(root(`select count(*) from answers where question_id='${q1}'`), '1');
  const q2 = as('amy', `insert into questions(user_id,category_id,title,body) values('${U.amy}',${CAT},'An unanswered question here','x') returning id`);
  as('amy', `delete from questions where id='${q2}'`);
  assert.equal(root(`select count(*) from questions where id='${q2}'`), '0');
});
test('M6: deleting the whole account still removes answered questions (and keeps counters right)', () => {
  const q = as('del', `insert into questions(user_id,category_id,title,body) values('${U.del}',${CAT},'Question from a leaving user','x') returning id`);
  as('admin', `select moderate_question('${q}','open')`);
  as('sch', `insert into answers(question_id,scholar_id,body) values('${q}','${U.sch}','An answer that goes with the account.')`);
  assert.equal(root(`select answers_count from scholars where id='${U.sch}'`), '2');
  as('del', `select delete_my_account()`);
  assert.equal(root(`select count(*) from questions where id='${q}'`), '0');
  assert.equal(root(`select answers_count from scholars where id='${U.sch}'`), '1');
});
