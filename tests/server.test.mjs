// Integration tests for server/ (config exposure, security, payments, SEO).
// The two outside services are replaced by small local fakes. The fake "database" only emulates the SQL in
// supabase/patch_002.sql so the SERVER's behaviour can be checked; the real SQL is tested against PostgreSQL in db.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { createServer } from '../server/server.js';
import { clientIp } from '../server/security.js';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = role => `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`;
const ANON = jwt('anon'), SERVICE = jwt('service_role');
const KEY_ID = 'rzp_test_KEYID', KEY_SECRET = 'rzp_secret_SECRETVALUE', WH_SECRET = 'whsec_WEBHOOKSECRET';
const ALICE = '11111111-1111-4111-8111-111111111111', BOB = '22222222-2222-4222-8222-222222222222', CAROL = '55555555-5555-4555-8555-555555555555';
const TOK = { alice: 'tok.alice.sig', bob: 'tok.bob.sig', carol: 'tok.carol.sig' }, WHO = { 'tok.alice.sig': ALICE, 'tok.bob.sig': BOB, 'tok.carol.sig': CAROL };
const QID = '33333333-3333-4333-8333-333333333333';
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

// ---------------- fake Supabase ----------------
const db = { payments: new Map(), subs: new Map(), consults: new Map(), rpcCalls: [], failRpc: false };
function fakeSupabase() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); let body = '';
    for await (const c of req) body += c;
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/auth/v1/user') {
      const id = WHO[(req.headers.authorization || '').replace('Bearer ', '')];
      return id ? send(200, { id, email: id.slice(0, 4) + '@example.com' }) : send(401, { msg: 'bad token' });
    }
    const svc = req.headers.authorization === `Bearer ${SERVICE}` && req.headers.apikey === SERVICE;
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (!svc) return send(401, { message: 'service role required' });
      const fn = url.pathname.split('/').pop(), a = JSON.parse(body || '{}'); db.rpcCalls.push([fn, a]);
      if (db.failRpc) return send(503, { message: 'down' });
      if (fn === 'record_payment_order') { db.payments.set(a.p_order, { user_id: a.p_user, amount: a.p_amount, currency: a.p_currency, status: 'created', purpose: 'premium' }); return send(200, null); }
      if (fn === 'record_consultation_order') {
        const k = db.consults.get(a.p_consultation);
        if (!k || k.user_id !== a.p_user) return send(400, { message: 'CONSULTATION_NOT_FOUND' });
        if (k.status !== 'pending_payment') return send(400, { message: 'NOT_PAYABLE' });
        if (k.price_paise !== a.p_amount) return send(400, { message: 'AMOUNT_MISMATCH' });
        db.payments.set(a.p_order, { user_id: a.p_user, amount: a.p_amount, currency: a.p_currency, status: 'created', purpose: 'consultation', ref_id: a.p_consultation }); return send(200, null);
      }
      if (fn === 'confirm_consultation_payment') {
        const p = db.payments.get(a.p_order);
        if (!p || p.purpose !== 'consultation') return send(400, { message: 'ORDER_NOT_FOUND' });
        if (p.user_id !== a.p_user) return send(400, { message: 'USER_MISMATCH' });
        if (p.amount !== a.p_amount || p.currency !== a.p_currency) return send(400, { message: 'AMOUNT_MISMATCH' });
        if (p.status !== 'paid') { p.status = 'paid'; p.payment_id = a.p_payment; db.consults.get(p.ref_id).status = 'confirmed'; }
        return send(200, p.ref_id);
      }
      if (fn === 'activate_premium') {
        const p = db.payments.get(a.p_order);
        if (!p || p.purpose !== 'premium') return send(400, { message: 'ORDER_NOT_FOUND' });
        if (p.user_id !== a.p_user) return send(400, { message: 'USER_MISMATCH' });
        if (p.amount !== a.p_amount || p.currency !== a.p_currency) return send(400, { message: 'AMOUNT_MISMATCH' });
        if (p.status === 'refunded') return send(400, { message: 'ALREADY_REFUNDED' });
        if (p.status !== 'paid') { p.status = 'paid'; p.payment_id = a.p_payment; const prev = db.subs.get(a.p_user); db.subs.set(a.p_user, { status: 'active', until: (prev?.until ?? Date.now()) + a.p_days * 86400000 }); }
        return send(200, new Date(db.subs.get(a.p_user).until).toISOString());
      }
      if (fn === 'fail_payment') { const p = db.payments.get(a.p_order); if (p?.status === 'created') p.status = 'failed'; return send(200, null); }
      if (fn === 'mark_payment_refunded') { for (const [, p] of db.payments) if (p.payment_id === a.p_payment && p.status === 'paid') { p.status = 'refunded'; db.subs.set(p.user_id, { status: 'cancelled' }); } return send(200, null); }
      return send(404, { message: 'unknown rpc' });
    }
    if (url.pathname === '/rest/v1/profiles') return svc ? send(200, [{ suspended: false }]) : send(401, {});
    if (url.pathname === '/rest/v1/payments') {
      if (!svc) return send(401, {});
      const order = (url.searchParams.get('provider_order_id') || '').replace('eq.', ''); const p = db.payments.get(order);
      return send(200, p ? [{ user_id: p.user_id, purpose: p.purpose }] : []);
    }
    if (url.pathname === '/rest/v1/consultations') {
      if (!svc) return send(401, {});
      const k = db.consults.get((url.searchParams.get('id') || '').replace('eq.', ''));
      return send(200, k ? [k] : []);
    }
    if (url.pathname === '/rest/v1/question_feed') {   // public view: anon key only
      if (req.headers.apikey !== ANON) return send(401, {});
      const id = url.searchParams.get('id');
      if (id) return send(200, id === `eq.${QID}` ? [{ title: 'Is <script>alert(1)</script> "zakat" due?', body: 'Details\nhere & there' }] : []);
      return send(200, [{ id: QID, created_at: '2026-10-01T10:00:00Z' }]);
    }
    send(404, { message: 'not found' });
  });
}

// ---------------- fake Razorpay ----------------
const rz = { payments: new Map(), n: 0, orders: [] };
function fakeRazorpay() {
  return http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')) return send(401, { error: { description: 'auth' } });
    if (req.method === 'POST' && req.url === '/v1/orders') { const o = JSON.parse(body); const id = 'order_TEST' + (++rz.n) + 'ABCDEFG'; rz.orders.push({ id, ...o }); return send(200, { id, amount: o.amount, currency: o.currency }); }
    const m = /^\/v1\/payments\/(.+)$/.exec(req.url);
    if (m) { const p = rz.payments.get(m[1]); return p ? send(200, p) : send(400, { error: { description: 'not found' } }); }
    send(404, {});
  });
}

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
let fs_, fr_, app, base, cfg;
const logSink = { error() {}, warn() {}, log() {} };
const call = (path, { method = 'GET', token, json, raw, headers = {} } = {}) => fetch(base + path, {
  method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : raw,
});
const newOrder = async (who = 'alice') => { const r = await call('/api/payments/create-order', { method: 'POST', token: TOK[who], json: {} }); return { r, body: await r.json() }; };
const capture = (order, id, extra = {}) => { rz.payments.set(id, { id, order_id: order.order_id, status: 'captured', amount: order.amount, currency: order.currency, ...extra }); return id; };
const verifyBody = (order, pid, sig) => ({ razorpay_order_id: order.order_id, razorpay_payment_id: pid, razorpay_signature: sig ?? hmac(KEY_SECRET, `${order.order_id}|${pid}`) });
const webhookCall = (event, { secret = WH_SECRET, sig } = {}) => { const raw = JSON.stringify(event); return call('/api/payments/webhook', { method: 'POST', raw, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig ?? hmac(secret, raw) } }); };

before(async () => {
  fs_ = fakeSupabase(); fr_ = fakeRazorpay();
  const [sp, rp] = await Promise.all([listen(fs_), listen(fr_)]);
  cfg = loadConfig({ SUPABASE_URL: `http://127.0.0.1:${sp}`, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET, RAZORPAY_API_BASE: `http://127.0.0.1:${rp}`, PREMIUM_PRICE_PAISE: '9900', PREMIUM_DAYS: '30', CONTACT_EMAIL: 'help@example.org', SITE_URL: 'https://askdeen.example' });
  app = createServer(cfg, logSink); base = 'http://127.0.0.1:' + await listen(app);
});
after(() => { for (const s of [app, fs_, fr_]) s?.close(); app?.closeAllConnections?.(); });

// =============================== config & secrets ===============================
test('config.js exposes only public values and never any secret', async () => {
  const body = await (await call('/js/config.js')).text();
  assert.match(body, /window\.ASKDEEN = /);
  assert.ok(body.includes(ANON) && body.includes('"enabled":true'));
  for (const secret of [SERVICE, KEY_SECRET, WH_SECRET, KEY_ID]) assert.ok(!body.includes(secret), 'leaked: ' + secret.slice(0, 8));
  assert.equal((await call('/js/config.js')).headers.get('cache-control'), 'no-store');
});
test('a service_role key pasted into the public anon slot is refused, not exposed', () => {
  const c = loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: SERVICE });
  assert.equal(c.supabaseReady, false); assert.equal(c.anonKey, ''); assert.ok(c.problems.some(p => /service_role/.test(p)));
});
test('payments stay off unless every required secret is present', () => {
  const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: ANON };
  assert.equal(loadConfig(base).paymentsReady, false);
  assert.equal(loadConfig({ ...base, RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' }).paymentsReady, false);   // no service key
  assert.equal(loadConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' }).paymentsReady, true);
});

// =============================== static + headers ===============================
test('security headers are sent', async () => {
  const r = await call('/'); const csp = r.headers.get('content-security-policy');
  assert.equal(r.status, 200);
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
});
test('path traversal, dotfiles and server code are never served', async () => {
  for (const p of ['/../server/config.js', '/%2e%2e/server/config.js', '/js/..%2f..%2fserver%2fconfig.js', '/%00', '/.env', '/js/../../package.json', '/..%5cserver%5cconfig.js'])
  { const r = await call(p), b = await r.text(); assert.ok([400, 404].includes(r.status) || (/<!doctype html>/i.test(b) && !/SERVICE|SECRET|KEY=/.test(b)), p); }
  assert.equal((await call('/server/config.js')).status, 404);
  assert.equal((await call('/js/pages/admin.js')).status, 200);      // public app code is meant to be public
});
test('SPA routes fall back to index.html, unknown files 404, non-GET is rejected', async () => {
  assert.equal((await call('/qa')).status, 200); assert.equal((await call('/scholar/abc')).status, 200);
  assert.equal((await call('/missing.png')).status, 404);
  assert.equal((await call('/', { method: 'POST' })).status, 405);
});

// =============================== payments ===============================
test('create-order needs a real logged-in user', async () => {
  assert.equal((await call('/api/payments/create-order', { method: 'POST' })).status, 401);
  assert.equal((await call('/api/payments/create-order', { method: 'POST', token: 'not.a.token' })).status, 401);
  assert.equal((await call('/api/payments/create-order', { method: 'POST', token: 'forged.payload.sig' })).status, 401);   // looks like a JWT but Supabase rejects it
  assert.equal((await call('/api/payments/create-order')).status, 405);
});
test('the PRICE is decided by the server: a client-supplied amount is ignored', async () => {
  const r = await call('/api/payments/create-order', { method: 'POST', token: TOK.bob, json: { amount: 1, currency: 'USD' } });
  const o = await r.json();
  assert.equal(r.status, 200); assert.equal(o.amount, 9900); assert.equal(o.currency, 'INR'); assert.equal(o.key_id, KEY_ID);
  assert.equal(rz.orders.at(-1).amount, 9900);
  assert.equal(db.payments.get(o.order_id).user_id, BOB);   // recorded against the authenticated user
});
test('verify: wrong signature, bad ids and missing fields are rejected', async () => {
  const { body: o } = await newOrder('alice'); const pid = capture(o, 'pay_ALICEGOOD01');
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o, pid, 'a'.repeat(64)) })).status, 400);
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o, pid, hmac('wrong secret', `${o.order_id}|${pid}`)) })).status, 400);
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: { razorpay_order_id: "x'; drop", razorpay_payment_id: pid, razorpay_signature: 'zz' } })).status, 400);
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: {} })).status, 400);
  assert.equal((await call('/api/payments/verify', { method: 'POST', json: verifyBody(o, pid) })).status, 401);
  assert.equal(db.subs.get(ALICE)?.status, undefined, 'nothing may be granted');
});
test('verify: a valid signature is NOT enough, the payment must be captured at Razorpay', async () => {
  const { body: o } = await newOrder('alice'); const pid = capture(o, 'pay_AUTHONLY0001', { status: 'authorized' });
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o, pid) })).status, 409);
  assert.equal(db.subs.get(ALICE)?.status, undefined);
  rz.payments.set('pay_FAILEDPAY001', { id: 'pay_FAILEDPAY001', order_id: o.order_id, status: 'failed', amount: o.amount, currency: o.currency });
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o, 'pay_FAILEDPAY001') })).status, 402);
  assert.equal(db.payments.get(o.order_id).status, 'failed');
});
test('verify: a payment for a different order, or with a different amount, is refused', async () => {
  const { body: o1 } = await newOrder('alice'); const { body: o2 } = await newOrder('alice');
  const pid = capture(o2, 'pay_OTHERORDER01');                                               // belongs to o2
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o1, pid) })).status, 400);
  const pid2 = capture(o1, 'pay_CHEAPAMOUNT01', { amount: 100 });                           // cheaper than the recorded order
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o1, pid2) })).status, 403);
  assert.equal(db.subs.get(ALICE)?.status, undefined);
});
test('verify: another user cannot claim someone else\'s payment', async () => {
  const { body: o } = await newOrder('alice'); const pid = capture(o, 'pay_STOLEN000001');
  const r = await call('/api/payments/verify', { method: 'POST', token: TOK.bob, json: verifyBody(o, pid) });
  assert.equal(r.status, 403); assert.notEqual(db.payments.get(o.order_id).status, 'paid');
});
test('verify: happy path grants Premium once, replaying never extends it again', async () => {
  const { body: o } = await newOrder('alice'); const pid = capture(o, 'pay_HAPPYPATH0001');
  const r1 = await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o, pid) });
  assert.equal(r1.status, 200); const { until } = await r1.json();
  assert.equal(db.subs.get(ALICE).status, 'active'); assert.equal(db.payments.get(o.order_id).status, 'paid');
  const call2 = db.rpcCalls.filter(([f, a]) => f === 'activate_premium' && a.p_order === o.order_id).at(-1)[1];
  assert.deepEqual([call2.p_user, call2.p_amount, call2.p_currency, call2.p_provider, call2.p_days], [ALICE, 9900, 'INR', 'razorpay', 30]);
  const r2 = await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o, pid) });
  assert.equal(r2.status, 200); assert.equal((await r2.json()).until, until);
});
test('verify: payment provider or database outage returns a retryable error, never a fake success', async () => {
  const { body: o } = await newOrder('alice'); const pid = capture(o, 'pay_OUTAGE0000001');
  db.failRpc = true;
  const r = await call('/api/payments/verify', { method: 'POST', token: TOK.alice, json: verifyBody(o, pid) });
  db.failRpc = false;
  assert.equal(r.status, 502); assert.notEqual(db.payments.get(o.order_id)?.status, 'paid');
});

// =============================== webhook ===============================
const evt = (type, entity) => ({ event: type, payload: { payment: { entity }, ...(type.startsWith('refund') ? { refund: { entity } } : {}) } });
test('webhook: missing / wrong signature is rejected and changes nothing', async () => {
  const { body: o } = await newOrder('bob'); const pid = capture(o, 'pay_WHBADSIG00001');
  const e = evt('payment.captured', rz.payments.get(pid));
  assert.equal((await call('/api/payments/webhook', { method: 'POST', raw: JSON.stringify(e) })).status, 400);
  assert.equal((await webhookCall(e, { secret: 'attacker-secret' })).status, 400);
  assert.equal((await webhookCall(e, { sig: 'f'.repeat(64) })).status, 400);
  assert.notEqual(db.payments.get(o.order_id).status, 'paid');
});
test('webhook: captured payment activates Premium for the order owner from OUR database, not the payload', async () => {
  const { body: o } = await newOrder('bob'); const pid = capture(o, 'pay_WHGOOD0000001');
  const entity = { ...rz.payments.get(pid), notes: { user_id: ALICE } };     // attacker-style note pointing at someone else
  assert.equal((await webhookCall(evt('payment.captured', entity))).status, 200);
  assert.equal(db.payments.get(o.order_id).status, 'paid'); assert.equal(db.payments.get(o.order_id).user_id, BOB);
  const before = db.subs.get(BOB).until;
  assert.equal((await webhookCall(evt('payment.captured', entity))).status, 200);   // Razorpay retries: idempotent
  assert.equal(db.subs.get(BOB).until, before);
});
test('webhook: unknown order is acknowledged without granting anything', async () => {
  const entity = { id: 'pay_UNKNOWN000001', order_id: 'order_NEVERSEEN12345', status: 'captured', amount: 9900, currency: 'INR' };
  const r = await webhookCall(evt('payment.captured', entity)); assert.equal(r.status, 200); assert.equal((await r.json()).ignored, 'unknown order');
});
test('webhook: payment.failed and refund.processed update records, a refund cancels Premium', async () => {
  const { body: o1 } = await newOrder('carol'); const p1 = capture(o1, 'pay_WHFAILED00001', { status: 'failed' });
  await webhookCall(evt('payment.failed', rz.payments.get(p1))); assert.equal(db.payments.get(o1.order_id).status, 'failed');
  const { body: o2 } = await newOrder('carol'); const p2 = capture(o2, 'pay_WHREFUND00001');
  await webhookCall(evt('payment.captured', rz.payments.get(p2))); assert.equal(db.subs.get(CAROL).status, 'active');
  await webhookCall(evt('refund.processed', { id: 'rfnd_1', payment_id: p2 }));
  assert.equal(db.payments.get(o2.order_id).status, 'refunded'); assert.equal(db.subs.get(CAROL).status, 'cancelled');
});
test('webhook: a temporary database failure returns 500 so Razorpay retries', async () => {
  const { body: o } = await newOrder('bob'); const pid = capture(o, 'pay_WHRETRY000001');
  db.failRpc = true; const r = await webhookCall(evt('payment.captured', rz.payments.get(pid))); db.failRpc = false;
  assert.equal(r.status, 500); assert.notEqual(db.payments.get(o.order_id).status, 'paid');
});

// =============================== abuse limits ===============================
test('order creation is rate limited per user', async () => {
  let last; for (let i = 0; i < 12; i++) last = (await call('/api/payments/create-order', { method: 'POST', token: TOK.alice, json: {} })).status;
  assert.equal(last, 429);
});

// =============================== SEO ===============================
test('question pages get their own escaped title/description; unknown ids keep the default', async () => {
  const html = await (await call('/q/' + QID)).text();
  assert.match(html, /<title>Is &lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;zakat&quot; due\? · Alfrzo Ilm<\/title>/);
  assert.ok(!html.includes('<script>alert(1)'), 'raw script from a question title must never reach the page');
  assert.match(html, /<link rel="canonical" href="https:\/\/askdeen\.example\/q\/33333333-3333-4333-8333-333333333333">/);
  const other = await (await call('/q/44444444-4444-4444-8444-444444444444')).text();
  assert.match(other, /<title>Alfrzo Ilm/);
});
test('sitemap lists published questions with the configured site URL', async () => {
  const xml = await (await call('/sitemap.xml')).text();
  assert.match(xml, /<loc>https:\/\/askdeen\.example\/q\/33333333-3333-4333-8333-333333333333<\/loc>/);
  assert.match(await (await call('/robots.txt')).text(), /Sitemap: https:\/\/askdeen\.example\/sitemap\.xml/);
});

// =============================== consultation payments ===============================
const K1 = '66666666-6666-4666-8666-666666666661', K2 = '66666666-6666-4666-8666-666666666662', K3 = '66666666-6666-4666-8666-666666666663';
const DAVE = '77777777-7777-4777-8777-777777777777'; WHO['tok.dave.sig'] = DAVE; TOK.dave = 'tok.dave.sig';
const consultOrder = (who, id) => call('/api/payments/consultation-order', { method: 'POST', token: TOK[who], json: { consultation_id: id, amount: 1 } });
test('consultation order: price comes from the booking in the database; only its owner, only while pending', async () => {
  db.consults.set(K1, { user_id: DAVE, price_paise: 39900, status: 'pending_payment' });
  db.consults.set(K2, { user_id: DAVE, price_paise: 0, status: 'confirmed' });
  assert.equal((await call('/api/payments/consultation-order', { method: 'POST', json: { consultation_id: K1 } })).status, 401);
  assert.equal((await consultOrder('dave', 'not-a-uuid')).status, 400);
  assert.equal((await consultOrder('bob', K1)).status, 404);                      // someone else's booking
  assert.equal((await consultOrder('dave', K2)).status, 409);                     // free / already confirmed
  const r = await consultOrder('dave', K1); const o = await r.json();
  assert.equal(r.status, 200); assert.equal(o.amount, 39900);                     // client-sent amount:1 ignored
  assert.equal(db.payments.get(o.order_id).purpose, 'consultation');
});
test('consultation payment: verify confirms the BOOKING and never grants Premium; replay is harmless', async () => {
  const o = await (await consultOrder('dave', K1)).json(); const pid = capture(o, 'pay_CONSULT000001');
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.bob, json: verifyBody(o, pid) })).status, 403);
  assert.equal(db.consults.get(K1).status, 'pending_payment');
  const r = await call('/api/payments/verify', { method: 'POST', token: TOK.dave, json: verifyBody(o, pid) });
  assert.equal(r.status, 200); assert.equal((await r.json()).consultation_id, K1);
  assert.equal(db.consults.get(K1).status, 'confirmed'); assert.equal(db.subs.get(DAVE), undefined);
  assert.equal((await call('/api/payments/verify', { method: 'POST', token: TOK.dave, json: verifyBody(o, pid) })).status, 200);
  assert.ok(!db.rpcCalls.some(([f, a]) => f === 'activate_premium' && a.p_order === o.order_id));
});
test('consultation payment: the webhook alone can confirm a booking (buyer closed the page)', async () => {
  db.consults.set(K3, { user_id: DAVE, price_paise: 19900, status: 'pending_payment' });
  const o = await (await consultOrder('dave', K3)).json(); const pid = capture(o, 'pay_CONSULTWH0001');
  assert.equal((await webhookCall(evt('payment.captured', rz.payments.get(pid)))).status, 200);
  assert.equal(db.consults.get(K3).status, 'confirmed'); assert.equal(db.subs.get(DAVE), undefined);
});
test('public config carries the meeting base URL and CSP allows video from storage', async () => {
  assert.match(await (await call('/js/config.js')).text(), /"MEETING_BASE":"https:\/\/meet\.jit\.si\/"/);
  assert.match((await call('/')).headers.get('content-security-policy'), /media-src 'self' blob: http:\/\/127\.0\.0\.1/);
});

// =============================== client IP behind a proxy (M7) ===============================
const fakeReq = (xff, remote = '10.0.0.9') => ({ headers: xff == null ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
test('client IP: a forged X-Forwarded-For entry cannot choose the rate-limit key', () => {
  // client sends "1.2.3.4" itself; the one trusted proxy appends the real address 203.0.113.7
  assert.equal(clientIp(fakeReq('1.2.3.4, 203.0.113.7'), 1), '203.0.113.7');
  assert.equal(clientIp(fakeReq('9.9.9.9, 8.8.8.8, 203.0.113.7'), 1), '203.0.113.7');
  assert.equal(clientIp(fakeReq('203.0.113.7'), 1), '203.0.113.7');                  // honest single hop
  assert.equal(clientIp(fakeReq('1.2.3.4, 198.51.100.2, 192.0.2.1'), 2), '198.51.100.2');   // two proxies
  assert.equal(clientIp(fakeReq('1.2.3.4'), 0), '10.0.0.9');                         // no proxy: header ignored
  assert.equal(clientIp(fakeReq(null), 1), '10.0.0.9');
  assert.equal(clientIp(fakeReq(' , '), 1), '10.0.0.9');
});
test('TRUST_PROXY accepts a proxy count, true/1 meaning one proxy, empty meaning none', () => {
  const tp = v => loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: ANON, TRUST_PROXY: v }).trustProxy;
  assert.deepEqual(['1', 'true', 'yes', '2', '', '0', 'no', 'junk'].map(tp), [1, 1, 1, 2, 0, 0, 0, 0]);
});
test('rate limiting cannot be dodged by rotating a forged X-Forwarded-For', async () => {
  const c = loadConfig({ SUPABASE_URL: cfg.supabaseUrl, SUPABASE_ANON_KEY: ANON, TRUST_PROXY: '1' });
  const s = createServer(c, logSink); const port = await listen(s);
  let last;
  for (let i = 0; i < 125; i++) last = (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'X-Forwarded-For': `10.1.${i >> 8}.${i & 255}, 203.0.113.50` } })).status;
  s.close(); s.closeAllConnections?.();
  assert.equal(last, 429);
});
