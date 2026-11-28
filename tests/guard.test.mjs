// Tests of the mandatory database guard (tests/lib/db-guard.sh): G-1 ... G-21.
// Refused configurations are run against a LOGGING FAKE psql / pg_dump, so the test can count exactly how many
// database commands were attempted (0 before a connection is allowed; exactly 1 read-only verification query when
// the database itself does not verify). G-14, G-16, G-17 and G-21 use the real local disposable test server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'tests/lib/db-guard.sh');
const SHIMS = path.join(ROOT, 'tests/lib/shims');
const SEP = '\x1f';
let FAKE, LOG, PGRST_LOG;

before(() => {
  FAKE = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-fake-'));
  LOG = path.join(FAKE, 'calls.log');
  // logging fake: records the tool, its arguments and its stdin; prints FAKE_PSQL_OUT (the "verification row")
  const fake = `#!/usr/bin/env bash\n{ echo "CALL $(basename "$0") $*"; cat; echo; echo "END"; } >> "$FAKE_PSQL_LOG"\nprintf '%s\\n' "\${FAKE_PSQL_OUT:-}"\n`;
  for (const t of ['psql', 'pg_dump']) { fs.writeFileSync(path.join(FAKE, t), fake); fs.chmodSync(path.join(FAKE, t), 0o755); }
  // fake PostgREST: records its arguments, its whole environment and the configuration it was given, then exits.
  // (its log path is written into the script, because the guard gives PostgREST an empty environment)
  PGRST_LOG = path.join(FAKE, 'pgrst.log');
  fs.writeFileSync(path.join(FAKE, 'postgrest'), `#!/usr/bin/env bash\n{ echo "START $*"; echo "--- ENV"; env -0 | tr '\\0' '\\n' | cut -d= -f1; echo "--- CONF"; cat "$1"; echo "--- END"; } >> '${PGRST_LOG}'\n`);
  fs.chmodSync(path.join(FAKE, 'postgrest'), 0o755);
});
after(() => fs.rmSync(FAKE, { recursive: true, force: true }));

// a clean environment built from scratch (never the real CI environment), in local or CI mode
const SYS_PATH = `${SHIMS}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const SOCK = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-sock-'));
const baseLocal = () => ({ PATH: SYS_PATH, HOME: os.tmpdir(), ALFRZO_TEST_DB: '1', PGHOST: SOCK, PGPORT: '54329', PGUSER: 'postgres' });
const baseCI = () => ({ PATH: SYS_PATH, HOME: os.tmpdir(), ALFRZO_CI_TEST_DB: '1', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'Tests',
  RUNNER_TEMP: os.tmpdir(), GITHUB_REPOSITORY: 'faiz952002/Alfrzo-ilm', PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGPASSWORD: 'postgres' });
const fakeEnv = (env, out = '') => ({ ...env, ALFRZO_PG_BIN_DIR: FAKE, FAKE_PSQL_LOG: LOG, FAKE_PSQL_OUT: out });
const g = (env, args, input = '') => { fs.rmSync(LOG, { force: true }); return spawnSync('bash', [GUARD, ...args], { env, input, encoding: 'utf8' }); };
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.startsWith('CALL ')) : []);
const refused = (r, code, what) => {
  assert.equal(r.status, code, `${what}: exit ${r.status}, stderr: ${r.stderr}`);
  assert.match(r.stderr, /GUARD REFUSED/, what);
};
const zeroCalls = (env, args, code, what, input = 'select 1;') => { const r = g(fakeEnv(env), args, input); refused(r, code, what); assert.deepEqual(calls(), [], `${what}: no database command may run`); };

// ---------------------------------------------------------------- G-1 ... G-10: refused before any connection
test('G-1: mode flags: none, both, local with CI variables, CI outside the project\'s GitHub Actions -> 70, 0 calls', () => {
  const { ALFRZO_TEST_DB, ...none } = baseLocal();
  zeroCalls(none, ['verify', 'main'], 70, 'no flag');
  zeroCalls({ ...baseLocal(), ALFRZO_CI_TEST_DB: '1' }, ['verify', 'main'], 70, 'both flags');
  zeroCalls({ ...baseLocal(), CI: 'true' }, ['verify', 'main'], 70, 'local flag + CI');
  zeroCalls({ ...baseLocal(), GITHUB_ACTIONS: 'true' }, ['verify', 'main'], 70, 'local flag + GITHUB_ACTIONS');
  for (const k of ['GITHUB_ACTIONS', 'CI', 'GITHUB_WORKFLOW', 'RUNNER_TEMP']) { const e = baseCI(); delete e[k]; zeroCalls(e, ['verify', 'main'], 70, `CI without ${k}`); }
  zeroCalls({ ...baseCI(), GITHUB_REPOSITORY: 'someone/fork' }, ['verify', 'main'], 70, 'CI of another repository');
});

test('G-2: Render / production signs stop both modes -> 71, 0 calls', () => {
  for (const base of [baseLocal, baseCI]) {
    zeroCalls({ ...base(), RENDER: 'true' }, ['verify', 'main'], 71, 'RENDER');
    zeroCalls({ ...base(), RENDER_SERVICE_ID: 'srv-x' }, ['verify', 'main'], 71, 'RENDER_SERVICE_ID');
    zeroCalls({ ...base(), RENDER_EXTERNAL_URL: 'https://x.onrender.com' }, ['verify', 'main'], 71, 'RENDER_EXTERNAL_URL');
    zeroCalls({ ...base(), NODE_ENV: 'production' }, ['verify', 'main'], 71, 'NODE_ENV=production');
  }
});

test('G-3 / G-4: PGSERVICE, PGSERVICEFILE, non-loopback PGHOSTADDR -> 75, 0 calls', () => {
  zeroCalls({ ...baseLocal(), PGSERVICE: 'prod' }, ['run', 'main'], 75, 'PGSERVICE');
  zeroCalls({ ...baseLocal(), PGSERVICEFILE: '/tmp/x.conf' }, ['run', 'main'], 75, 'PGSERVICEFILE');
  zeroCalls({ ...baseLocal(), PGHOSTADDR: '10.0.0.5' }, ['run', 'main'], 75, 'PGHOSTADDR remote');
  zeroCalls({ ...baseCI(), PGHOSTADDR: '52.1.2.3' }, ['run', 'main'], 75, 'PGHOSTADDR remote (CI)');
});

test('G-5: remote or Supabase hosts -> 72, 0 calls', () => {
  // a Supabase host is already caught by the production-host scan (76); any other remote host by the host check (72)
  for (const h of ['db.abcdefgh.supabase.co', 'aws-0-ap-south-1.pooler.supabase.com'])
    zeroCalls({ ...baseLocal(), PGHOST: h }, ['run', 'main'], 76, `PGHOST=${h}`);
  for (const h of ['10.1.2.3', 'example.com', 'my-supabase-mirror.internal', '/does/not/exist'])
    zeroCalls({ ...baseLocal(), PGHOST: h }, ['run', 'main'], 72, `PGHOST=${h}`);
  zeroCalls({ ...baseCI(), PGHOST: SOCK }, ['run', 'main'], 72, 'CI with a socket directory');
  const { PGHOST, ...noHost } = baseLocal(); zeroCalls(noHost, ['run', 'main'], 72, 'PGHOST unset');
});

test('G-6: wrong / wildcard database names and keys -> 73, 0 calls', () => {
  for (const d of ['askdeen', 'postgres', '%', '*', 'alfrzo_disposable_%', 'alfrzo_ci_disposable_test'])
    zeroCalls({ ...baseLocal(), PGDATABASE: d }, ['run', 'main'], 73, `PGDATABASE=${d}`);
  for (const k of ['askdeen', 'alfrzo_disposable_test', '%', '*', 'm_%', 'main;drop', ''])
    zeroCalls(baseLocal(), ['run', k], 73, `key ${JSON.stringify(k)}`);
});

test('G-7: bad PGPORT -> 74, 0 calls', () => {
  for (const p of ['abc', '80', '70000', '', '5432;x']) zeroCalls({ ...baseLocal(), PGPORT: p }, ['run', 'main'], 74, `PGPORT=${JSON.stringify(p)}`);
});

test('G-8: remote DATABASE_URL / DIRECT_URL / SUPABASE_URL -> 72 or 76, 0 calls', () => {
  zeroCalls({ ...baseLocal(), DATABASE_URL: 'postgres://u@db.example.org:5432/postgres' }, ['run', 'main'], 72, 'DATABASE_URL');
  zeroCalls({ ...baseLocal(), DIRECT_URL: 'postgresql://u@10.0.0.1/db' }, ['run', 'main'], 72, 'DIRECT_URL');
  zeroCalls({ ...baseLocal(), SUPABASE_URL: 'https://abcdefgh.supabase.co' }, ['run', 'main'], 76, 'SUPABASE_URL (Supabase host)');
  zeroCalls({ ...baseCI(), SUPABASE_URL: 'https://api.example.org' }, ['run', 'main'], 72, 'SUPABASE_URL remote (CI)');
});

test('G-9: secret-like variables -> 76, 0 calls', () => {
  zeroCalls({ ...baseLocal(), SUPABASE_SERVICE_ROLE_KEY: 'x' }, ['run', 'main'], 76, 'service role key');
  zeroCalls({ ...baseLocal(), RAZORPAY_KEY_SECRET: 'x' }, ['run', 'main'], 76, 'razorpay secret');
  zeroCalls({ ...baseLocal(), LIVEKIT_API_SECRET: 'x' }, ['run', 'main'], 76, 'livekit secret');
  zeroCalls({ ...baseCI(), SOMETHING: 'sb_secret_abc123' }, ['run', 'main'], 76, 'sb_secret_ value');
  zeroCalls({ ...baseLocal(), OTHER: 'rzp_live_abc' }, ['run', 'main'], 76, 'rzp_live_ value');
  zeroCalls({ ...baseLocal(), JWT: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x' }, ['run', 'main'], 76, 'service_role JWT');
});

test('G-10: connection settings or connection-switching meta-commands from the caller -> 77, 0 calls', () => {
  for (const a of [['-d', 'postgres://u@db.x.supabase.co/postgres'], ['-h', '10.0.0.1'], ['-p', '5432'], ['-U', 'admin'], ['service=prod'], ['host=db.example.org'], ['-c', 'select 1'], ['-f', '/etc/passwd']])
    zeroCalls(baseLocal(), ['run', 'main', ...a], 77, `argument ${a.join(' ')}`);
  for (const s of ['\\c postgres', 'select 1;\n\\connect other', '\\! rm -rf /tmp/x', '\\setenv PGHOST x', '\\i other.sql', '\\o /tmp/out', '\\copy t to /tmp/x'])
    zeroCalls(baseLocal(), ['run', 'main'], 77, `meta-command ${JSON.stringify(s)}`, s);
  zeroCalls(baseLocal(), ['dump', 'main', '--host=x'], 77, 'dump with extra args');
  zeroCalls(baseLocal(), ['drop', 'main', 'other'], 77, 'drop with extra args');
});

// ---------------------------------------------------------------- G-11 ... G-13: exactly one read-only query
const verifyRefused = (env, out, what) => {
  const r = g(fakeEnv(env, out), ['run', 'main'], 'create table should_never_run(i int);');
  refused(r, 78, what);
  const c = calls();
  assert.equal(c.length, 1, `${what}: exactly one database command`);
  const log = fs.readFileSync(LOG, 'utf8');
  assert.match(log, /begin transaction read only;/, `${what}: the one query is read-only`);
  assert.doesNotMatch(log, /should_never_run/, `${what}: the caller's SQL was never sent`);
};
test('G-11 / G-12 / G-13: missing or wrong marker, wrong database name, non-local server address -> 78, one read-only query', () => {
  const L = 'ALFRZO_DISPOSABLE_TEST v1 (local)', C = 'ALFRZO_DISPOSABLE_TEST v1 (ci)';
  verifyRefused(baseLocal(), ['alfrzo_disposable_test', '', '', 'UTF8'].join(SEP), 'no marker');
  verifyRefused(baseLocal(), ['alfrzo_disposable_test', C, '', 'UTF8'].join(SEP), 'CI marker in local mode');
  verifyRefused(baseCI(), ['alfrzo_ci_disposable_test', L, '127.0.0.1', 'UTF8'].join(SEP), 'local marker in CI mode');
  verifyRefused(baseLocal(), ['production', L, '', 'UTF8'].join(SEP), 'different database name');
  verifyRefused(baseLocal(), ['alfrzo_disposable_test', L, '10.0.0.9', 'UTF8'].join(SEP), 'remote server address');
  verifyRefused(baseCI(), ['alfrzo_ci_disposable_test', C, '', 'UTF8'].join(SEP), 'socket address in CI mode');
  verifyRefused(baseLocal(), '', 'empty answer');
  verifyRefused(baseLocal(), ['alfrzo_disposable_test', L, '', 'SQL_ASCII'].join(SEP), 'database not UTF8');
  // and the accepted case with the fake: verification + the caller's SQL = 2 commands
  const ok = g(fakeEnv(baseLocal(), ['alfrzo_disposable_test', L, '', 'UTF8'].join(SEP)), ['run', 'main'], 'select 42;');
  assert.equal(ok.status, 0, ok.stderr); assert.equal(calls().length, 2);
  const okCI = g(fakeEnv(baseCI(), ['alfrzo_ci_disposable_test', C, '127.0.0.1', 'UTF8'].join(SEP)), ['run', 'main'], 'select 42;');
  assert.equal(okCI.status, 0, okCI.stderr);
});

// ---------------------------------------------------------------- real local server: G-14, G-16, G-17, G-21
const REAL = process.env.ALFRZO_TEST_DB === '1' || process.env.ALFRZO_CI_TEST_DB === '1';
const realEnv = () => ({ ...process.env, PATH: `${SHIMS}:${process.env.PATH}` });
const real = (args, input = '') => spawnSync('bash', [GUARD, ...args], { env: realEnv(), input, encoding: 'utf8' });
const MARKER = process.env.ALFRZO_CI_TEST_DB === '1' ? 'ALFRZO_DISPOSABLE_TEST v1 (ci)' : 'ALFRZO_DISPOSABLE_TEST v1 (local)';

test('G-21 / G-17: the approved configuration works; create sets the marker; drop removes exactly that database', () => {
  assert.ok(REAL, 'run through tests/run-db-tests.sh with the approved configuration');
  let r = real(['reset', 'probe']); assert.equal(r.status, 0, r.stderr);
  r = real(['verify', 'probe']); assert.equal(r.status, 0, r.stderr);
  r = real(['run', 'probe', '-q', '-t', '-A'], "select shobj_description(oid, 'pg_database') from pg_database where datname = current_database();");
  assert.equal(r.stdout.trim(), MARKER);
  r = real(['drop', 'probe']); assert.equal(r.status, 0, r.stderr);
  r = real(['verify', 'probe']); assert.equal(r.status, 78, 'probe is gone');
});

test('G-14 / G-16: a real database without the marker: the caller\'s SQL never runs and it cannot be dropped', () => {
  assert.equal(real(['reset', 'main']).status, 0, 'the verified main test database is needed to change the probe\'s marker');   // CI runs this first, before any other test created main
  assert.equal(real(['reset', 'probe']).status, 0);
  const name = real(['name', 'probe']).stdout.trim();
  assert.equal(real(['run', 'main', '-q'], `comment on database ${name} is null;`).status, 0);   // remove the marker (from the verified main database)
  let r = real(['run', 'probe', '-q'], 'create table guard_should_not_exist(i int);');
  assert.equal(r.status, 78, r.stderr);
  r = real(['drop', 'probe']); assert.equal(r.status, 79, `drop must be refused: ${r.stderr}`);
  assert.equal(real(['run', 'main', '-q', '-t', '-A'], `select count(*) from pg_database where datname = '${name}';`).stdout.trim(), '1', 'still exists');
  // put the marker back, then prove the table was never created
  assert.equal(real(['run', 'main', '-q'], `comment on database ${name} is '${MARKER}';`).status, 0);
  assert.equal(real(['run', 'probe', '-q', '-t', '-A'], "select coalesce(to_regclass('public.guard_should_not_exist')::text, 'absent');").stdout.trim(), 'absent');
  assert.equal(real(['drop', 'probe']).status, 0);
});

test('G-15: drop / create / reset only for allowlisted keys -> 73, 0 calls', () => {
  for (const cmd of ['drop', 'create', 'reset'])
    for (const k of ['askdeen', 'postgres', 'alfrzo_disposable_test', '%', '*', 'm_*', 'template1'])
      zeroCalls(baseLocal(), [cmd, k], 73, `${cmd} ${k}`);
});

// ---------------------------------------------------------------- G-18 / G-19: no way around the guard
test('G-18: during test runs psql / createdb / dropdb / pg_dump cannot be called directly', () => {
  for (const t of ['psql', 'createdb', 'dropdb', 'pg_dump', 'pg_restore', 'pg_dumpall']) {
    const r = spawnSync(t, ['-c', 'select 1'], { env: { ...process.env, PATH: `${SHIMS}:${process.env.PATH}` }, encoding: 'utf8' });
    assert.equal(r.status, 97, `${t} must be blocked`); assert.match(r.stderr, /BLOCKED/);
  }
});

test('G-19: no test, tool, server or workflow file runs a database tool or PostgREST except through the guard', () => {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(p); } else files.push(p); } };
  for (const d of ['tests', 'tools', 'server', '.github']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  files.push(path.join(ROOT, 'package.json'));
  const allowed = new Set([GUARD, path.join(ROOT, 'tests/guard.test.mjs')].map(p => path.resolve(p)));
  const TOOL = '(psql|createdb|dropdb|pg_dump|pg_restore|pg_dumpall)';
  const jsRe = new RegExp(`(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\\s*\\(\\s*['"\`][^'"\`]*\\b${TOOL}\\b`);
  const shRe = new RegExp(`(^|[\\s;|&(\`$])(\\/[\\w./-]*\\/)?${TOOL}(\\s|$)`);
  const pgrstRe = /((spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*['"`][^'"`]*postgrest)|(['"`][^'"`\s]*\/postgrest['"`])|(runuser[^\n]*postgrest)/;
  const hits = [];
  for (const f of files) {
    if (allowed.has(path.resolve(f)) || f.startsWith(SHIMS) || /\.(md|sql|png|jpg|webp|json)$/.test(f) && !f.endsWith('package.json')) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      const code = l.replace(/^\s*(#|\/\/).*$/, '');
      if (jsRe.test(code) || pgrstRe.test(code) || (/\.(sh|ya?ml|json)$/.test(f) && shRe.test(code))) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'direct database tool calls found');
});

test('G-20: every refusal is a non-zero exit (what CI relies on)', () => {
  const r = g(fakeEnv({ ...baseLocal(), RENDER: 'true' }), ['check']);
  assert.notEqual(r.status, 0);
  const runner = spawnSync('bash', [path.join(ROOT, 'tests/run-db-tests.sh'), 'db'], { env: { ...baseLocal(), PGHOST: 'db.x.supabase.co' }, encoding: 'utf8' });
  assert.notEqual(runner.status, 0, 'the whole runner stops with a non-zero exit');
  assert.match(runner.stderr, /GUARD REFUSED/);
});

// ---------------------------------------------------------------- G-22 ... G-24: PostgREST only through the guard
const SECRET = 'test-secret-test-secret-test-secret-123456';
const VERIFIED = ['alfrzo_disposable_test', 'ALFRZO_DISPOSABLE_TEST v1 (local)', '', 'UTF8'].join(SEP);
const pgrstEnv = (env, out = VERIFIED) => ({ ...fakeEnv(env, out), ALFRZO_POSTGREST_BIN: path.join(FAKE, 'postgrest') });
const startPgrst = (env, args = ['postgrest', 'main', '3456'], secret = SECRET) => { fs.rmSync(PGRST_LOG, { force: true }); return g(env, args, secret + '\n'); };
const starts = () => (fs.existsSync(PGRST_LOG) ? fs.readFileSync(PGRST_LOG, 'utf8').split('\n').filter(l => l.startsWith('START ')).length : 0);
const noStart = (env, code, what, args, secret) => { const r = startPgrst(env, args, secret); refused(r, code, what); assert.equal(starts(), 0, `${what}: PostgREST must not start`); };

test('G-22: PostgREST gets exactly the verified database URI, a clean environment, and its config is removed afterwards', () => {
  const r = startPgrst(pgrstEnv({ ...baseLocal(), PGOPTIONS: '-c search_path=evil', PGDATABASE: 'alfrzo_disposable_test', EXTRA_TOKEN: 'x' }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(starts(), 1);
  const log = fs.readFileSync(PGRST_LOG, 'utf8');
  const confPath = log.match(/^START (\S+)/m)[1];
  const env = log.split('--- ENV\n')[1].split('--- CONF')[0].trim().split('\n');
  const conf = log.split('--- CONF\n')[1].split('--- END')[0];
  assert.match(conf, new RegExp(`^db-uri = "postgres://authenticator@/alfrzo_disposable_test\\?host=${SOCK.replace(/[/.]/g, '\\$&')}&port=54329"$`, 'm'));
  assert.match(conf, /^server-host = "127\.0\.0\.1"$/m); assert.match(conf, /^server-port = 3456$/m); assert.match(conf, /^db-anon-role = "anon"$/m);
  assert.equal((conf.match(/db-uri/g) || []).length, 1);
  const leaked = env.filter(k => /^(PG(?!SYSCONFDIR$)|PGRST_|DATABASE_URL|DIRECT_URL|SUPABASE|EXTRA_TOKEN|ALFRZO_|FAKE_|GITHUB|RENDER)/.test(k));
  assert.deepEqual(leaked, [], 'nothing from the caller\'s environment reaches PostgREST');
  assert.ok(!fs.existsSync(confPath), 'config file removed after PostgREST stopped');
});

test('G-23: PostgREST does not start on any unsafe configuration', () => {
  noStart(pgrstEnv({ ...baseLocal(), PGRST_DB_URI: 'postgres://u@db.abcdefgh.supabase.co:5432/postgres' }), 76, 'inherited production PGRST_DB_URI');
  noStart(pgrstEnv({ ...baseLocal(), PGRST_DB_URI: 'postgres://authenticator@/alfrzo_disposable_test' }), 72, 'any inherited PGRST_DB_URI');
  noStart(pgrstEnv({ ...baseLocal(), PGRST_JWT_SECRET: 'x'.repeat(40) }), 72, 'inherited PGRST_JWT_SECRET');
  noStart(pgrstEnv({ ...baseLocal(), DATABASE_URL: 'postgres://u@prod.example.org/db' }), 72, 'production DATABASE_URL');
  noStart(pgrstEnv({ ...baseLocal(), SUPABASE_URL: 'https://abcdefgh.supabase.co' }), 76, 'production SUPABASE_URL');
  noStart(pgrstEnv({ ...baseLocal(), PGHOST: '10.0.0.7' }), 72, 'remote PGHOST');
  noStart(pgrstEnv({ ...baseLocal(), RENDER: 'true' }), 71, 'Render');
  noStart(pgrstEnv(baseCI(), ['alfrzo_ci_disposable_test', 'ALFRZO_DISPOSABLE_TEST v1 (ci)', '127.0.0.1', 'UTF8'].join(SEP)), 70, 'CI mode');
  noStart(pgrstEnv(baseLocal()), 73, 'key not on the allowlist', ['postgrest', 'askdeen', '3456']);
  for (const p of ['80', 'abc', '70000']) noStart(pgrstEnv(baseLocal()), 77, `port ${p}`, ['postgrest', 'main', p]);
  noStart(pgrstEnv(baseLocal()), 77, 'no port', ['postgrest', 'main']);
  noStart(pgrstEnv(baseLocal()), 77, 'extra argument', ['postgrest', 'main', '3456', '--db-uri=x']);
  noStart(pgrstEnv(baseLocal()), 77, 'short secret', undefined, 'short');
  noStart(pgrstEnv(baseLocal()), 77, 'secret with quotes', undefined, 'a"b'.padEnd(40, 'x'));
  noStart(pgrstEnv({ ...baseLocal(), ALFRZO_PGRST_RUNAS: 'root' }), 77, 'run as root');
  noStart(pgrstEnv(baseLocal(), ['alfrzo_disposable_test', '', '', 'UTF8'].join(SEP)), 78, 'database without marker');
  noStart(pgrstEnv(baseLocal(), ['production', 'ALFRZO_DISPOSABLE_TEST v1 (local)', '', 'UTF8'].join(SEP)), 78, 'wrong database');
});

test('G-24: real PostgREST started through the guard serves the disposable database (local) / is refused in CI mode', async () => {
  if (process.env.ALFRZO_CI_TEST_DB === '1') {   // browser tests (and PostgREST) are not part of CI: the guard refuses there
    const r = spawnSync('bash', [GUARD, 'postgrest', 'main', '3456'], { env: realEnv(), input: SECRET + '\n', encoding: 'utf8' });
    assert.equal(r.status, 70); return;
  }
  // a full test schema on the main disposable database (an earlier test may have left it empty) - through the guard
  const rebuilt = spawnSync('bash', [path.join(ROOT, 'tests/reset-db.sh'), 'main'], { env: realEnv(), encoding: 'utf8' });
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(real(['run', 'main', '-q'], "do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if; end $$; grant anon, authenticated, service_role to authenticator;").status, 0);
  const port = 4100 + Math.floor(Math.random() * 400);
  const p = (await import('node:child_process')).spawn('bash', [GUARD, 'postgrest', 'main', String(port)], { detached: true, stdio: ['pipe', 'ignore', 'pipe'], env: { ...realEnv(), ALFRZO_PGRST_RUNAS: 'claude' } });
  p.stdin.end(SECRET + '\n');
  let status = 0;
  for (let i = 0; i < 50 && status !== 200; i++) { try { status = (await fetch(`http://127.0.0.1:${port}/categories?select=id&limit=1`)).status; } catch {} if (status !== 200) await new Promise(r => setTimeout(r, 200)); }
  process.kill(-p.pid, 'SIGTERM');
  assert.equal(status, 200, 'PostgREST answered from the verified disposable database');
});
