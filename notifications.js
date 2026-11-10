import { S, requireAuth } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, clear, timeAgo, toast } from '../ui.js';
import { pageTitle, skeletons, empty, errorBox } from '../components.js';

const ICON = { answer: 'check', followed: 'scholars', status: 'info', system: 'bell', message: 'chat', consult: 'calendar' };
function text(n) {
  const d = n.data || {};
  if (n.type === 'answer') return t('n.answer', { scholar: d.scholar || '' });
  if (n.type === 'followed') return t('n.followed', { scholar: d.scholar || '' });
  if (n.type === 'message') return t('n.message');
  if (n.type === 'consult') return t('n.consult.' + (['confirmed', 'booked', 'cancelled'].includes(d.msg) ? d.msg : 'confirmed'));
  if (n.type === 'status') return t('n.status.' + (d.status || 'open'));
  if (d.msg === 'premium_granted') return t('n.premium');
  if (d.msg === 'premium_activated') return t('n.premium.on');
  if (d.msg === 'scholar_approved') return t('n.scholar.ok');
  if (d.msg === 'scholar_rejected') return t('n.scholar.no');
  return t('n.system');
}
export default async function notifications(view, ctx) {
  ctx.setTitle(t('nav.notifications'));
  if (!requireAuth(ctx)) return;
  const list = h('div'); const mark = h('button.btn.ghost.sm', { type: 'button' }, t('n.markall'));
  view.append(pageTitle(t('nav.notifications'), true, mark), h('div.small.muted', { style: 'margin:-6px 0 10px' }, t('n.note'), ' ', h('a', { href: '/settings' }, t('set.title'))), list); list.append(...skeletons(3));
  const r = await S.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
  if (!ctx.alive()) return; clear(list);
  if (r.error) { list.append(errorBox(() => S.go('/notifications'))); return; }
  if (!r.data.length) { list.append(empty('bell', t('n.empty'))); mark.remove(); return; }
  r.data.forEach(n => {
    const link = (n.link || '').replace(/^#/, '') || '/notifications';
    const el = h('a.card.notif' + (n.read ? '' : '.unread'), { href: link.startsWith('/') ? link : '/notifications', onclick: () => { if (!n.read) S.sb.from('notifications').update({ read: true }).eq('id', n.id).then(() => S.pollUnread()); } },
      h('span.ic', icon(ICON[n.type] || 'bell')), h('div.grow', h('div', { style: n.read ? '' : 'font-weight:700' }, text(n)), h('div.small.muted', timeAgo(n.created_at, getLang()))));
    list.append(el);
  });
  mark.onclick = async () => { const x = await S.sb.from('notifications').update({ read: true }).eq('read', false); if (x.error) return toast(t('err.generic'), true); list.querySelectorAll('.unread').forEach(e => { e.classList.remove('unread'); }); S.unread = 0; S.refreshShell(); toast(t('n.allread')); };
}
