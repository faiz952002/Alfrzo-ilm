import { S, errMsg, requireAuth } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, toast, clear, confirmBox, busy } from '../ui.js';
import { pageTitle, skeletons, empty, errorBox } from '../components.js';
import { priceText, whenText, payForConsultation } from './consult.js';

const KIND_ICON = { audio: 'phone', video: 'video', chat: 'chat' };
const ST_CLS = { pending_payment: '.warn', confirmed: '', completed: '.blue', cancelled: '.red' };

// One booking, from the client's or the scholar's side. `reload` re-renders the list after an action.
export function consultCard(k, reload) {
  const mine = k.i_am_client;
  const who = mine ? k.scholar_name : (k.client_name || t('consult.anon'));
  const start = new Date(k.starts_at).getTime(), now = Date.now(), end = start + k.duration_min * 60000;
  const actions = h('div.row', { style: 'flex-wrap:wrap;margin-top:10px' });
  const call = async (btn, fn, args, ok) => { busy(btn, true); const r = await S.sb.rpc(fn, args); busy(btn, false); if (r.error) return toast(errMsg(r.error), true); toast(ok); S.pollUnread?.(); reload(); };

  if (k.status === 'pending_payment' && mine) {
    if (S.cfg.PAYMENTS?.enabled) actions.append(h('button.btn.sm', { type: 'button', onclick: async e => {
      e.target.disabled = true;
      try { await payForConsultation(k.id); toast(t('consult.booked')); } catch (x) { if (!x?.cancelled) toast(x?.failed ? t('prem.pay.fail') : t('prem.pay.pending'), true); }
      reload();
    } }, t('consult.pay')));
  }
  if (k.status === 'confirmed') {
    if (k.conversation_id) actions.append(h('a.btn.sm' + (k.kind === 'chat' ? '' : '.ghost'), { href: `/messages/${k.conversation_id}` }, icon('chat'), t('consult.chatopen')));
    if (k.kind !== 'chat' && k.meeting_room && now >= start - 10 * 60000 && now <= end + 30 * 60000)
      actions.append(h('a.btn.sm', { href: (S.cfg.MEETING_BASE || 'https://meet.jit.si/') + 'alfrzo-ilm-' + k.meeting_room, target: '_blank', rel: 'noopener noreferrer' }, icon(KIND_ICON[k.kind]), t('consult.join')));
    if (!mine && now >= start) actions.append(h('button.btn.ghost.sm', { type: 'button', onclick: e => call(e.target, 'complete_consultation', { p_id: k.id }, t('dash.completed')) }, t('dash.complete')));
  }
  if (k.status === 'pending_payment' || k.status === 'confirmed') actions.append(h('button.btn.ghost.sm', { type: 'button', onclick: async e => {
    if (!(await confirmBox(t('consult.cancel'), t('consult.cancel.d'), t('consult.cancel'), t('cancel'), true))) return;
    call(e.target, 'cancel_consultation', { p_id: k.id }, t('consult.cancelled'));
  } }, t('consult.cancel')));

  return h('div.card', h('div.row', { style: 'flex-wrap:wrap' }, h('span.tag', icon(KIND_ICON[k.kind], ''), t('consult.' + k.kind)), h('span.tag' + ST_CLS[k.status], t('consult.st.' + k.status)),
      k.refund_due ? h('span.tag.gold', t('consult.refund')) : null),
    h('h3', { style: 'margin:8px 0 2px' }, who), h('div.small.muted', `${whenText(k.starts_at)} · ${t('consult.min', { n: k.duration_min })} · ${priceText(k.price_paise)}`),
    k.topic ? h('p.small', { dir: 'auto', style: 'margin:6px 0 0' }, k.topic) : null,
    k.status === 'pending_payment' && mine ? h('div.small.muted', { style: 'margin-top:6px' }, t(S.cfg.PAYMENTS?.enabled ? 'consult.holdnote' : 'consult.payoff')) : null,
    k.status === 'confirmed' && k.kind !== 'chat' && now < start - 10 * 60000 ? h('div.small.muted', { style: 'margin-top:6px' }, t('consult.joinhint')) : null,
    k.status === 'confirmed' && k.kind !== 'chat' && !mine ? h('div.small.muted', { style: 'margin-top:6px' }, t('consult.hosthint')) : null,
    actions.children.length ? actions : null);
}

export default async function consultations(view, ctx) {
  ctx.setTitle(t('consult.mine'));
  if (!requireAuth(ctx)) return;
  const list = h('div'); view.append(pageTitle(t('consult.mine'), true, h('a.btn.sm', { href: '/scholars' }, icon('plus'), t('consult.title'))), list);
  async function load() {
    clear(list); list.append(...skeletons(2));
    const r = await S.sb.from('consultation_list').select('*').eq('i_am_client', true).order('starts_at', { ascending: false }).limit(50);
    if (!ctx.alive()) return; clear(list);
    if (r.error) return list.append(errorBox(load));
    if (!r.data.length) return list.append(empty('calendar', t('consult.empty'), h('a.btn.sm', { href: '/scholars' }, t('consult.find'))));
    r.data.forEach(k => list.append(consultCard(k, load)));
  }
  load();
}
