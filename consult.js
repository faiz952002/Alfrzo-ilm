import { S, errMsg } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, toast, clear, busy, fmtMoney, CONTACT_RE } from '../ui.js';
import { pageTitle, skeletons, empty, avatar, verifiedBadge } from '../components.js';
import { api, payOrder } from '../pay.js';

const KIND_ICON = { audio: 'phone', video: 'video', chat: 'chat' };
const loc = () => (getLang() === 'hi' ? 'hi-IN' : 'en-IN');
export const priceText = p => (p > 0 ? fmtMoney(p) : t('consult.free'));
export const whenText = iso => new Date(iso).toLocaleString(loc(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Pay for a pending booking. Used here and on "My bookings".
export async function payForConsultation(id) {
  const order = await api('/api/payments/consultation-order', { consultation_id: id });
  return payOrder(order, t('consult.title'));
}

export default async function consult(view, ctx) {
  const sid = ctx.params.id;
  ctx.setTitle(t('consult.title'));
  view.append(pageTitle(t('consult.title')), ...skeletons(2));
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return S.go('/scholars', true);
  const [s, sv, sl] = await Promise.all([
    S.sb.from('scholar_directory').select('*').eq('id', sid).maybeSingle(),
    S.sb.from('scholar_services').select('*').eq('scholar_id', sid).eq('active', true),
    S.sb.from('scholar_slots').select('id,starts_at').eq('scholar_id', sid).eq('status', 'open').gt('starts_at', new Date().toISOString()).order('starts_at').limit(120),
  ]);
  if (!ctx.alive()) return; clear(view); view.append(pageTitle(t('consult.title')));
  if (!s.data) { view.append(empty('help', t('sch.notfound'), h('a.btn.sm', { href: '/scholars' }, t('nav.scholars')))); return; }
  const sc = s.data;
  view.append(h('div.card.row', avatar(sc.display_name, 'lg'), h('div.grow', h('h2', sc.display_name, ' ', verifiedBadge()), h('div.small.muted', sc.qualifications))));
  const services = ['audio', 'video', 'chat'].map(k => (sv.data || []).find(x => x.kind === k)).filter(Boolean);
  if (!services.length) { view.append(empty('calendar', t('consult.noservices'), h('a.btn.sm', { href: `/scholar/${sid}` }, t('sch.profile')))); return; }
  const slots = sl.data || [];
  const payOn = !!S.cfg.PAYMENTS?.enabled;
  const dayKey = iso => new Date(iso).toLocaleDateString('en-CA');
  const days = [...new Set(slots.map(x => dayKey(x.starts_at)))];
  let kind = (services.find(x => x.price_paise === 0 || payOn) || services[0]).kind, day = days[0] || null, slot = null;

  const svcBox = h('div.svc', { role: 'group', 'aria-label': t('consult.type') }), dayBox = h('div.chips'), timeBox = h('div.slots'), total = h('span'), err = h('div.err', { role: 'alert' }), warn = h('div');
  const topic = h('textarea', { id: 'ct', maxlength: 500, style: 'min-height:70px', dir: 'auto', placeholder: t('consult.topic.ph') });
  const btn = h('button.btn.block', { type: 'button' });
  topic.addEventListener('input', () => { err.textContent = ''; });
  const hint = h('p.small.muted.center');
  const cur = () => services.find(x => x.kind === kind);
  function paint() {
    clear(svcBox); services.forEach(x => svcBox.append(h('button', { type: 'button', 'aria-pressed': String(kind === x.kind), onclick: () => { kind = x.kind; paint(); } },
      icon(KIND_ICON[x.kind]), t('consult.' + x.kind), h('b', priceText(x.price_paise)), h('small', t('consult.min', { n: x.duration_min })))));
    clear(dayBox); days.forEach(d => dayBox.append(h('button.chip', { type: 'button', 'aria-pressed': String(day === d), onclick: () => { day = d; slot = null; paint(); } },
      new Date(d + 'T12:00:00').toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'short' }))));
    clear(timeBox); slots.filter(x => dayKey(x.starts_at) === day).forEach(x => timeBox.append(h('button.chip', { type: 'button', 'aria-pressed': String(slot === x.id), onclick: () => { slot = x.id; paint(); } },
      new Date(x.starts_at).toLocaleTimeString(loc(), { hour: 'numeric', minute: '2-digit' }))));
    const c = cur(), paid = c.price_paise > 0;
    total.textContent = priceText(c.price_paise);
    clear(warn); if (paid && !payOn) warn.append(h('div.notice.warn', icon('clock'), h('div', t('consult.payoff'))));
    clear(btn); btn.append(icon(paid ? 'lock' : 'check'), paid ? t('consult.pay') : t('consult.book'));
    btn.disabled = !slot || (paid && !payOn);
    clear(hint); if (c.kind !== 'chat') hint.append(icon('info', ''), ' ', t('consult.joinhint'));
  }
  btn.onclick = async () => {
    err.textContent = '';
    if (!S.user) return S.go('/login?next=' + encodeURIComponent(location.pathname));
    if (CONTACT_RE.test(topic.value)) { err.textContent = t('err.contact'); return; }
    const paid = cur().price_paise > 0;
    btn.disabled = true;
    const r = await S.sb.rpc('book_consultation', { p_slot: slot, p_kind: kind, p_topic: topic.value.trim() });
    if (r.error) { btn.disabled = false; err.textContent = /SLOT_TAKEN/.test(r.error.message) ? t('consult.noslots') : errMsg(r.error); return; }
    if (!paid) { toast(t('consult.booked')); S.pollUnread?.(); return S.go('/consultations', true); }
    try { await payForConsultation(r.data); toast(t('consult.booked')); }
    catch (e) { if (!e?.cancelled) toast(e?.failed ? t('prem.pay.fail') : t('prem.pay.pending'), true); }
    S.go('/consultations', true);
  };

  if (!slots.length) { view.append(h('div.section-h', h('h2', t('consult.type'))), svcBox, empty('calendar', t('consult.noslots'))); paint(); return; }
  view.append(h('div.section-h', h('h2', t('consult.type'))), svcBox, warn,
    h('div.section-h', h('h2', t('consult.date'))), dayBox,
    h('div.section-h', h('h2', t('consult.time'))), timeBox,
    h('label.f', { for: 'ct' }, t('consult.topic')), topic,
    h('div.total', h('span', t('consult.total')), total), err, btn,
    hint);
  paint();
}
