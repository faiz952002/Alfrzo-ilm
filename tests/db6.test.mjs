// Real-PostgreSQL tests for supabase/migrations/008_profile_settings.sql (profile photo, notification preference, name checks).
// Run after tests/reset-db.sh:  PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=askdeen node --test tests/db6.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const U = { ana: 'dddddddd-0000-4000-8000-0000000000a1', ben: 'dddddddd-0000-4000-8000-0000000000b1', odd: 'dddddddd-0000-4000-8000-0000000000c1' };
function run(script) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE || 'askdeen'], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}
const root = q => run(q + ';');
const pre = who => who === 'anon' ? 'set local role anon;'
  : `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U[who]}","role":"authenticated"}', true) \\gset\n`;
const as = (who, q) => run(`begin;\n${pre(who)}\n${q};\ncommit;`);
const fails = (fn, re) => assert.throws(fn, e => re.test(e.message) || (console.error('unexpected:', e.message), false));
const col = (who, c) => root(`select ${c} from profiles where id='${U[who]}'`);

before(() => {
  root(`truncate auth.users cascade; delete from storage.objects`);
  root(`insert into auth.users(id,email,raw_user_meta_data) values ('${U.ana}','ana@example.test','{"display_name":"Ana"}'),
        ('${U.ben}','ben@example.test','{"display_name":"Ben"}'), ('${U.odd}','odd@example.test','{"display_name":"π ʒ^07 !"}')`);
});

test('new columns: defaults, and users may update only their own preference / photo columns', () => {
  assert.equal(col('ana', 'notify_consult'), 't');
  assert.equal(col('ana', "coalesce(avatar_path,'none')"), 'none');
  as('ana', `update profiles set notify_consult = false where id = auth.uid()`);
  assert.equal(col('ana', 'notify_consult'), 'f');
  as('ben', `update profiles set notify_consult = true, display_name = 'Hacked' where id = '${U.ana}'`);   // RLS: matches no row
  assert.equal(col('ana', 'notify_consult'), 'f'); assert.equal(col('ana', 'display_name'), 'Ana');
  fails(() => as('ana', `update profiles set role = 'admin' where id = auth.uid()`), /permission denied/);
  fails(() => as('anon', `update profiles set notify_consult = true`), /permission denied/);
});

test('photo path must point into the owner\'s own folder of the avatars bucket', () => {
  as('ana', `update profiles set avatar_path = '${U.ana}/avatar-1732600000000.webp' where id = auth.uid()`);
  assert.equal(col('ana', 'avatar_path'), `${U.ana}/avatar-1732600000000.webp`);
  for (const bad of [`${U.ben}/avatar-1732600000000.webp`, `${U.ana}/../x.webp`, `${U.ana}/avatar-1732600000000.svg`, 'https://evil.example/x.png'])
    fails(() => as('ana', `update profiles set avatar_path = '${bad}' where id = auth.uid()`), /profiles_avatar_path_own/);
});

test('avatars bucket is private, 1 MB, images only; files: owner only', () => {
  assert.equal(root(`select public::text||'|'||file_size_limit||'|'||array_to_string(allowed_mime_types,',') from storage.buckets where id='avatars'`), 'false|1048576|image/jpeg,image/png,image/webp');
  as('ana', `insert into storage.objects(bucket_id,name,owner) values ('avatars','${U.ana}/avatar-1.webp',auth.uid())`);
  fails(() => as('ana', `insert into storage.objects(bucket_id,name,owner) values ('avatars','${U.ben}/avatar-1.webp',auth.uid())`), /row-level security/);
  fails(() => as('anon', `insert into storage.objects(bucket_id,name) values ('avatars','${U.ana}/avatar-2.webp')`), /permission denied|row-level security/);
  assert.equal(as('ben', `select count(*) from storage.objects where bucket_id='avatars'`), '0', 'another user cannot see the file');
  let anonSees = '0'; try { anonSees = as('anon', `select count(*) from storage.objects where bucket_id='avatars'`); } catch (e) { assert.match(e.message, /permission denied/); }
  assert.equal(anonSees, '0', 'visitors cannot see the file');
  assert.equal(as('ben', `with d as (delete from storage.objects where bucket_id='avatars' returning 1) select count(*) from d`), '0', 'another user cannot delete it');
  assert.equal(as('ana', `select count(*) from storage.objects where bucket_id='avatars'`), '1');
  assert.equal(as('ana', `with d as (delete from storage.objects where bucket_id='avatars' returning 1) select count(*) from d`), '1');
});

test('display names are checked only when they change; existing names stay untouched', () => {
  as('odd', `update profiles set language = 'en', notify_followed = false where id = auth.uid()`);
  assert.equal(col('odd', 'display_name'), 'π ʒ^07 !', 'an unrelated change never rewrites the existing name');
  for (const bad of ['   ', 'Ali\u200bKhan', 'A\u202eB', 'x\u0007y']) fails(() => as('odd', `update profiles set display_name = E'${bad.replace(/[\u0000-\u001f\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))}' where id = auth.uid()`), /BAD_NAME/);
  fails(() => as('odd', `update profiles set display_name = 'call 98765 43210' where id = auth.uid()`), /CONTACT_INFO/);
  fails(() => as('odd', `update profiles set display_name = 'me@mail.com' where id = auth.uid()`), /CONTACT_INFO/);
  assert.equal(col('odd', 'display_name'), 'π ʒ^07 !');
  as('odd', `update profiles set display_name = '  ज़ैद   ख़ान  ' where id = auth.uid()`);
  assert.equal(col('odd', 'display_name'), 'ज़ैद ख़ान', 'trimmed, inner spaces collapsed, unicode kept exactly');
});

test('consultation notifications follow notify_consult; account and other notifications are always created', () => {
  root(`delete from notifications`);
  root(`update profiles set notify_consult = false where id = '${U.ana}'`);
  root(`insert into notifications(user_id,type,data) values ('${U.ana}','consult','{}'),('${U.ana}','system','{}'),('${U.ana}','answer','{}'),('${U.ben}','consult','{}')`);
  assert.equal(root(`select string_agg(type, ',' order by type) from notifications where user_id='${U.ana}'`), 'answer,system');
  assert.equal(root(`select count(*) from notifications where user_id='${U.ben}' and type='consult'`), '1');
  root(`update profiles set notify_consult = true where id = '${U.ana}'`);
  root(`insert into notifications(user_id,type,data) values ('${U.ana}','consult','{}')`);
  assert.equal(root(`select count(*) from notifications where user_id='${U.ana}' and type='consult'`), '1');
});

test('the new trigger functions cannot be called by clients', () => {
  for (const fn of ['profiles_before_update()', 'notifications_before_insert()'])
    for (const r of ['anon', 'authenticated']) assert.equal(root(`select has_function_privilege('${r}', 'public.${fn}', 'execute')`), 'f', `${r} ${fn}`);
});

test('account deletion still removes the profile (with the new columns)', () => {
  as('ben', `select delete_my_account()`);
  assert.equal(root(`select count(*) from profiles where id='${U.ben}'`), '0');
  assert.equal(root(`select count(*) from auth.users where id='${U.ben}'`), '0');
});
