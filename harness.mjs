// TEST-ONLY harness: real PostgreSQL (schema.sql + patches) + real PostgREST + tiny Supabase Auth and Storage look-alikes.
// It exists so the browser flows can run against real RLS. It is never used in production.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export const PG = { host: process.env.PGHOST || '/tmp/pgsock', port: process.env.PGPORT || '54329', db: process.env.PGDATABASE || 'askdeen' };
const JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export const sign = claims => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims); return `${h}.${p}.${crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url')}`; };
export const ANON = sign({ role: 'anon' }), SERVICE = sign({ role: 'service_role' });
const lit = s => `'${String(s).replace(/'/g, "''")}'`;

export function sql(q) {
  const r = spawnSync('psql', ['-X', '-At', '-h', PG.host, '-p', PG.port, '-U', 'postgres', '-d', PG.db, '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}

// Runs SQL as a logged-in user so Row Level Security applies exactly as it does for the browser.
function asUser(uid, q) {
  const full = `begin; set local role authenticated; select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true); ${q}; commit;`;
  const r = spawnSync('psql', ['-X', '-q', '-At', '-h', PG.host, '-p', PG.port, '-U', 'postgres', '-d', PG.db, '-v', 'ON_ERROR_STOP=1', '-c', full], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim().split('\n').pop();
}
const files = new Map();   // "bucket/path" -> { type, buf }
const fileToken = key => crypto.createHmac('sha256', JWT_SECRET).update('file:' + key).digest('hex');
export const storedFiles = files;

function authShim(pgrstPort) {
  const pw = new Map(), refresh = new Map();   // email -> scrypt hash, refresh token -> user id
  const hash = p => crypto.scryptSync(p, 'salt', 32).toString('hex');
  const session = (id, email) => { const rt = crypto.randomUUID(); refresh.set(rt, id); return { access_token: sign({ sub: id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }), refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: { id, email } }; };
  const bearerUser = req => { try { const t = (req.headers.authorization || '').replace('Bearer ', '').split('.'); const [h, p, s] = t; if (crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url') !== s) return null; const c = JSON.parse(Buffer.from(p, 'base64url')); return c.sub && c.exp > Date.now() / 1000 ? c.sub : null; } catch { return null; } };
  return http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x'); const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
    const body = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
    const p = url.pathname;
    if (p === '/auth/v1/signup') {
      const { email, password, data } = body();
      if (!email || !password || password.length < 8) return send(422, { code: 422, msg: 'Password should be at least 8 characters.' });
      if (sql(`select 1 from auth.users where lower(email)=lower(${lit(email)})`)) return send(422, { code: 422, msg: 'User already registered' });
      const id = sql(`insert into auth.users (email, raw_user_meta_data) values (${lit(email)}, ${lit(JSON.stringify(data || {}))}::jsonb) returning id`).split('\n')[0];
      pw.set(email.toLowerCase(), hash(password)); return send(200, session(id, email));
    }
    if (p === '/auth/v1/token') {
      const g = url.searchParams.get('grant_type');
      if (g === 'password') { const { email, password } = body(); const id = sql(`select id from auth.users where lower(email)=lower(${lit(email || '')})`); if (!id || pw.get(email.toLowerCase()) !== hash(password || '')) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); return send(200, session(id, email)); }
      if (g === 'refresh_token') { const id = refresh.get(body().refresh_token); if (!id) return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }); return send(200, session(id, sql(`select email from auth.users where id=${lit(id)}`))); }
    }
    if (p === '/auth/v1/user') {
      const id = bearerUser(req); if (!id) return send(401, { msg: 'invalid JWT' });
      const email = sql(`select email from auth.users where id=${lit(id)}`); if (!email) return send(401, { msg: 'user not found' });
      if (req.method === 'PUT') { const { password } = body(); if (password) { if (password.length < 8) return send(422, { msg: 'Password should be at least 8 characters.' }); pw.set(email.toLowerCase(), hash(password)); } }
      return send(200, { id, email });
    }
    if (p === '/auth/v1/logout') return send(204);
    if (p.startsWith('/rest/v1/')) {   // proxy to the real PostgREST
      const headers = { ...req.headers, host: `127.0.0.1:${pgrstPort}` }; delete headers.apikey; delete headers.origin; delete headers.referer;
      const up = http.request({ host: '127.0.0.1', port: pgrstPort, path: p.replace('/rest/v1', '') + url.search, method: req.method, headers }, r => { res.writeHead(r.statusCode, { ...r.headers, 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': '*' }); r.pipe(res); });
      up.on('error', () => send(502, { message: 'postgrest down' })); return up.end(raw);
    }
    // ---- Supabase Storage look-alike: bytes kept in memory, access decided by the REAL storage.objects RLS policies ----
    if (p.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(p.slice('/storage/v1/object/'.length));
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (req.method === 'GET' && /^(public|signed)\//.test(rest)) {
        const key = rest.replace(/^(public|signed)\//, ''), bucket = key.split('/')[0];
        if (rest.startsWith('public/') && sql(`select public from storage.buckets where id=${lit(bucket)}`) !== 't') return send(400, { message: 'Bucket is not public' });
        if (rest.startsWith('signed/') && url.searchParams.get('token') !== fileToken(key)) return send(400, { message: 'Invalid signature' });
        const f = files.get(key); if (!f) return send(404, { message: 'Object not found' });
        res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.buf.length, ...cors }); return res.end(f.buf);
      }
      const me = bearerUser(req); if (!me) return send(401, { message: 'Unauthorized' });
      if (req.method === 'POST' && rest.startsWith('sign/')) {
        const key = rest.slice(5), [bucket, ...pp] = key.split('/');
        if (asUser(me, `select count(*) from storage.objects where bucket_id=${lit(bucket)} and name=${lit(pp.join('/'))}`) !== '1') return send(400, { message: 'Object not found' });
        return send(200, { signedURL: `/object/signed/${key}?token=${fileToken(key)}` });
      }
      if (req.method === 'POST') {
        const [bucket, ...pp] = rest.split('/'), name = pp.join('/'), type = String(req.headers['content-type'] || '').split(';')[0];
        const b = sql(`select coalesce(file_size_limit,0) || '|' || coalesce(array_to_string(allowed_mime_types, ','), '') from storage.buckets where id=${lit(bucket)}`);
        if (!b) return send(400, { message: 'Bucket not found' });
        const [lim, mimes] = b.split('|');
        if (Number(lim) && raw.length > Number(lim)) return send(413, { message: 'The object exceeded the maximum allowed size' });
        if (mimes && !mimes.split(',').includes(type)) return send(415, { message: 'mime type ' + type + ' is not supported' });
        try { asUser(me, `insert into storage.objects(bucket_id,name,owner) values (${lit(bucket)},${lit(name)},${lit(me)})`); } catch { return send(403, { message: 'new row violates row-level security policy' }); }
        files.set(rest, { type, buf: raw }); return send(200, { Key: rest });
      }
      if (req.method === 'DELETE') {
        const out = [];
        for (const name of body().prefixes || []) {
          const n = asUser(me, `with d as (delete from storage.objects where bucket_id=${lit(rest)} and name=${lit(name)} returning 1) select count(*) from d`);
          if (n === '1') { files.delete(`${rest}/${name}`); out.push({ name }); }
        }
        return send(200, out);
      }
    }
    send(404, { message: 'not found: ' + p });
  });
}

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
export async function startStack({ appCfg = {} } = {}) {
  const pgrstPort = 3010 + Math.floor(Math.random() * 500);
  sql(`do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if; end $$; grant anon, authenticated, service_role to authenticator;`);
  const conf = `/tmp/pgrst-${pgrstPort}.conf`;
  (await import('node:fs')).writeFileSync(conf, `db-uri = "postgres://authenticator@/${PG.db}?host=${PG.host}&port=${PG.port}"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${JWT_SECRET}"\nserver-port = ${pgrstPort}\nserver-host = "127.0.0.1"\nlog-level = "error"\n`);
  const pgrst = spawn('runuser', ['-u', 'claude', '--', '/tmp/pgrst/postgrest', conf], { stdio: 'ignore' });
  const shim = authShim(pgrstPort); const shimPort = await listen(shim);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${pgrstPort}/categories?select=id&limit=1`, { headers: { Authorization: 'Bearer ' + ANON } })).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  const { loadConfig } = await import('../../server/config.js'); const { createServer } = await import('../../server/server.js');
  const cfg = loadConfig({ SUPABASE_URL: `http://127.0.0.1:${shimPort}`, SUPABASE_ANON_KEY: ANON, CONTACT_EMAIL: 'help@example.org', ...appCfg });
  const app = createServer(cfg, { error() {}, warn() {}, log() {} }); const appPort = await listen(app);
  return { url: `http://127.0.0.1:${appPort}`, async stop() { app.close(); app.closeAllConnections?.(); shim.close(); pgrst.kill(); } };
}
