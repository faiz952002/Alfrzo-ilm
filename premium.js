import { S, errMsg, loadProfile } from '../store.js';
import { t, getLang } from '../i18n.js';
import '../i18n.pages.js';
import { h, icon, toast, clear, busy, fmtMoney, timeAgo } from '../ui.js';
import { pageTitle } from '../components.js';

const RZP = 'https://checkout.razorpay.com/v1/checkout.js';

// Calls OUR server (never the payment provider directly with secrets). The server verifies everything.
async function api(path, body) {
  await S.sb.auth.restore().catch(() => {});
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.sb.getToken() }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { message: data.error || res.statusText, code: String(res.status) };
  return data;
}
const loadCheckout = () => window.Razorpay ? Promise.resolve() : new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = RZP; s.onload = ok; s.onerror = () => no({ message: 'Failed to fetch' }); document.head.append(s);
});

export default async function premium(view, ctx) {
  ctx.setTitle(t('prem.title'));
  const cfg = S.cfg.PAYMENTS || {};
  const enabled = !!cfg.enabled;
  const amount = cfg.amountPaise || 9900, days = cfg.days || 30;
  const status = h('div'), historyBox = h('div');

  const benefits = ['prem.b1', 'prem.b2', 'prem.b3'].map(k => h('li', icon('check'), h('span', t(k))));
  const action = h('div', { style: 'margin-top:6px' });
  const card = h('div.card.premium.center', h('h2', icon('crown'), t('prem.title')), h('p.muted', { style: 'margin:4px 0 0' }, t('prem.sub')),
    h('ul', { style: 'text-align:left;max-width:420px;margin:14px auto' }, ...benefits),
    h('div.price', fmtMoney(amount), h('small', ' / ' + (days === 30 ? t('prem.month') : t('prem.days', { n: days })))), action);
  view.append(pageTitle(t('prem.title')), status, card, h('div.notice', { style: 'margin-top:12px' }, icon('info'), h('div', t('prem.note'))), historyBox);

  async function refresh() {
    clear(status); clear(action);
    if (!S.user) { action.append(h('a.btn.gold.block', { href: '/login?next=/premium' }, t('login'))); return; }
    await loadProfile();
    if (S.premium) {
      const sub = await S.sb.from('subscriptions').select('current_period_end').eq('status', 'active').limit(1);
      const end = sub.data?.[0]?.current_period_end;
      status.append(h('div.notice.good', icon('crown'), h('div', h('b', t('prem.active')), end ? h('div', t('prem.until', { date: new Date(end).toLocaleDateString(getLang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) })) : null)));
    }
    if (!enabled) {
      // Honest state: no gateway configured on the server, so there is nothing to pay with.
      action.append(h('div.notice.warn', { style: 'text-align:left' }, icon('clock'), h('div', t('prem.off'))));
      return;
    }
    const btn = h('button.btn.gold.block', { type: 'button' }, icon('crown'), S.premium ? t('prem.extend') : t('prem.buy'));
    btn.onclick = () => pay(btn);
    action.append(btn);
  }

  async function pay(btn) {
    btn.disabled = true;
    try {
      const [order] = await Promise.all([api('/api/payments/create-order'), loadCheckout()]);
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
          name: 'Alfrzo Ilm', description: t('prem.title'), prefill: { email: S.user.email },
          theme: { color: '#0a5c47' },
          handler: async resp => {
            try {
              await api('/api/payments/verify', { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature });
              resolve();
            } catch (e) { reject(e); }
          },
          modal: { ondismiss: () => reject({ cancelled: true }) },
        });
        rz.on('payment.failed', () => reject({ message: t('prem.pay.fail') }));
        rz.open();
      });
      toast(t('prem.pay.ok')); await refresh(); await history();
      S.pollUnread?.();
    } catch (e) {
      if (!e?.cancelled) toast(e?.code === '502' || e?.code === '409' ? t('prem.pay.pending') : errMsg(e), true);
    }
    btn.disabled = false;
  }

  async function history() {
    clear(historyBox);
    if (!S.user) return;
    const r = await S.sb.from('payments').select('id,amount_paise,currency,status,created_at').order('created_at', { ascending: false }).limit(10);
    const rows = (r.data || []).filter(p => p.status !== 'created');
    if (!rows.length) return;
    historyBox.append(h('div.section-h', h('h2', t('prem.history'))), h('div.card', ...rows.map(p => h('div.row', { style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)' },
      h('span', fmtMoney(p.amount_paise, p.currency)), h('span.tag' + (p.status === 'paid' ? '' : p.status === 'failed' ? '.red' : '.warn'), t('prem.st.' + p.status)), h('span.small.muted', timeAgo(p.created_at, getLang()))))));
  }

  await refresh(); await history();
}
