import { S, isAdmin, isScholarRole } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, toast } from '../ui.js';
import { avatar } from '../components.js';

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
  const [k, a, b, c] = await Promise.all([
    S.sb.from('consultations').select('id', { count: 'exact' }).eq('user_id', S.user.id).limit(1),
    S.sb.from('questions').select('id', { count: 'exact' }).eq('user_id', S.user.id).limit(1),
    S.sb.from('saved_answers').select('answer_id', { count: 'exact' }).limit(1),
    S.sb.from('scholar_followers').select('scholar_id', { count: 'exact' }).limit(1),
  ]);
  if (!ctx.alive()) return;
  const stat = (r, key) => h('div', h('b', String(r.count ?? 0)), h('span.small.muted', t(key)));
  const tags = [isAdmin() ? h('span.tag.red', 'Admin') : null, isScholarRole() ? h('span.tag', S.scholar.verified ? t('verified') : t('sch.pending')) : null, S.premium ? h('span.tag.gold', icon('crown', ''), 'Premium') : null].filter(Boolean);
  // Element.append() would print the word "null", so empty slots are filtered out first
  view.append(...[
    h('div.page-title', h('h1', { style: 'text-align:center' }, t('prof.title')), h('a.iconbtn', { href: '/settings', 'aria-label': t('set.title') }, icon('settings'))),
    h('div.me-head', avatar(S.profile.display_name), h('h1', S.profile.display_name), h('div.small.muted', { style: 'word-break:break-all' }, S.user.email),
      tags.length ? h('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center' }, tags) : null),
    h('div.card.stat4', stat(a, 'prof.myq'), stat(k, 'prof.consults'), stat(b, 'prof.saved'), stat(c, 'prof.following')),
    (isScholarRole() || isAdmin()) ? h('div.card.list', isScholarRole() ? row('/dashboard', 'dash', 'dash.title') : null, isAdmin() ? row('/admin', 'shield', 'admin.title') : null) : null,
    h('div.card.list', row('/my-questions', 'qa', 'my.q'), row('/consultations', 'calendar', 'consult.mine'), row('/saved', 'bookmark', 'saved.title'), row('/following', 'scholars', 'following.title'),
      row('/premium', 'crown', 'prof.membership', S.premium ? h('span.tag.gold', 'Premium') : h('span.tag.gold', t('prem.upgrade'))),
      row('/messages', 'chat', 'nav.messages', S.unreadMsgs ? h('span.tag.red', String(S.unreadMsgs)) : null),
      row('/notifications', 'bell', 'nav.notifications', S.unread ? h('span.tag.red', String(S.unread)) : null), row('/settings', 'edit', 'prof.edit')),
    h('div.card.list', !isScholarRole() ? row('/become-scholar', 'book', 'bs.title') : null, row('/privacy', 'shield', 'privacy.title'), langRow()),
    h('button.btn.ghost.block', { type: 'button', style: 'color:var(--danger)', onclick: async () => { await S.sb.auth.signOut(); toast(t('logout.done')); S.go('/', true); } }, icon('logout'), t('logout')),
  ].filter(Boolean));
}
