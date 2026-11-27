// Real-PostgreSQL tests for supabase/migrations/009_calls.sql (booking-restricted calls, group sessions).
// Run after tests/reset-db.sh:  PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=askdeen node --test tests/db7.test.mjs
// Every function is called as the person would call it (role authenticated + their JWT claims), never as the owner.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const U = {
  cli: 'e0000000-0000-4000-8000-000000000001', cli2: 'e0000000-0000-4000-8000-000000000002', cli3: 'e0000000-0000-4000-8000-000000000003',
  stranger: 'e0000000-0000-4000-8000-000000000004', sch: 'e0000000-0000-4000-8000-0000000000a1', sch2: 'e0000000-0000-4000-8000-0000000000a2',
  unver: 'e0000000-0000-4000-8000-0000000000a3', admin: 'e0000000-0000-4000-8000-0000000000b1', named: 'e0000000-0000-4000-8000-000000000005',
};
const K = n => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function run(script) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE || 'askdeen'], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}
const root = q => run(q + ';');
const pre = who => who === 'anon' ? 'set local role anon;'
  : `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U[who]}","role":"authenticated"}', true) \\gset\n`;
const as = (who, q) => run(`begin;\n${pre(who)}\n${q};\ncommit;`);
const fails = (fn, re) => assert.throws(fn, e => re.test(e.message) || (console.error('unexpected:', e.message), false));
const book = (n, cli, sch, kind, price, start, status = 'confirmed', mins = 30) =>
  root(`insert into consultations(id,user_id,scholar_id,kind,price_paise,duration_min,starts_at,status) values ('${K(n)}','${U[cli]}','${U[sch]}','${kind}',${price},${mins},now()+interval '${start}','${status}')`);
const notifs = (who, msg) => Number(root(`select count(*) from notifications where user_id='${U[who]}' and type='call' and data->>'msg'='${msg}'`));
const endCalls = () => root(`update calls set status='ended', ended_at=now() where status in ('ringing','active'); update call_participants set status='left' where status in ('ringing','joined')`);

before(() => {
  root(`truncate auth.users cascade; truncate payments restart identity cascade`);
  for (const [k, id] of Object.entries(U)) root(`insert into auth.users(id,email,raw_user_meta_data) values('${id}','${k}@example.test','{"display_name":"${k.toUpperCase()}"}')`);
  root(`update profiles set default_anonymous = true; update profiles set default_anonymous = false where id = '${U.named}'`);
  root(`update profiles set role='scholar' where id in ('${U.sch}','${U.sch2}','${U.unver}'); update profiles set role='admin' where id='${U.admin}'`);
  root(`insert into scholars(id,verified,verified_at) values ('${U.sch}',true,now()),('${U.sch2}',true,now()),('${U.unver}',false,null)`);
  book(1, 'cli', 'sch', 'video', 0, '5 minutes');          // free video, in window
  book(2, 'cli', 'sch', 'chat', 0, '5 minutes');           // chat booking
  book(3, 'cli2', 'sch', 'video', 0, '5 minutes', 'cancelled');
  book(4, 'cli2', 'sch', 'video', 5000, '5 minutes');      // paid, payment checked per test
  book(5, 'cli3', 'sch', 'video', 0, '3 days');            // not yet in window
  book(6, 'cli3', 'sch', 'audio', 0, '-2 hours', 'confirmed', 30);   // window over (expired)
  book(7, 'named', 'sch', 'audio', 0, '5 minutes');        // audio booking, named client
  book(8, 'cli', 'unver', 'video', 0, '5 minutes');        // unverified scholar
  book(9, 'cli2', 'sch', 'video', 0, '5 minutes', 'pending_payment');
  book(10, 'cli2', 'sch', 'video', 0, '-3 days', 'completed');   // past, for group invitations
  book(11, 'cli3', 'sch', 'video', 0, '-4 days', 'completed');
  book(12, 'stranger', 'sch2', 'video', 0, '-4 days', 'completed');   // another scholar's client
});

// ---------------------------------------------------------------- one-to-one: who may call ----------------
test('rule 1-4: only the two people of a confirmed, in-window, call-kind booking can start a call', () => {
  fails(() => as('stranger', `select call_start('${K(1)}', true)`), /CALL_NOT_ALLOWED/);
  fails(() => as('sch2', `select call_start('${K(1)}', true)`), /CALL_NOT_ALLOWED/);
  fails(() => as('cli', `select call_start('${K(2)}', false)`), /CALL_NOT_ALLOWED/, 'chat booking');
  fails(() => as('cli2', `select call_start('${K(3)}', false)`), /CALL_NOT_ALLOWED/, 'cancelled');
  fails(() => as('cli2', `select call_start('${K(9)}', false)`), /CALL_NOT_ALLOWED/, 'unconfirmed');
  fails(() => as('cli3', `select call_start('${K(5)}', false)`), /CALL_NOT_ALLOWED/, 'too early');
  fails(() => as('cli3', `select call_start('${K(6)}', false)`), /CALL_NOT_ALLOWED/, 'expired');
  fails(() => as('named', `select call_start('${K(7)}', true)`), /CALL_NOT_ALLOWED/, 'video on an audio booking');
  fails(() => as('cli', `select call_start('${K(8)}', true)`), /CALL_NOT_ALLOWED/, 'unverified scholar');
  fails(() => as('anon', `select call_start('${K(1)}', true)`), /permission denied/);
  assert.match(as('named', `select call_start('${K(7)}', false)`), /^[0-9a-f-]{36}$/, 'voice on an audio booking');
  endCalls();
  assert.match(as('sch', `select call_start('${K(1)}', true)`), /^[0-9a-f-]{36}$/, 'the scholar may call their client');
  endCalls();
});

test('rule 5: a paid booking needs its own verified, not fully refunded payment', () => {
  const pay = (st, amount, refunded, user = 'cli2') => { root(`delete from payments; insert into payments(user_id,amount_paise,currency,provider,provider_order_id,status,purpose,ref_id,refunded_paise) values ('${U[user]}',${amount},'INR','razorpay','order_T${Date.now()}','${st}','consultation','${K(4)}',${refunded})`); };
  root(`delete from payments`);
  fails(() => as('cli2', `select call_start('${K(4)}', true)`), /CALL_NOT_ALLOWED/, 'no payment');
  pay('created', 5000, 0); fails(() => as('cli2', `select call_start('${K(4)}', true)`), /CALL_NOT_ALLOWED/, 'unpaid order');
  pay('failed', 5000, 0); fails(() => as('cli2', `select call_start('${K(4)}', true)`), /CALL_NOT_ALLOWED/, 'failed');
  pay('refunded', 5000, 5000); fails(() => as('cli2', `select call_start('${K(4)}', true)`), /CALL_NOT_ALLOWED/, 'refunded');
  pay('paid', 4000, 0); fails(() => as('cli2', `select call_start('${K(4)}', true)`), /CALL_NOT_ALLOWED/, 'less than the price');
  pay('paid', 5000, 0, 'stranger'); fails(() => as('cli2', `select call_start('${K(4)}', true)`), /CALL_NOT_ALLOWED/, 'someone else paid');
  pay('paid', 5000, 0); const c = as('cli2', `select call_start('${K(4)}', true)`); assert.match(c, /^[0-9a-f-]{36}$/);
  // a refund after the call started closes media access at the next token request
  assert.equal(as('sch', `select call_answer('${c}', true)`), 'joined');
  root(`update payments set status='refunded', refunded_paise=amount_paise`);
  fails(() => as('sch', `select call_join('${c}')`), /CALL_NOT_ALLOWED/);
  endCalls(); root(`delete from payments`);
});

// ---------------------------------------------------------------- one-to-one: life cycle -------------------
test('ringing, busy, answer, token gate, hang-up and history (with anonymity)', () => {
  const c = as('cli', `select call_start('${K(1)}', true)`);
  assert.equal(as('sch', `select video::text||'|'||coalesce(caller_name,'(anon)')||'|'||is_group from call_incoming()`), 'true|(anon)|false', 'anonymous client stays anonymous');
  fails(() => as('sch', `select call_start('${K(1)}', false)`), /BUSY/);
  fails(() => as('stranger', `select call_join('${c}')`), /CALL_NOT_ALLOWED/);
  fails(() => as('sch', `select call_join('${c}')`), /CALL_NOT_ALLOWED/, 'answer first');
  assert.equal(as('stranger', `select call_answer('${c}', true)`), 'gone');
  assert.equal(as('sch', `select call_answer('${c}', true)`), 'joined');
  const j = JSON.parse(as('sch', `select call_join('${c}')`));
  assert.equal(j.group, false); assert.equal(j.host, false); assert.equal(j.video, true); assert.equal(j.camera_on_start, true);
  assert.match(j.room, /^c_[0-9a-f]{32}$/); assert.notEqual(j.participant, U.sch, 'media identity is not the user id');
  assert.equal(as('stranger', `select call_state('${c}')`), '', 'strangers see nothing');
  assert.equal(as('cli', `select call_hangup('${c}')`), 'ended');
  fails(() => as('sch', `select call_join('${c}')`), /CALL_NOT_ALLOWED/, 'ended call');
  assert.equal(as('cli', `select status||'|'||other_name from call_history where id='${c}'`), 'ended|SCH');
  assert.equal(as('sch', `select status||'|'||coalesce(other_name,'(anon)') from call_history where id='${c}'`), 'ended|(anon)');
  assert.equal(as('stranger', `select count(*) from call_history`), '0');
});

test('declined, cancelled and missed calls (45 s) with a missed-call notification', () => {
  let c = as('cli', `select call_start('${K(1)}', false)`);
  assert.equal(as('sch', `select call_answer('${c}', false)`), 'declined');
  assert.equal(root(`select status from calls where id='${c}'`), 'declined');
  c = as('cli', `select call_start('${K(1)}', false)`);
  assert.equal(as('cli', `select call_hangup('${c}')`), 'ended');
  assert.equal(root(`select status from calls where id='${c}'`), 'cancelled');
  c = as('cli', `select call_start('${K(1)}', false)`);
  const before = notifs('sch', 'missed');
  root(`update calls set created_at = now() - interval '1 minute' where id='${c}'`);
  assert.equal(as('sch', `select count(*) from call_incoming()`), '0');
  assert.equal(root(`select status from calls where id='${c}'`), 'missed');
  assert.equal(notifs('sch', 'missed'), before + 1);
});

test('rate limit: at most 6 calls in 10 minutes per caller', () => {
  root(`delete from calls where host_id='${U.named}'`);
  for (let i = 0; i < 6; i++) { as('named', `select call_start('${K(7)}', false)`); endCalls(); }
  fails(() => as('named', `select call_start('${K(7)}', false)`), /RATE_LIMIT/);
  root(`update calls set created_at = now() - interval '11 minutes' where host_id='${U.named}'`);
});

// ---------------------------------------------------------------- groups -----------------------------------
let G, GC;
test('rule 6: only verified, non-suspended scholars and non-suspended admins create group sessions', () => {
  fails(() => as('cli', `select group_session_create('Study circle', now(), 60, true, 5)`), /FORBIDDEN/);
  fails(() => as('unver', `select group_session_create('Study circle', now(), 60, true, 5)`), /FORBIDDEN/);
  fails(() => as('sch', `select group_session_create('Call me 9876543210', now(), 60, true, 5)`), /CONTACT_INFO/);
  root(`update profiles set suspended = true where id in ('${U.sch2}','${U.admin}')`);
  fails(() => as('sch2', `select group_session_create('Study circle', now(), 60, true, 5)`), /FORBIDDEN/);
  fails(() => as('admin', `select group_session_create('Study circle', now(), 60, true, 5)`), /FORBIDDEN/);
  root(`update profiles set suspended = false where id in ('${U.sch2}','${U.admin}')`);
  assert.match(as('admin', `select group_session_create('Admin circle', now(), 60, false, 5)`), /^[0-9a-f-]{36}$/);
  G = as('sch', `select group_session_create('Zakat Q&A', now(), 60, true, 3)`);
  assert.match(G, /^[0-9a-f-]{36}$/);
});

test('rule 7-8: invitations only through the host\'s own bookings; notifications only for real invitations', () => {
  fails(() => as('cli', `select group_session_invite('${G}', '${K(10)}')`), /FORBIDDEN/, 'not the host');
  fails(() => as('sch', `select group_session_invite('${G}', '${K(3)}')`), /FORBIDDEN/, 'cancelled booking');
  fails(() => as('sch', `select group_session_invite('${G}', '${K(12)}')`), /FORBIDDEN/, "another scholar's client");
  const A = as('admin', `select id from group_session_list where i_am_host`);
  fails(() => as('admin', `select group_session_invite('${A}', '${K(10)}')`), /FORBIDDEN/, 'admin cannot mix in other scholars\' clients');
  const n0 = notifs('cli2', 'group_invite');
  assert.equal(as('sch', `select group_session_invite('${G}', '${K(10)}')`), 'invited');
  assert.equal(notifs('cli2', 'group_invite'), n0 + 1);
  assert.equal(as('sch', `select group_session_invite('${G}', '${K(10)}')`), 'already');
  assert.equal(notifs('cli2', 'group_invite'), n0 + 1, 'no second notification');
  assert.equal(as('cli2', `select group_session_respond('${G}', false)`), 'declined');
  assert.equal(as('sch', `select group_session_invite('${G}', '${K(10)}')`), 'invited', 'a declined invitation may be renewed');
  assert.equal(notifs('cli2', 'group_invite'), n0 + 2);
  assert.equal(as('sch', `select group_session_respond('${G}', false)`), 'gone', 'the host cannot leave their own session this way');
  assert.equal(as('cli2', `select coalesce(host_name,'(anon)')||'|'||my_status from group_session_list where id='${G}'`), 'SCH|invited');
});

test('members must accept; the call joins only accepted members; late acceptance; capacity', () => {
  GC = as('sch', `select group_call_start('${G}')`);
  fails(() => as('cli2', `select call_join('${GC}')`), /CALL_NOT_ALLOWED/, 'not accepted yet');
  fails(() => as('cli3', `select call_join('${GC}')`), /CALL_NOT_ALLOWED/, 'not invited');
  fails(() => as('stranger', `select call_join('${GC}')`), /CALL_NOT_ALLOWED/);
  assert.equal(as('cli2', `select group_session_respond('${G}', true)`), 'accepted');
  const j = JSON.parse(as('cli2', `select call_join('${GC}')`));
  assert.equal(j.group, true); assert.equal(j.camera_on_start, false, 'camera OFF at start in group calls'); assert.equal(j.host, false);
  assert.equal(as('sch', `select group_call_start('${G}')`), GC, 'one live call per session');
  // decline the ring / leave, then come back while accepted
  assert.equal(as('cli2', `select call_hangup('${GC}')`), 'left');
  assert.equal(JSON.parse(as('cli2', `select call_join('${GC}')`)).group, true, 'rejoin after leaving');
  // capacity 3 = host + 2
  assert.equal(as('sch', `select group_session_invite('${G}', '${K(11)}')`), 'invited');
  fails(() => as('sch', `select group_session_invite('${G}', '${K(1)}')`), /SESSION_FULL/);
  assert.equal(as('cli3', `select group_session_respond('${G}', true)`), 'accepted');
  assert.equal(JSON.parse(as('cli3', `select call_join('${GC}')`)).group, true);
  const people = JSON.parse(as('cli3', `select call_state('${GC}')`)).people;
  assert.equal(people.length, 3); assert.ok(people.every(p => !('user_id' in p)), 'no user ids exposed');
  assert.ok(!JSON.stringify(people).includes(U.cli2), 'no user ids exposed');
});

test('host controls: remove (live calls only), end for all (group calls only), nobody else', () => {
  const pid = JSON.parse(as('sch', `select call_state('${GC}')`)).people.find(p => !p.host && p.status === 'joined').id;
  fails(() => as('cli2', `select call_remove('${GC}', '${pid}')`), /FORBIDDEN/);
  fails(() => as('cli2', `select call_end_all('${GC}')`), /FORBIDDEN/);
  assert.equal(as('sch', `select call_remove('${GC}', '${pid}')`), pid);
  const removedUser = root(`select user_id from call_participants where id='${pid}'`);
  const who = Object.keys(U).find(k => U[k] === removedUser);
  fails(() => as(who, `select call_join('${GC}')`), /CALL_NOT_ALLOWED/, 'removed member cannot rejoin');
  assert.equal(as(who, `select group_session_respond('${G}', true)`), 'gone', 'removed member cannot accept again');
  fails(() => as('sch', `select group_session_invite('${G}', '${K(who === 'cli2' ? 10 : 11)}')`), /MEMBER_REMOVED/, 'no silent re-invite');
  // end for all
  const room = as('sch', `select call_end_all('${GC}')`);
  assert.match(room, /^c_/);
  assert.equal(root(`select status from calls where id='${GC}'`), 'ended');
  fails(() => as('sch', `select call_remove('${GC}', '${pid}')`), /FORBIDDEN/, 'call no longer live');
  // end-for-all is for group calls only
  const one = as('cli', `select call_start('${K(1)}', false)`);
  fails(() => as('cli', `select call_end_all('${one}')`), /FORBIDDEN/);
  endCalls();
});

test('cancelled / ended / over sessions accept nothing; suspended host loses control', () => {
  const S2 = as('sch', `select group_session_create('Second', now(), 60, true, 5)`);
  as('sch', `select group_session_invite('${S2}', '${K(11)}')`);
  root(`update group_sessions set status='cancelled' where id='${S2}'`);
  assert.equal(as('cli3', `select group_session_respond('${S2}', true)`), 'gone');
  fails(() => as('sch', `select group_call_start('${S2}')`), /CALL_NOT_ALLOWED/);
  fails(() => as('sch', `select group_session_invite('${S2}', '${K(10)}')`), /FORBIDDEN/);
  const S3 = as('sch', `select group_session_create('Third', now(), 15, true, 5)`);
  as('sch', `select group_session_invite('${S3}', '${K(11)}')`);
  root(`update group_sessions set starts_at = now() - interval '1 hour' where id='${S3}'`);
  assert.equal(as('cli3', `select group_session_respond('${S3}', true)`), 'gone', 'session over');
  const S4 = as('sch', `select group_session_create('Fourth', now(), 60, true, 5)`);
  as('sch', `select group_session_invite('${S4}', '${K(11)}')`); as('cli3', `select group_session_respond('${S4}', true)`);
  const C4 = as('sch', `select group_call_start('${S4}')`);
  root(`update profiles set suspended = true where id='${U.sch}'`);
  fails(() => as('sch', `select group_session_invite('${S4}', '${K(10)}')`), /FORBIDDEN/);
  fails(() => as('sch', `select group_call_start('${S4}')`), /CALL_NOT_ALLOWED/);
  fails(() => as('cli3', `select call_join('${C4}')`), /CALL_NOT_ALLOWED/, 'members cannot join a suspended host\'s call');
  fails(() => as('cli', `select call_start('${K(1)}', false)`), /CALL_NOT_ALLOWED/, 'no 1:1 calls with a suspended scholar');
  root(`update profiles set suspended = false where id='${U.sch}'`);
  endCalls();
});

// ---------------------------------------------------------------- permissions ------------------------------
test('no direct table access; views only show my rows; internal helpers closed; definer functions pin search_path', () => {
  for (const t of ['calls', 'call_participants', 'group_sessions', 'group_session_members']) {
    fails(() => as('cli', `select count(*) from ${t}`), /permission denied/);
    fails(() => as('anon', `select count(*) from ${t}`), /permission denied/);
  }
  fails(() => as('stranger', `insert into call_participants(call_id,user_id,role,status) select id,'${U.stranger}','guest','joined' from calls limit 1`), /permission denied/);
  fails(() => as('anon', `select count(*) from call_history`), /permission denied/);
  fails(() => as('cli', `insert into call_history(id) values (gen_random_uuid())`), /permission denied|cannot insert/);
  for (const f of ['call_label(uuid)', 'consultation_callable(public.consultations, boolean)', 'call_housekeeping()', 'group_host_ok()'])
    for (const r of ['anon', 'authenticated']) assert.equal(root(`select has_function_privilege('${r}', 'public.${f}', 'execute')`), 'f', `${r} ${f}`);
  for (const f of ['call_start(uuid,boolean)', 'call_join(uuid)', 'call_incoming()', 'group_session_create(text,timestamptz,integer,boolean,integer)'])
    assert.equal(root(`select has_function_privilege('anon', 'public.${f}', 'execute')`), 'f', `anon ${f}`);
  const loose = root(`select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and (p.proname like 'call\\_%' or p.proname like 'group\\_%' or p.proname = 'consultation_callable')
      and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')`);
  assert.equal(loose, '', 'every 009 SECURITY DEFINER function pins search_path');
  for (const t of ['calls', 'call_participants', 'group_sessions', 'group_session_members'])
    assert.equal(root(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`), 't', `RLS on ${t}`);
});
