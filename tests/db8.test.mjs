// Real-PostgreSQL tests for the configuration part of supabase/migrations/009_calls.sql:
// settings with fixed bounds (D3), groups.max_capacity (D4), the Jitsi fallback room (D5),
// voice-only groups (D7) and the one-to-one camera rule (D8). Runs only through the database guard.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { sqlSync } from './lib/db.mjs';

const U = {
  cli: 'e8000000-0000-4000-8000-000000000001', cli2: 'e8000000-0000-4000-8000-000000000002', cli3: 'e8000000-0000-4000-8000-000000000003',
  stranger: 'e8000000-0000-4000-8000-000000000004', sch: 'e8000000-0000-4000-8000-0000000000a1',
  admin: 'e8000000-0000-4000-8000-0000000000b1', admin2: 'e8000000-0000-4000-8000-0000000000b2',
};
const K = n => `f8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const run = script => sqlSync(script, { sep: '|' });
const root = q => run(q + ';');
const pre = who => who === 'anon' ? 'set local role anon;'
  : `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U[who]}","role":"authenticated"}', true) \\gset\n`;
const as = (who, q) => run(`begin;\n${pre(who)}\n${q};\ncommit;`);
const fails = (fn, re) => assert.throws(fn, e => re.test(e.message) || (console.error('unexpected:', e.message), false));
const book = (n, cli, kind, price, start, status = 'confirmed', mins = 30) =>
  root(`insert into consultations(id,user_id,scholar_id,kind,price_paise,duration_min,starts_at,status,meeting_room) values ('${K(n)}','${U[cli]}','${U.sch}','${kind}',${price},${mins},now()+interval '${start}','${status}','room${n}abc')`);
const endCalls = () => root(`update calls set status='ended', ended_at=now() where status in ('ringing','active'); update call_participants set status='left' where status in ('ringing','joined')`);
const setting = (k, v) => as('admin', `select admin_set_setting('${k}', '${v}'::jsonb)`);

before(() => {
  root(`truncate auth.users cascade; truncate payments restart identity cascade; delete from app_settings`);
  for (const [k, id] of Object.entries(U)) root(`insert into auth.users(id,email,raw_user_meta_data) values('${id}','${k}@example.test','{"display_name":"${k.toUpperCase()}"}')`);
  root(`update profiles set role='scholar' where id='${U.sch}'; update profiles set role='admin' where id in ('${U.admin}','${U.admin2}')`);
  root(`insert into scholars(id,verified,verified_at) values ('${U.sch}',true,now())`);
  book(1, 'cli', 'video', 0, '5 minutes');
  book(2, 'cli2', 'audio', 0, '5 minutes');
  book(3, 'cli3', 'video', 0, '-3 days', 'completed');
  book(4, 'cli2', 'video', 0, '-3 days', 'completed');
  book(5, 'cli', 'video', 5000, '5 minutes');           // paid, no payment
  book(6, 'cli', 'video', 0, '5 minutes', 'cancelled');
  book(7, 'cli3', 'video', 0, '40 minutes');           // outside default window (10 min before)
});

// ---------------------------------------------------------------- D3 settings ------------------------------
test('D3: defaults are used while nothing is stored', () => {
  assert.equal(root(`select setting_int('calls.ring_timeout_seconds')||'|'||setting_int('calls.window_before_min')||'|'||setting_int('calls.window_after_min')||'|'||setting_int('calls.max_starts_per_10min')||'|'||setting_int('groups.max_capacity')||'|'||setting_bool('calls.one_to_one_camera_on')`),
    '45|10|15|6|50|true');
});

test('D3: only a non-suspended admin can read or change settings; changes are audited', () => {
  fails(() => as('cli', `select admin_set_setting('calls.ring_timeout_seconds', '30'::jsonb)`), /FORBIDDEN/);
  fails(() => as('sch', `select admin_get_settings()`), /FORBIDDEN/);
  fails(() => as('anon', `select admin_set_setting('calls.ring_timeout_seconds', '30'::jsonb)`), /permission denied/);
  root(`update profiles set suspended = true where id='${U.admin2}'`);
  fails(() => as('admin2', `select admin_set_setting('calls.ring_timeout_seconds', '30'::jsonb)`), /FORBIDDEN/);
  root(`update profiles set suspended = false where id='${U.admin2}'`);
  assert.equal(setting('calls.ring_timeout_seconds', '30'), '30');
  assert.equal(root(`select setting_int('calls.ring_timeout_seconds')`), '30');
  assert.equal(root(`select count(*) from audit_logs where action='setting_changed' and target='calls.ring_timeout_seconds' and actor_id='${U.admin}'`), '1');
  assert.equal(as('admin', `select count(*) from admin_get_settings()`), '6');
  setting('calls.ring_timeout_seconds', '45');
});

test('D3: hard bounds, unknown keys and wrong types are refused - also for admins and also for direct writes', () => {
  const bad = [['calls.ring_timeout_seconds', '14'], ['calls.ring_timeout_seconds', '121'], ['calls.window_before_min', '-1'], ['calls.window_before_min', '31'],
    ['calls.window_after_min', '31'], ['calls.max_starts_per_10min', '0'], ['calls.max_starts_per_10min', '11'], ['groups.max_capacity', '1'], ['groups.max_capacity', '51'],
    ['calls.ring_timeout_seconds', '30.5'], ['calls.ring_timeout_seconds', '"30"'], ['calls.one_to_one_camera_on', '1'], ['calls.one_to_one_camera_on', '"yes"'],
    ['calls.require_payment', 'false'], ['groups.camera_allowed', 'true'], ['anything', '1']];
  for (const [k, v] of bad) fails(() => setting(k, v), /BAD_SETTING/);
  // even the table owner cannot store an invalid value (trigger)
  fails(() => root(`insert into app_settings(key, value) values ('groups.max_capacity', '500')`), /BAD_SETTING/);
  fails(() => root(`insert into app_settings(key, value) values ('payments.required', 'false')`), /BAD_SETTING/);
  // clients cannot touch the table at all
  fails(() => as('admin', `select count(*) from app_settings`), /permission denied/);
  fails(() => as('admin', `insert into app_settings(key, value) values ('groups.max_capacity', '10')`), /permission denied/);
  for (const f of ['setting_int(text)', 'setting_bool(text)', 'setting_valid(text,jsonb)', 'setting_spec(text)'])
    for (const r of ['anon', 'authenticated']) assert.equal(root(`select has_function_privilege('${r}', 'public.${f}', 'execute')`), 'f', `${r} ${f}`);
  // a stored value that is somehow invalid falls back to the default when read
  root(`alter table app_settings disable trigger app_settings_before_write; insert into app_settings(key, value) values ('calls.window_after_min', '999') on conflict (key) do update set value = excluded.value; alter table app_settings enable trigger app_settings_before_write`);
  assert.equal(root(`select setting_int('calls.window_after_min')`), '15');
  root(`delete from app_settings where key='calls.window_after_min'`);
});

test('D3: settings really drive the call rules (window, rate limit, ring timeout)', () => {
  fails(() => as('cli3', `select call_start('${K(7)}', true)`), /CALL_NOT_ALLOWED/, '40 minutes ahead, default window 10');
  setting('calls.window_before_min', '30');
  fails(() => as('cli3', `select call_start('${K(7)}', true)`), /CALL_NOT_ALLOWED/, 'still outside a 30-minute window');
  root(`update consultations set starts_at = now() + interval '25 minutes' where id='${K(7)}'`);
  assert.match(as('cli3', `select call_start('${K(7)}', true)`), /^[0-9a-f-]{36}$/, 'inside the widened window');
  endCalls(); setting('calls.window_before_min', '10');
  setting('calls.max_starts_per_10min', '1');
  root(`delete from calls where host_id='${U.cli2}'`);
  as('cli2', `select call_start('${K(2)}', false)`); endCalls();
  fails(() => as('cli2', `select call_start('${K(2)}', false)`), /RATE_LIMIT/);
  setting('calls.max_starts_per_10min', '6'); root(`delete from calls where host_id='${U.cli2}'`);
  setting('calls.ring_timeout_seconds', '15');
  const c = as('cli', `select call_start('${K(1)}', false)`);
  root(`update calls set created_at = now() - interval '20 seconds' where id='${c}'`);
  as('sch', `select count(*) from call_incoming()`);
  assert.equal(root(`select status from calls where id='${c}'`), 'missed', '15 s ring timeout applied');
  setting('calls.ring_timeout_seconds', '45');
});

// ---------------------------------------------------------------- D4 capacity ------------------------------
test('D4: groups.max_capacity is enforced on create, invite and join', () => {
  setting('groups.max_capacity', '2');
  fails(() => as('sch', `select group_session_create('Big circle', now(), 60, 3)`), /CAPACITY_TOO_LARGE/);
  const G = as('sch', `select group_session_create('Small circle', now(), 60, 2)`);
  assert.equal(as('sch', `select group_session_invite('${G}', '${K(3)}')`), 'invited');
  fails(() => as('sch', `select group_session_invite('${G}', '${K(4)}')`), /SESSION_FULL/);
  // an older session created with a bigger capacity is still limited by the current setting
  setting('groups.max_capacity', '50');
  const G2 = as('sch', `select group_session_create('Older circle', now(), 60, 10)`);
  as('sch', `select group_session_invite('${G2}', '${K(3)}')`); as('sch', `select group_session_invite('${G2}', '${K(4)}')`);
  as('cli3', `select group_session_respond('${G2}', true)`); as('cli2', `select group_session_respond('${G2}', true)`);
  setting('groups.max_capacity', '2');
  const C = as('sch', `select group_call_start('${G2}')`);
  assert.equal(JSON.parse(as('cli3', `select call_join('${C}')`)).group, true, 'host + 1 = 2');
  fails(() => as('cli2', `select call_join('${C}')`), /SESSION_FULL/, 'the third person is refused');
  setting('groups.max_capacity', '50'); endCalls();
  fails(() => root(`insert into group_sessions(host_id,title,starts_at,duration_min,capacity) values ('${U.sch}','Too big', now(), 60, 51)`), /capacity_check|violates check/);
});

// ---------------------------------------------------------------- D7 voice-only groups / D8 camera ---------
test('D7: group calls are voice only: no video session can exist and call_join never allows a camera', () => {
  fails(() => root(`insert into group_sessions(host_id,title,video,starts_at,duration_min,capacity) values ('${U.sch}','Video group', true, now(), 60, 5)`), /video_check|violates check/);
  const G = as('sch', `select group_session_create('Voice circle', now(), 60, 5)`);
  as('sch', `select group_session_invite('${G}', '${K(3)}')`); as('cli3', `select group_session_respond('${G}', true)`);
  const C = as('sch', `select group_call_start('${G}')`);
  assert.equal(root(`select video from calls where id='${C}'`), 'f');
  fails(() => root(`update calls set video = true where id='${C}'`), /calls_group_voice_only/);
  setting('calls.one_to_one_camera_on', 'true');
  for (const who of ['sch', 'cli3']) {
    const j = JSON.parse(as(who, `select call_join('${C}')`));
    assert.equal(j.camera_allowed, false, `${who}: no camera in a group`); assert.equal(j.camera_on_start, false); assert.equal(j.video, false);
  }
  endCalls();
});

test('D8: camera only in one-to-one calls of a video booking; the setting only chooses the start state', () => {
  const join = (cid) => { as('sch', `select call_answer('${cid}', true)`); return JSON.parse(as('sch', `select call_join('${cid}')`)); };
  setting('calls.one_to_one_camera_on', 'true');
  let j = join(as('cli', `select call_start('${K(1)}', true)`));
  assert.deepEqual([j.camera_allowed, j.camera_on_start], [true, true]); endCalls();
  setting('calls.one_to_one_camera_on', 'false');
  j = join(as('cli', `select call_start('${K(1)}', true)`));
  assert.deepEqual([j.camera_allowed, j.camera_on_start], [true, false], 'still allowed, starts off'); endCalls();
  setting('calls.one_to_one_camera_on', 'true');
  j = join(as('cli', `select call_start('${K(1)}', false)`));
  assert.deepEqual([j.camera_allowed, j.camera_on_start], [false, false], 'voice call on a video booking: no camera'); endCalls();
  j = join(as('cli2', `select call_start('${K(2)}', false)`));
  assert.deepEqual([j.camera_allowed, j.camera_on_start], [false, false], 'audio booking: never a camera'); endCalls();
  fails(() => as('cli2', `select call_start('${K(2)}', true)`), /CALL_NOT_ALLOWED/);
});

// ---------------------------------------------------------------- D5 fallback --------------------------------
test('D5: the Jitsi fallback room follows exactly the same rules as a call', () => {
  assert.equal(as('cli', `select call_fallback_room('${K(1)}', true)`), 'room1abc');
  assert.equal(as('sch', `select call_fallback_room('${K(1)}', false)`), 'room1abc');
  fails(() => as('stranger', `select call_fallback_room('${K(1)}', true)`), /CALL_NOT_ALLOWED/);
  fails(() => as('cli', `select call_fallback_room('${K(5)}', true)`), /CALL_NOT_ALLOWED/, 'paid booking without payment');
  fails(() => as('cli', `select call_fallback_room('${K(6)}', true)`), /CALL_NOT_ALLOWED/, 'cancelled');
  fails(() => as('cli2', `select call_fallback_room('${K(2)}', true)`), /CALL_NOT_ALLOWED/, 'video on an audio booking');
  fails(() => as('cli3', `select call_fallback_room('${K(3)}', true)`), /CALL_NOT_ALLOWED/, 'completed / outside window');
  root(`update profiles set suspended = true where id='${U.cli}'`);
  fails(() => as('cli', `select call_fallback_room('${K(1)}', true)`), /CALL_NOT_ALLOWED/, 'suspended');
  root(`update profiles set suspended = false where id='${U.cli}'`);
  fails(() => as('anon', `select call_fallback_room('${K(1)}', true)`), /permission denied/);
  root(`update consultations set meeting_room = null where id='${K(1)}'`);
  fails(() => as('cli', `select call_fallback_room('${K(1)}', true)`), /CALL_NOT_ALLOWED/, 'no room');
  root(`update consultations set meeting_room = 'room1abc' where id='${K(1)}'`);
});
