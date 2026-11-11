import { hmacHex, safeEqualHex } from './security.js';

// Payment rules (the whole point of having a server):
//  * The browser can never mark anything as paid. Only these handlers call the service-role RPCs.
//  * A payment is trusted only after (1) the signature checks out AND (2) we re-fetch it from Razorpay with our secret
//    and see status "captured" for the right order, amount and currency.
//  * The database function activate_premium() is idempotent and cross-checks user / amount, so replays never double-grant.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_RE = /^order_[A-Za-z0-9]{6,40}$/, PAY_RE = /^pay_[A-Za-z0-9]{6,40}$/, SIG_RE = /^[a-f0-9]{64}$/;

const errText = r => (typeof r?.data === 'string' ? r.data : r?.data?.message || r?.data?.error?.description || `HTTP ${r?.status}`);

export function paymentsApi(cfg, { sb, rzp, limiter, log = console }) {
  const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  async function readBody(req, limit = 64 * 1024) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  const readJson = async req => { try { return JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch (e) { throw Object.assign(new Error(e.status === 413 ? 'Body too large' : 'Bad JSON'), { status: e.status || 400 }); } };

  async function user(req, res) {
    const m = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.headers.authorization || '');
    if (!m) { send(res, 401, { error: 'Login required' }); return null; }
    let u = null;
    try { u = await sb.authUser(m[1]); } catch { send(res, 502, { error: 'Auth service unavailable' }); return null; }
    if (!u) { send(res, 401, { error: 'Login required' }); return null; }
    return u;
  }

  // ---- POST /api/payments/create-order --------------------------------------------------------
  async function createOrder(req, res) {
    const u = await user(req, res); if (!u) return;
    if (!limiter.take('order:' + u.id, 8, 3600_000)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    const profile = await sb.selectService(`profiles?id=eq.${u.id}&select=suspended&limit=1`).catch(() => null);
    if (profile?.ok && profile.data?.[0]?.suspended) return send(res, 403, { error: 'Account suspended' });

    let order;
    try { order = await rzp.createOrder({ amount: cfg.amountPaise, currency: cfg.currency, receipt: `ad_${u.id.slice(0, 8)}_${Date.now().toString(36)}`, notes: { user_id: u.id, product: 'premium' } }); }
    catch (e) { log.error('razorpay createOrder failed:', e.message); return send(res, 502, { error: 'Payment provider unavailable' }); }
    if (!order.ok || !order.data?.id || order.data.amount !== cfg.amountPaise) { log.error('razorpay createOrder bad response:', order.status, errText(order)); return send(res, 502, { error: 'Could not start payment' }); }

    const rec = await sb.rpc('record_payment_order', { p_user: u.id, p_order: order.data.id, p_amount: order.data.amount, p_currency: order.data.currency, p_provider: 'razorpay' }).catch(() => null);
    if (!rec?.ok) { log.error('record_payment_order failed:', rec && errText(rec)); return send(res, /SUSPENDED/.test(errText(rec)) ? 403 : 502, { error: 'Could not start payment' }); }
    send(res, 200, { key_id: cfg.razorpay.keyId, order_id: order.data.id, amount: order.data.amount, currency: order.data.currency });
  }

  // ---- POST /api/payments/consultation-order  { consultation_id } --------------------------------
  // The price comes from the booking row in OUR database, never from the browser.
  async function consultationOrder(req, res) {
    const u = await user(req, res); if (!u) return;
    if (!limiter.take('order:' + u.id, 8, 3600_000)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    let b; try { b = await readJson(req); } catch (e) { return send(res, e.status, { error: e.message }); }
    const id = String(b.consultation_id || '');
    if (!UUID_RE.test(id)) return send(res, 400, { error: 'Invalid booking' });
    const row = await sb.selectService(`consultations?id=eq.${id}&select=user_id,price_paise,status&limit=1`).catch(() => null);
    if (!row?.ok) return send(res, 502, { error: 'Could not start payment' });
    const k = row.data?.[0];
    if (!k || k.user_id !== u.id) return send(res, 404, { error: 'Booking not found' });
    if (k.status !== 'pending_payment' || !(k.price_paise > 0)) return send(res, 409, { error: 'This booking does not need a payment' });

    let order;
    try { order = await rzp.createOrder({ amount: k.price_paise, currency: cfg.currency, receipt: `ac_${id.slice(0, 8)}_${Date.now().toString(36)}`, notes: { user_id: u.id, product: 'consultation' } }); }
    catch (e) { log.error('razorpay createOrder failed:', e.message); return send(res, 502, { error: 'Payment provider unavailable' }); }
    if (!order.ok || !order.data?.id || order.data.amount !== k.price_paise) return send(res, 502, { error: 'Could not start payment' });
    const rec = await sb.rpc('record_consultation_order', { p_user: u.id, p_consultation: id, p_order: order.data.id, p_amount: order.data.amount, p_currency: order.data.currency, p_provider: 'razorpay' }).catch(() => null);
    if (!rec?.ok) { log.error('record_consultation_order failed:', rec && errText(rec)); return send(res, /NOT_PAYABLE/.test(errText(rec)) ? 409 : 502, { error: 'Could not start payment' }); }
    send(res, 200, { key_id: cfg.razorpay.keyId, order_id: order.data.id, amount: order.data.amount, currency: order.data.currency });
  }

  // What is this order for, and whose is it? Always read from OUR database.
  async function orderInfo(orderId) {
    const row = await sb.selectService(`payments?provider_order_id=eq.${encodeURIComponent(orderId)}&select=user_id,purpose&limit=1`);
    if (!row.ok) throw new Error('order lookup failed');
    return row.data?.[0] || null;
  }

  // Shared by verify + webhook. `userId` is already trusted by the caller.
  async function settle({ userId, orderId, paymentId, entity, purpose }) {
    if (purpose === 'consultation')
      return sb.rpc('confirm_consultation_payment', { p_user: userId, p_order: orderId, p_payment: paymentId, p_amount: entity.amount, p_currency: entity.currency });
    return sb.rpc('activate_premium', { p_user: userId, p_order: orderId, p_payment: paymentId, p_amount: entity.amount, p_currency: entity.currency, p_provider: 'razorpay', p_days: cfg.days });
  }

  // ---- POST /api/payments/verify (buyer returns from checkout) ---------------------------------
  async function verify(req, res) {
    const u = await user(req, res); if (!u) return;
    if (!limiter.take('verify:' + u.id, 30, 3600_000)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
    let b; try { b = await readJson(req); } catch (e) { return send(res, e.status, { error: e.message }); }
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = b;
    if (!ORDER_RE.test(orderId || '') || !PAY_RE.test(paymentId || '') || !SIG_RE.test(sig || '')) return send(res, 400, { error: 'Invalid payment details' });
    if (!safeEqualHex(hmacHex(cfg.razorpay.keySecret, `${orderId}|${paymentId}`), sig)) return send(res, 400, { error: 'Payment signature mismatch' });

    let pay;
    try { pay = await rzp.getPayment(paymentId); } catch (e) { log.error('razorpay getPayment failed:', e.message); return send(res, 502, { error: 'Payment provider unavailable' }); }
    const p = pay.data;
    if (!pay.ok || !p || p.order_id !== orderId) return send(res, 400, { error: 'Payment does not belong to this order' });
    if (p.status === 'failed') { await sb.rpc('fail_payment', { p_order: orderId, p_payment: paymentId }).catch(() => {}); return send(res, 402, { error: 'Payment failed' }); }
    if (p.status !== 'captured') return send(res, 409, { error: 'Payment not captured yet' });   // webhook completes it when captured

    const info = await orderInfo(orderId).catch(() => undefined);
    if (info === undefined) return send(res, 502, { error: 'Could not confirm payment' });
    if (!info) return send(res, 403, { error: 'Payment cannot be applied to this account' });
    const r = await settle({ userId: u.id, orderId, paymentId, entity: p, purpose: info.purpose }).catch(() => null);
    if (!r) return send(res, 502, { error: 'Could not confirm payment' });
    if (!r.ok) {
      const msg = errText(r);
      if (/USER_MISMATCH|ORDER_NOT_FOUND|AMOUNT_MISMATCH|ALREADY_REFUNDED/.test(msg)) { log.warn('verify rejected:', msg.slice(0, 80), 'order', orderId); return send(res, 403, { error: 'Payment cannot be applied to this account' }); }
      log.error('activate_premium failed:', msg); return send(res, 502, { error: 'Could not confirm payment' });
    }
    send(res, 200, info.purpose === 'consultation' ? { ok: true, consultation_id: r.data } : { ok: true, until: r.data });
  }

  // ---- POST /api/payments/webhook (Razorpay -> us) ------------------------------------------------
  async function webhook(req, res) {
    if (!cfg.webhookReady) return send(res, 503, { error: 'Webhook not configured' });
    let raw; try { raw = await readBody(req, 1024 * 1024); } catch { return send(res, 413, { error: 'Body too large' }); }
    const sig = String(req.headers['x-razorpay-signature'] || '');
    if (!SIG_RE.test(sig) || !safeEqualHex(hmacHex(cfg.razorpay.webhookSecret, raw), sig)) return send(res, 400, { error: 'Bad signature' });
    let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'Bad JSON' }); }

    try {
      const type = ev.event, pe = ev.payload?.payment?.entity, re = ev.payload?.refund?.entity;
      if ((type === 'payment.captured' || type === 'order.paid') && pe?.status === 'captured' && ORDER_RE.test(pe.order_id || '') && PAY_RE.test(pe.id || '')) {
        // Who owns this order? From OUR database (written when we created the order), never from the webhook body.
        let info; try { info = await orderInfo(pe.order_id); } catch { return send(res, 500, { error: 'lookup failed' }); }
        if (!info?.user_id) return send(res, 200, { ok: true, ignored: 'unknown order' });
        const r = await settle({ userId: info.user_id, orderId: pe.order_id, paymentId: pe.id, entity: pe, purpose: info.purpose });
        if (!r.ok && r.status >= 500) return send(res, 500, { error: 'temporary failure' });          // Razorpay will retry
        if (!r.ok) log.warn('webhook activate rejected:', errText(r).slice(0, 80));
      } else if (type === 'payment.failed' && ORDER_RE.test(pe?.order_id || '')) {
        await sb.rpc('fail_payment', { p_order: pe.order_id, p_payment: pe.id });
      } else if (type === 'refund.processed' && PAY_RE.test(re?.payment_id || '')) {
        const r = await sb.rpc('mark_payment_refunded', { p_payment: re.payment_id });
        if (!r.ok && r.status >= 500) return send(res, 500, { error: 'temporary failure' });
      }
      send(res, 200, { ok: true });
    } catch (e) { log.error('webhook error:', e.message); send(res, 500, { error: 'temporary failure' }); }
  }

  return { createOrder, consultationOrder, verify, webhook, send };
}
