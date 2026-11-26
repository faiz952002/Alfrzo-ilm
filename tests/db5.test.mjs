// Real-PostgreSQL tests for supabase/migrations/007_premium_refund_correction.sql (Premium refunds).
// Run after tests/reset-db.sh:  PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=askdeen node --test tests/db5.test.mjs
// Payment functions are called the way the server calls them (service role); clients are checked to be refused.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const U = { admin: 'aaaaaaaa-0000-4000-8000-0000000000a1', sch: 'bbbbbbbb-0000-4000-8000-0000000000b1',
  p1: 'cccccccc-0000-4000-8000-0000000000c1', p2: 'cccccccc-0000-4000-8000-0000000000c2', p3: 'cccccccc-0000-4000-8000-0000000000c3',
  p4: 'cccccccc-0000-4000-8000-0000000000c4', p5: 'cccccccc-0000-4000-8000-0000000000c5', p6: 'cccccccc-0000-4000-8000-0000000000c6',
  p7: 'cccccccc-0000-4000-8000-0000000000c7', p8: 'cccccccc-0000-4000-8000-0000000000c8', eve: 'cccccccc-0000-4000-8000-0000000000e1' };
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
const DAY = 86400;
// one Premium purchase exactly as the server does it: record the order, then activate after Razorpay confirms it
const buy = (who, n, { amount = 9900, days = 30 } = {}) => {
  as('service', `select record_payment_order('${U[who]}','order_${who}${n}XYZ',${amount},'INR','razorpay')`);
  return as('service', `select activate_premium('${U[who]}','order_${who}${n}XYZ','pay_${who}${n}XYZ',${amount},'INR','razorpay',${days})`);
};
const refund = (who, n, id, amount) => as('service', `select apply_payment_refund('pay_${who}${n}XYZ','${id}',${amount})`);
const sub = who => root(`select status||'|'||round(extract(epoch from current_period_end - now())/${DAY})||'|'||coalesce(provider,'-') from subscriptions where user_id='${U[who]}' order by created_at desc limit 1`);
const pay = (who, n) => root(`select status||'|'||refunded_paise||'|'||coalesce(premium_days::text,'-') from payments where provider_payment_id='pay_${who}${n}XYZ'`);
const premium = who => root(`select public.is_premium('${U[who]}')`);
const endSecs = who => Number(root(`select extract(epoch from current_period_end) from subscriptions where user_id='${U[who]}' order by created_at desc limit 1`));
const removedSecs = (who, n) => Number(root(`select coalesce(extract(epoch from sum(r.time_removed)),0) from payment_refunds r join payments p on p.id=r.payment_id where p.provider_payment_id='pay_${who}${n}XYZ'`));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.001, `${msg}: ${a} vs ${b}`);

before(() => {
  root(`truncate auth.users cascade; truncate audit_logs, payments restart identity cascade; delete from storage.objects`);
  for (const [k, id] of Object.entries(U)) root(`insert into auth.users(id,email,raw_user_meta_data) values('${id}','${k}@example.test','{"display_name":"${k.toUpperCase()}"}')`);
  root(`update profiles set role='admin' where id='${U.admin}'`);
  root(`update profiles set role='scholar' where id='${U.sch}'`);
  root(`insert into scholars(id,verified,verified_at) values('${U.sch}',true,now())`);
});

test('a Premium payment records its days and the subscription it extended (payment-to-subscription record)', () => {
  buy('p1', 1);
  assert.equal(pay('p1', 1), 'paid|0|30');
  assert.equal(root(`select count(*) from payments p join subscriptions s on s.id = p.subscription_id where p.provider_payment_id='pay_p11XYZ' and s.user_id='${U.p1}'`), '1');
  assert.equal(sub('p1'), 'active|30|razorpay');
});

test('a full refund of the only payment removes its 30 days: Premium ends, nothing else changes', () => {
  assert.equal(refund('p1', 1, 'rfnd_P1FULL000001', 9900), 'applied');
  assert.equal(pay('p1', 1), 'refunded|9900|30');
  assert.match(sub('p1'), /^cancelled\|0\|razorpay$/);
  assert.equal(premium('p1'), 'f');
  assert.equal(root(`select extract(epoch from time_removed)::bigint||'|'||amount_paise from payment_refunds where provider_refund_id='rfnd_P1FULL000001'`), `${30 * DAY}|9900`);
});

test('two Premium payments (60 days): refunding the first removes only its 30 days, the second payment keeps Premium active', () => {
  buy('p2', 1); buy('p2', 2);
  assert.equal(sub('p2'), 'active|60|razorpay');
  assert.equal(refund('p2', 1, 'rfnd_P2FIRST00001', 9900), 'applied');
  assert.equal(sub('p2'), 'active|30|razorpay');
  assert.equal(premium('p2'), 't');
  assert.equal(pay('p2', 1), 'refunded|9900|30');
  assert.equal(pay('p2', 2), 'paid|0|30');
});

test('the same refund delivered twice (webhook retry) is applied once', () => {
  assert.equal(refund('p2', 1, 'rfnd_P2FIRST00001', 9900), 'duplicate');
  assert.equal(sub('p2'), 'active|30|razorpay');
  assert.equal(root(`select count(*) from payment_refunds where provider_refund_id='rfnd_P2FIRST00001'`), '1');
  as('service', `select mark_payment_refunded('pay_p21XYZ')`);                    // old entry point on an already refunded payment: no change
  assert.equal(sub('p2'), 'active|30|razorpay');
});

test('partial refunds remove exactly the same share of the time (no rounding); together they can never exceed the payment', () => {
  buy('p3', 1);                                                                    // 30 days for 9900 paise
  const start = endSecs('p3');
  assert.equal(refund('p3', 1, 'rfnd_P3HALF000001', 4950), 'applied');            // half the money -> exactly 15 days
  near(start - endSecs('p3'), 15 * DAY, 'half refund');
  assert.equal(sub('p3'), 'active|15|razorpay');
  assert.equal(pay('p3', 1), 'paid|4950|30');
  assert.equal(refund('p3', 1, 'rfnd_P3SMALL00001', 100), 'applied');             // 100 of 9900 -> 30 days x 100/9900 = 7h 16m 21.8s
  near(start - endSecs('p3'), 15 * DAY + 30 * DAY * 100 / 9900, 'small refund is exact, not a whole day');
  assert.equal(refund('p3', 1, 'rfnd_P3TOOMUCH001', 9900), 'applied');            // asks for more than is left: only the rest
  assert.equal(pay('p3', 1), 'refunded|9900|30');
  near(start - endSecs('p3'), 30 * DAY, 'in total exactly the 30 bought days');
  near(removedSecs('p3', 1), 30 * DAY, 'recorded total');
  assert.match(sub('p3'), /^cancelled\|0\|/);
  assert.equal(root(`select sum(r.amount_paise) from payment_refunds r join payments p on p.id=r.payment_id where p.provider_payment_id='pay_p31XYZ'`), '9900');
  assert.equal(refund('p3', 1, 'rfnd_P3AGAIN00001', 100), 'nothing_left');
  near(start - endSecs('p3'), 30 * DAY, 'nothing more removed');
});

test('many small partial refunds add up exactly and can never remove more than the payment bought', () => {
  buy('p8', 1, { amount: 10000, days: 30 });                                       // a second Premium buyer
  const start = endSecs('p8');
  const parts = [1, 333, 1234, 777, 2500, 13, 999, 3000, 1143];                    // 9 refunds, together exactly 10000
  parts.forEach((amt, i) => assert.equal(refund('p8', 1, `rfnd_P8PART${String(i).padStart(6, '0')}`, amt), 'applied'));
  let paid = 0;
  for (const amt of parts) paid += amt;
  assert.equal(paid, 10000);
  near(removedSecs('p8', 1), 30 * DAY, 'sum of all parts = the 30 bought days, no more');
  near(start - endSecs('p8'), 30 * DAY, 'subscription shortened by exactly 30 days');
  assert.equal(refund('p8', 1, 'rfnd_P8EXTRA000001', 5000), 'nothing_left');
  near(removedSecs('p8', 1), 30 * DAY, 'still not more');
  assert.equal(pay('p8', 1), 'refunded|10000|30');
});

test('admin-granted Premium is never cancelled by a payment refund: only the paid days go', () => {
  root(`insert into subscriptions(user_id,status,current_period_end,provider) values('${U.p4}','active',now()+interval '20 days','admin_grant')`);
  assert.equal(refund('p4', 9, 'rfnd_P4UNRELATED1', 9900), 'unknown_payment');    // unrelated / unknown refund
  assert.equal(sub('p4'), 'active|20|admin_grant');
  buy('p4', 1);                                                                    // a payment extends the admin grant: 50 days
  assert.equal(sub('p4'), 'active|50|admin_grant');                                // provider stays admin_grant
  assert.equal(refund('p4', 1, 'rfnd_P4PAID000001', 9900), 'applied');
  assert.equal(sub('p4'), 'active|20|admin_grant');                                // the 20 granted days remain
  assert.equal(premium('p4'), 't');
});

test('a consultation refund never touches Premium', () => {
  buy('p5', 1);
  const k = root(`insert into consultations(user_id,scholar_id,kind,price_paise,duration_min,starts_at,status) values('${U.p5}','${U.sch}','video',29900,30,now()+interval '3 days','confirmed') returning id`);
  root(`insert into payments(user_id,amount_paise,currency,provider,provider_order_id,provider_payment_id,status,purpose,ref_id) values('${U.p5}',29900,'INR','razorpay','order_p5CXYZ','pay_p5CXYZ','paid','consultation','${k}')`);
  assert.equal(as('service', `select apply_payment_refund('pay_p5CXYZ','rfnd_P5CONSULT001',29900)`), 'applied');
  assert.equal(root(`select status||'/'||refund_due from consultations where id='${k}'`), 'cancelled/false');
  assert.equal(sub('p5'), 'active|30|razorpay');
  assert.equal(premium('p5'), 't');
});

test('a booking payment can never be used to buy Premium (price/purpose tampering)', () => {
  fails(() => as('service', `select activate_premium('${U.p5}','order_p5CXYZ','pay_p5CXYZ',29900,'INR','razorpay',30)`), /ORDER_NOT_FOUND/);
  as('service', `select record_payment_order('${U.p6}','order_p6TAMPERXYZ',9900,'INR','razorpay')`);
  fails(() => as('service', `select activate_premium('${U.p6}','order_p6TAMPERXYZ','pay_p6TAMPERXYZ',100,'INR','razorpay',30)`), /AMOUNT_MISMATCH/);
  fails(() => as('service', `select activate_premium('${U.p6}','order_p6TAMPERXYZ','pay_p6TAMPERXYZ',9900,'USD','razorpay',30)`), /AMOUNT_MISMATCH/);
  fails(() => as('service', `select activate_premium('${U.p7}','order_p6TAMPERXYZ','pay_p6TAMPERXYZ',9900,'INR','razorpay',30)`), /USER_MISMATCH/);
  assert.equal(root(`select count(*) from subscriptions where user_id in ('${U.p6}','${U.p7}')`), '0');
});

test('pending and failed payments cannot be refunded; a refunded payment cannot activate Premium again', () => {
  assert.equal(as('service', `select apply_payment_refund('pay_none','rfnd_NOPAYMENT001',100)`), 'unknown_payment');
  root(`update payments set provider_payment_id='pay_p6PENDINGXYZ' where provider_order_id='order_p6TAMPERXYZ'`);   // still 'created' (pending)
  assert.equal(as('service', `select apply_payment_refund('pay_p6PENDINGXYZ','rfnd_P6PENDING001',9900)`), 'not_paid');
  as('service', `select fail_payment('order_p6TAMPERXYZ','pay_p6PENDINGXYZ')`);
  assert.equal(as('service', `select apply_payment_refund('pay_p6PENDINGXYZ','rfnd_P6FAILED0001',9900)`), 'not_paid');
  fails(() => as('service', `select activate_premium('${U.p1}','order_p11XYZ','pay_p11XYZ',9900,'INR','razorpay',30)`), /ALREADY_REFUNDED/);
});

test('an expired subscription is never re-activated by a refund', () => {
  buy('p7', 1);
  root(`update subscriptions set current_period_end = now() - interval '5 days' where user_id='${U.p7}'`);   // ran out already
  assert.equal(refund('p7', 1, 'rfnd_P7EXPIRED001', 9900), 'applied');
  assert.match(sub('p7'), /^cancelled\|-35\|/);
  assert.equal(premium('p7'), 'f');
  root(`update subscriptions set status='expired', current_period_end = now() - interval '1 day' where user_id='${U.p1}'`);
  assert.equal(refund('p1', 1, 'rfnd_P1LATE000001', 100), 'nothing_left');
  assert.match(sub('p1'), /^expired\|/);
});

test('refund functions and records are server-only: visitors and users are refused', () => {
  for (const who of ['anon', 'eve']) {
    fails(() => as(who, `select apply_payment_refund('pay_p21XYZ','rfnd_ATTACK000001',9900)`), /permission denied/);
    fails(() => as(who, `select mark_payment_refunded('pay_p22XYZ')`), /permission denied/);
    fails(() => as(who, `select activate_premium('${U.eve}','order_p22XYZ','pay_p22XYZ',9900,'INR','razorpay',30)`), /permission denied/);
    fails(() => as(who, `select count(*) from payment_refunds`), /permission denied/);
  }
  fails(() => as('p2', `update payments set refunded_paise = 0, status = 'paid' where user_id='${U.p2}'`), /permission denied/);
  fails(() => as('p2', `update subscriptions set current_period_end = now() + interval '1 year' where user_id='${U.p2}'`), /permission denied/);
  assert.equal(as('p2', `select count(*) from payments`), '2');                     // a user still sees only their own payments
  assert.equal(as('eve', `select count(*) from payments`), '0');
  assert.equal(sub('p2'), 'active|30|razorpay');
});

test('every applied refund is written to the audit log with what it removed', () => {
  const row = root(`select (meta->>'refund')||'|'||(meta->>'seconds_removed')::numeric::bigint||'|'||(meta->>'full') from audit_logs where action='payment_refunded' and meta->>'refund'='rfnd_P3HALF000001'`);
  assert.equal(row, `rfnd_P3HALF000001|${15 * DAY}|false`);
});
