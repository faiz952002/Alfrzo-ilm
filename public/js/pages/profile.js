import { S, isAdmin, isScholarRole } from '../store.js';
import { t, getLang } from '../i18n.js';
import '../i18n.pages.js';
import { h, icon, toast, timeAgo } from '../ui.js';
import { errorBox } from '../components.js';
import { avatarEl, photosSupported } from '../avatar.js';

export const emailConfirmed = () => !!(S.user?.email_confirmed_at || S.user?.confirmed_at);

export default async function profile(view, ctx) {
  ctx.setTitle(t('nav.profile'));
  const row = (href, ic, key, right) => h('a.li', { href }, icon(ic, 'l'), h('span.grow', t(key)), right || null, icon('chev', 'chev'));
  const langRow = () => h('button.li', { type: 'button', onclick: () => S.switchLang() }, icon('globe', 'l'), h('span.grow', t('lang.title')), h('span.muted.small', t('lang.cur')));
  if (!S.user) {
    view.append(h('div.card.center', { style: 'padding:28px 18px' }, h('div', { style: 'color:var(--em-600)' }, icon('user')), h('h2', t('prof.guest')), h('p.muted', t('prof.guest.d')),
      h('div.stack', h('a.btn.block', { href: '/login' }, t('login')), h('a.btn.ghost.block', { href: '/signup' }, t('signup')))),
      h('div.card.list', row('/premium', 'crown', 'prem.title'), row('/privacy', 'shield', 'privacy.title'), langRow()));
    return;
  }
  if (!S.profile) { view.append(errorBox(() => S.go('/profile', true))); return; }

  // header first (from the already loaded profile), statistics fill in below while they load
  const p = S.profile, me = S.user.id;
  const tags = [isAdmin() ? h('span.tag.red', 'Admin') : null, isScholarRole() ? h('span.tag', S.scholar.verified ? t('verified') : t('sch.pending')) : null, S.premium ? h('span.tag.gold', icon('crown', ''), 'Premium') : null].filter(Boolean);
  const verified = emailConfirmed();
  const head = h('div.me-head', avatarEl(p), h('h1', { dir: 'auto' }, p.display_name), h('div.small.muted', { style: 'word-break:break-all' }, S.user.email),
    h('div.me-tags', h('span.tag' + (verified ? '' : '.warn'), icon(verified ? 'check' : 'alert', ''), t(verified ? 'email.ok' : 'email.no')), ...tags),
    h('a.btn.ghost.sm', { href: '/settings', style: 'margin-top:12px' }, icon('edit'), t('prof.edit')));
  const statsBox = h('div.card.stat-grid', { 'aria-busy': 'true' }, Array.from({ length: 6 }, () => h('div.skeleton.stat-sk')));
  const extra = h('div.stack');
  view.append(h('div.page-title', h('h1', { style: 'text-align:center;width:100%' }, t('prof.title'))), head, statsBox, extra);

  const [qs, cs, sv, fo] = await Promise.all([
    S.sb.from('questions').select('id,title,status,created_at', { count: 'exact' }).eq('user_id', me).order('created_at', { ascending: false }).limit(500),
    S.sb.from('consultations').select('id,kind,starts_at,status,created_at', { count: 'exact' }).eq('user_id', me).order('created_at', { ascending: false }).limit(3),
    S.sb.from('saved_answers').select('answer_id', { count: 'exact' }).eq('user_id', me).limit(1),
    S.sb.from('scholar_followers').select('scholar_id', { count: 'exact' }).eq('user_id', me).limit(1),
  ]).catch(() => []);
  if (!ctx.alive()) return;
  statsBox.removeAttribute('aria-busy');
  if (!qs || [qs, cs, sv, fo].some(r => r.error)) { statsBox.replaceWith(errorBox(() => S.go('/profile', true))); }
  else {
    const qrows = qs.data || [];
    const answered = qrows.filter(q => q.status === 'answered').length, waiting = qrows.filter(q => q.status === 'open' || q.status === 'pending_review').length;
    const stat = (n, key, href) => h('a.stat', { href }, h('b', String(n ?? 0)), h('span.small.muted', t(key)));
    statsBox.replaceChildren(stat(qs.count ?? qrows.length, 'prof.myq', '/my-questions'), stat(answered, 'prof.answered', '/my-questions'), stat(waiting, 'prof.unanswered', '/my-questions'),
      stat(cs.count, 'prof.consults', '/consultations'), stat(sv.count, 'prof.saved', '/saved'), stat(fo.count, 'prof.following', '/following'));

    // profile completion: only real, checkable facts
    const steps = [
      { ok: !!p.display_name && p.display_name.trim() !== 'User', key: 'prof.c.name' },
      ...(photosSupported() ? [{ ok: !!p.avatar_path, key: 'prof.c.photo' }] : []),
      { ok: verified, key: 'prof.c.email' },
    ];
    const done = steps.filter(s => s.ok).length, pct = Math.round(done / steps.length * 100);
    extra.append(h('div.card.complete',
      h('div.row', { style: 'justify-content:space-between' }, h('b', t('prof.complete')), h('b.gold', pct + '%')),
      h('div.bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': t('prof.complete') }, h('i', { style: `width:${pct}%` })),
      done === steps.length ? h('p.small.muted', { style: 'margin:8px 0 0' }, t('prof.done'))
        : h('div.todo', steps.filter(s => !s.ok).map(s => h('a.small', { href: '/settings' }, icon('plus', ''), t(s.key))))));

    // recent activity from the person's own records
    const acts = [
      ...qrows.slice(0, 5).map(q => ({ at: q.created_at, href: `/q/${q.id}`, ic: 'qa', label: t('prof.act.q'), text: q.title, st: q.status })),
      ...(cs.data || []).map(c => ({ at: c.created_at, href: '/consultations', ic: 'calendar', label: t('prof.act.c'), text: new Date(c.starts_at).toLocaleString(getLang() === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }), st: c.status })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
    extra.append(h('div.card.list.activity', h('b.recent-h', t('prof.activity')),
      acts.length ? acts.map(a => h('a.li', { href: a.href }, icon(a.ic, 'l'), h('span.grow', h('span.small.muted', a.label + ' · ' + timeAgo(a.at, getLang())), h('span.one', { dir: 'auto' }, a.text)), icon('chev', 'chev')))
        : h('p.small.muted', { style: 'margin:6px 0 2px' }, t('prof.act.none'))));
  }

  extra.append(...[
    (isScholarRole() || isAdmin()) ? h('div.card.list', isScholarRole() ? row('/dashboard', 'dash', 'dash.title') : null, isAdmin() ? row('/admin', 'shield', 'admin.title') : null) : null,
    h('div.card.list',
      row('/premium', 'crown', 'prof.membership', h('span.tag.gold', S.premium ? 'Premium' : t('prem.upgrade'))),
      row('/messages', 'chat', 'nav.messages', S.unreadMsgs ? h('span.tag.red', String(S.unreadMsgs)) : null),
      row('/notifications', 'bell', 'nav.notifications', S.unread ? h('span.tag.red', String(S.unread)) : null)),
    h('div.card.list', !isScholarRole() ? row('/become-scholar', 'book', 'bs.title') : null, row('/privacy', 'shield', 'privacy.title'), langRow()),
    h('button.btn.ghost.block', { type: 'button', style: 'color:var(--danger)', onclick: async () => { await S.sb.auth.signOut(); toast(t('logout.done')); S.go('/', true); } }, icon('logout'), t('logout')),
  ].filter(Boolean));
}
