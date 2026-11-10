// Real-Postgres tests for supabase/schema.sql (+ patches) - RLS, triggers, RPCs.
// Zero npm dependencies: statements are sent through the `psql` CLI.
// Run: PGHOST=/tmp PGPORT=54329 PGUSER=postgres PGDATABASE=askdeen node --test tests/db.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const ID = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  sch: '00000000-0000-0000-0000-0000000000b1',
  sch2: '00000000-0000-0000-0000-0000000000b2',
  a: '00000000-0000-0000-0000-0000000000c1',
  b: '00000000-0000-0000-0000-0000000000c2',
};

const lit = v => v === null || v === undefined ? 'null'
  : typeof v === 'number' ? String(v)
  : `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/'/g, "''")}'`;
const bind = (q, p = []) => q.replace(/\$(\d+)/g, (_, n) => lit(p[n - 1]));

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false, i = 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  if (!rows.length) return [];
  const [hdr, ...data] = rows;
  return data.map(r => Object.fromEntries(hdr.map((h, k) => [h, r[k] === undefined ? null : r[k]])));
}
const num = o => { for (const k in o) if (/^-?\d+$/.test(o[k]) && o[k].length < 10) o[k] = Number(o[k]); else if (o[k] === 't') o[k] = true; else if (o[k] === 'f') o[k] = false; return o; };

function psql(script) {
  return new Promise((resolve, reject) => {
    const p = spawn('psql', ['-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1'], { env: { ...process.env, PGDATABASE: process.env.PGDATABASE || 'askdeen' } });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim() || `psql exit ${code}`)));
    p.stdin.end(script);
  });
}
const pool = { async query(q, p) { const rows = parseCsv(await psql(bind(q, p) + ';')).map(num); return { rows, rowCount: rows.length }; }, end() {} };

// Run ONE statement as a Supabase-like identity (role + JWT claims), atomically.
async function as(who, fn) {
  const pre = who === 'anon' ? 'set local role anon;'
    : who === 'service' ? 'set local role service_role;'
    : `set local role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: ID[who], role: 'authenticated' }))}, true) \\gset\n`;
  const c = { query: async (q, p) => parseCsv(await psql(`begin;\n${pre}\n${bind(q, p)};\ncommit;`)).map(num) };
  return fn(c);
}
const sql = (c, q, p) => c.query(q, p);
const rejects = (p, re) => assert.rejects(p, e => { const ok = !re || (typeof re === 'string' ? e.message.includes(re) : re.test(e.message)); if (!ok) console.error('  unexpected error:', e.message.trim()); return ok; });
const catRow = async () => (await pool.query("select id from categories where slug='namaz'")).rows[0].id;
let CAT;

before(async () => {
  await psql(`truncate auth.users cascade; truncate audit_logs, payments, subscriptions restart identity cascade; delete from storage.objects;`);
  for (const [k, id] of Object.entries(ID))
    await pool.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)`, [id, `${k}@example.test`, { display_name: k.toUpperCase() }]);
  await pool.query(`update profiles set role='admin' where id=$1`, [ID.admin]);
  await pool.query(`insert into scholars(id,verified,verified_at) values($1,true,now())`, [ID.admin]);
  CAT = await catRow();
});

test('signup trigger creates profile with role=user', async () => {
  const r = await pool.query('select role, display_name from profiles where id=$1', [ID.a]);
  assert.equal(r.rows[0].role, 'user'); assert.equal(r.rows[0].display_name, 'A');
});

test('only admin can make scholars / verify', async () => {
  await rejects(as('a', c => sql(c, `select admin_make_scholar('sch@example.test')`)), 'FORBIDDEN');
  await as('admin', async c => {
    await sql(c, `select admin_make_scholar('sch@example.test')`);
    await sql(c, `select admin_make_scholar('sch2@example.test')`);
    await sql(c, `select admin_set_verified($1,true)`, [ID.sch]);
  });
  const r = await pool.query('select verified from scholars where id in ($1,$2) order by id', [ID.sch, ID.sch2]);
  assert.deepEqual(r.rows.map(x => x.verified), [true, false]);
  await rejects(as('anon', c => sql(c, `select admin_stats()`)), /permission denied/);
});

test('users cannot escalate role or self-verify', async () => {
  await rejects(as('a', c => sql(c, `update profiles set role='admin' where id=$1`, [ID.a])), /permission denied/);
  await rejects(as('sch2', c => sql(c, `update scholars set verified=true where id=$1`, [ID.sch2])), /permission denied/);
});

test('profiles are private to their owner', async () => {
  const rows = await as('b', c => sql(c, 'select id from profiles'));
  assert.deepEqual(rows.map(r => r.id), [ID.b]);
});

let Q1;
test('question insert: forced pending_review, validations, anti-spam', async () => {
  Q1 = (await as('a', c => sql(c, `insert into questions(user_id,category_id,title,body,status,likes_count)
     values($1,$2,'Agar namaz chhoot jaye to kya qaza zaroori hai?','details','open',99) returning id,status,likes_count`, [ID.a, CAT])))[0];
  assert.equal(Q1.status, 'pending_review'); assert.equal(Q1.likes_count, 0);
  await rejects(as('a', c => sql(c, `insert into questions(user_id,title) values($1,'short')`, [ID.a])), /check/);
  await rejects(as('a', c => sql(c, `insert into questions(user_id,title,body) values($1,'Mera number 9876543210 hai call karo','')`, [ID.a])), 'CONTACT_INFO');
  await rejects(as('a', c => sql(c, `insert into questions(user_id,title,body) values($1,'Mujhe batao kya yeh jaiz hai?','mail me@x.com')`, [ID.a])), 'CONTACT_INFO');
  await rejects(as('a', c => sql(c, `insert into questions(user_id,title,body) values($1,'Mujhe batao kya yeh jaiz hai?','see https://x.y')`, [ID.a])), 'CONTACT_INFO');
  await rejects(as('a', c => sql(c, `insert into questions(user_id,category_id,title,body) values($1,$2,'Agar namaz chhoot jaye to kya qaza zaroori hai?','details')`, [ID.a, CAT])), /duplicate key/);
  await rejects(as('a', c => sql(c, `insert into questions(user_id,title) values($1,'Kya nikah mein gawah zaroori hain?')`, [ID.b])), /row-level security/);
});

test('rate limit: max 5 questions / hour', async () => {
  for (let i = 0; i < 3; i++) await as('b', c => sql(c, `insert into questions(user_id,title) values($1,$2)`, [ID.b, `Rate limit test question number ${i}`]));
  for (let i = 3; i < 5; i++) await as('b', c => sql(c, `insert into questions(user_id,title) values($1,$2)`, [ID.b, `Rate limit test question number ${i}`]));
  await rejects(as('b', c => sql(c, `insert into questions(user_id,title) values($1,'Rate limit test question number 6')`, [ID.b])), 'RATE_LIMIT');
});

test('questions table is private; pending questions are not public', async () => {
  await rejects(as('anon', c => sql(c, 'select * from questions')), /permission denied/);
  assert.equal((await as('b', c => sql(c, 'select id from questions where id=$1', [Q1.id]))).length, 0);
  assert.equal((await as('anon', c => sql(c, 'select id from question_feed where id=$1', [Q1.id]))).length, 0);
  assert.equal((await as('a', c => sql(c, 'select id from questions where id=$1', [Q1.id]))).length, 1);
  await rejects(as('a', c => sql(c, `update questions set status='open' where id=$1`, [Q1.id])), /permission denied/);
});

test('only admin can moderate; approved question appears in feed without identity', async () => {
  await rejects(as('a', c => sql(c, `select moderate_question($1,'open')`, [Q1.id])), 'FORBIDDEN');
  await as('admin', c => sql(c, `select moderate_question($1,'open')`, [Q1.id]));
  const feed = await as('anon', c => sql(c, 'select * from question_feed where id=$1', [Q1.id]));
  assert.equal(feed.length, 1);
  assert.ok(!feed[0].asker_name, 'anonymous asker must have no name');
  assert.ok(!('user_id' in feed[0]));
  const n = await as('a', c => sql(c, `select type from notifications`));
  assert.ok(n.some(x => x.type === 'status'));
});

test('answers: only VERIFIED scholars; contact info blocked; counters + notifications', async () => {
  const ins = (who, id, body = 'Haan, qaza ada karna wajib hai. Wallahu a\'lam.') =>
    as(who, c => sql(c, `insert into answers(question_id,scholar_id,body,quran_refs,hadith_refs) values($1,$2,$3,'Surah Al-Baqarah 2:238','Sahih Bukhari 597') returning id`, [Q1.id, ID[id], body]));
  await rejects(ins('a', 'a'), /row-level security|permission/);
  await rejects(ins('sch2', 'sch2'), /row-level security/);       // not verified
  await rejects(ins('sch', 'sch2'), /row-level security/);        // impersonation
  await rejects(ins('sch', 'sch', 'Call me on 9876543210 for fatwa'), 'CONTACT_INFO');
  await rejects(ins('sch', 'sch', 'Visit www.example.com for details'), 'CONTACT_INFO');
  const a1 = (await ins('sch', 'sch'))[0];
  assert.ok(a1.id);
  const st = (await pool.query('select status from questions where id=$1', [Q1.id])).rows[0].status;
  assert.equal(st, 'answered');
  assert.equal((await pool.query('select answers_count from scholars where id=$1', [ID.sch])).rows[0].answers_count, 1);
  const n = await as('a', c => sql(c, `select type from notifications where type='answer'`));
  assert.equal(n.length, 1);
});

test('answers: public read; only owner scholar can edit', async () => {
  const pub = await as('anon', c => sql(c, 'select id from answers where question_id=$1', [Q1.id]));
  assert.equal(pub.length, 1);
  const aid = pub[0].id;
  await as('sch', c => sql(c, `update answers set body='Updated answer text here.' where id=$1`, [aid]));
  assert.equal((await pool.query('select body from answers where id=$1', [aid])).rows[0].body, 'Updated answer text here.');
  const r = await as('sch2', c => sql(c, `update answers set body='hijacked answer text' where id=$1 returning id`, [aid]));
  assert.equal(r.length, 0);
  await rejects(as('sch', c => sql(c, `update answers set helpful_count=500 where id=$1`, [aid])), /permission denied/);
});

test('rejected/hidden question hides its answers from the public', async () => {
  const q = (await as('a', c => sql(c, `insert into questions(user_id,title) values($1,'Question that will be rejected later ok') returning id`, [ID.a])))[0].id;
  // answers cannot be created while pending
  await rejects(as('sch', c => sql(c, `insert into answers(question_id,scholar_id,body) values($1,$2,'should not be possible')`, [q, ID.sch])), 'QUESTION_NOT_OPEN');
  await as('admin', c => sql(c, `select moderate_question($1,'open')`, [q]));
  await as('sch', c => sql(c, `insert into answers(question_id,scholar_id,body) values($1,$2,'valid answer for later hiding')`, [q, ID.sch]));
  await as('admin', c => sql(c, `select admin_hide_content('question',$1)`, [q]));
  const vis = await as('anon', c => sql(c, 'select id from answers where question_id=$1', [q]));
  assert.equal(vis.length, 0, 'answers of a rejected question must not stay public');
});

test('likes / helpful / saved / follow are per-user and counted', async () => {
  await as('b', c => sql(c, 'insert into question_likes(user_id,question_id) values($1,$2)', [ID.b, Q1.id]));
  assert.equal((await as('anon', c => sql(c, 'select likes_count from question_feed where id=$1', [Q1.id])))[0].likes_count, 1);
  await rejects(as('b', c => sql(c, 'insert into question_likes(user_id,question_id) values($1,$2)', [ID.b, Q1.id])), /duplicate key/);
  await rejects(as('a', c => sql(c, 'insert into question_likes(user_id,question_id) values($1,$2)', [ID.b, Q1.id])), /row-level security/);
  const pend = (await pool.query(`select id from questions where status='pending_review' limit 1`)).rows[0].id;
  await rejects(as('b', c => sql(c, 'insert into question_likes(user_id,question_id) values($1,$2)', [ID.b, pend])), /row-level security/);
  const aid = (await pool.query('select id from answers where question_id=$1', [Q1.id])).rows[0].id;
  await as('b', c => sql(c, 'insert into answer_helpful(user_id,answer_id) values($1,$2)', [ID.b, aid]));
  await as('b', c => sql(c, 'insert into saved_answers(user_id,answer_id) values($1,$2)', [ID.b, aid]));
  await as('b', c => sql(c, 'insert into scholar_followers(user_id,scholar_id) values($1,$2)', [ID.b, ID.sch]));
  assert.equal((await pool.query('select helpful_count from answers where id=$1', [aid])).rows[0].helpful_count, 1);
  assert.equal((await as('a', c => sql(c, 'select * from saved_answers'))).length, 0);
  assert.equal((await as('a', c => sql(c, 'select * from scholar_followers'))).length, 0);
  await as('b', c => sql(c, 'delete from question_likes where user_id=$1', [ID.b]));
  assert.equal((await as('anon', c => sql(c, 'select likes_count from question_feed where id=$1', [Q1.id])))[0].likes_count, 0);
});

test('scholar_queue: only verified scholars (open Qs) and admins (pending too)', async () => {
  assert.equal((await as('a', c => sql(c, 'select * from scholar_queue'))).length, 0);
  assert.equal((await as('sch2', c => sql(c, 'select * from scholar_queue'))).length, 0);
  await rejects(as('anon', c => sql(c, 'select * from scholar_queue')), /permission denied/);
  const rows = await as('sch', c => sql(c, 'select * from scholar_queue'));
  assert.ok(rows.every(r => r.status === 'open' || r.status === 'answered'));   // answered = ones this scholar answered (patch_003)
  assert.ok(rows.every(r => r.status !== 'pending_review'));
  assert.ok(rows.every(r => !('user_id' in r)), 'scholars must not see asker identity');
  assert.ok((await as('admin', c => sql(c, 'select * from scholar_queue'))).some(r => r.status === 'pending_review' || r.status === 'open'));
});

test('scholar_directory shows only verified scholars', async () => {
  const rows = await as('anon', c => sql(c, 'select id from scholar_directory'));
  const ids = rows.map(r => r.id);
  assert.ok(ids.includes(ID.sch)); assert.ok(!ids.includes(ID.sch2));
});

test('reports: any user can report once; only admin resolves', async () => {
  await as('b', c => sql(c, `insert into reports(reporter_id,target_type,target_id,reason) values($1,'question',$2,'misleading')`, [ID.b, Q1.id]));
  await rejects(as('b', c => sql(c, `insert into reports(reporter_id,target_type,target_id,reason) values($1,'question',$2,'again')`, [ID.b, Q1.id])), /duplicate key/);
  assert.equal((await as('a', c => sql(c, 'select * from reports'))).length, 0);
  const rid = (await pool.query('select id from reports limit 1')).rows[0].id;
  await rejects(as('b', c => sql(c, `select resolve_report($1,'resolved')`, [rid])), 'FORBIDDEN');
  await as('admin', c => sql(c, `select resolve_report($1,'resolved')`, [rid]));
  assert.equal((await pool.query('select status from reports where id=$1', [rid])).rows[0].status, 'resolved');
  assert.ok((await pool.query(`select 1 from audit_logs where action='resolve_report'`)).rowCount > 0);
});

test('notifications / subscriptions / payments / audit: no client writes', async () => {
  await rejects(as('a', c => sql(c, `insert into notifications(user_id,type) values($1,'system')`, [ID.a])), /permission denied/);
  await rejects(as('a', c => sql(c, `insert into subscriptions(user_id,status) values($1,'active')`, [ID.a])), /permission denied/);
  await rejects(as('a', c => sql(c, `insert into payments(user_id,amount_paise,provider,status) values($1,100,'x','paid')`, [ID.a])), /permission denied/);
  await rejects(as('a', c => sql(c, `select * from audit_logs`)).then(r => { if (!r.length) throw new Error('empty'); }), /empty|permission/);
  assert.equal((await as('a', c => sql(c, 'select * from audit_logs'))).length, 0);
  assert.ok((await as('admin', c => sql(c, 'select * from audit_logs'))).length > 0);
});

test('admin_stats / admin_list_users work for admin only', async () => {
  const s = JSON.parse((await as('admin', c => sql(c, 'select admin_stats() s')))[0].s);
  assert.ok(s.users >= 5 && s.questions >= 1);
  const u = await as('admin', c => sql(c, 'select * from admin_list_users()'));
  assert.ok(u.length >= 5);
  await rejects(as('b', c => sql(c, 'select * from admin_list_users()')), 'FORBIDDEN');
});

test('storage: users can only write to their own folder', async () => {
  await as('a', c => sql(c, `insert into storage.objects(bucket_id,name,owner) values('question-images',$1,$2)`, [`${ID.a}/x.png`, ID.a]));
  await rejects(as('a', c => sql(c, `insert into storage.objects(bucket_id,name,owner) values('question-images',$1,$2)`, [`${ID.b}/x.png`, ID.a])), /row-level security/);
  assert.equal((await as('b', c => sql(c, `select * from storage.objects`))).length, 0, 'other users cannot read my images');
  assert.equal((await as('sch', c => sql(c, `select * from storage.objects`))).length, 1, 'verified scholar can read');
});

test('account deletion removes personal data, even with payment records', async () => {
  await pool.query(`insert into payments(user_id,amount_paise,provider,provider_payment_id,status) values($1,9900,'razorpay','pay_test1','paid')`, [ID.b]);
  await as('b', c => sql(c, 'select delete_my_account()'));
  assert.equal((await pool.query('select 1 from profiles where id=$1', [ID.b])).rowCount, 0);
  assert.equal((await pool.query('select 1 from questions where user_id=$1', [ID.b])).rowCount, 0);
  await rejects(as('anon', c => sql(c, 'select delete_my_account()')), /permission denied/);
});
