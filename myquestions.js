import { S, requireAuth, catById, catName } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, clear, timeAgo } from '../ui.js';
import { pageTitle, statusTag, catTag, skeletons, empty, errorBox } from '../components.js';

export default async function myq(view, ctx) {
  ctx.setTitle(t('my.q'));
  if (!requireAuth(ctx)) return;
  let tab = 'all'; const list = h('div'), tabs = h('div.chips');
  view.append(pageTitle(t('my.q'), true, h('a.btn.sm', { href: '/ask' }, icon('plus'), t('nav.ask'))), tabs, list); list.append(...skeletons(3));
  const r = await S.sb.from('questions').select('id,title,status,category_id,created_at,is_anonymous,likes_count').eq('user_id', S.user.id).order('created_at', { ascending: false });
  if (!ctx.alive()) return;
  if (r.error) { clear(list); list.append(errorBox(() => S.go('/my-questions'))); return; }
  const items = r.data;
  const paintTabs = () => { clear(tabs); [['all', 'st.all'], ['pending_review', 'st.pending'], ['open', 'st.open'], ['answered', 'st.answered'], ['rejected', 'st.rejected']].forEach(([k, l]) => tabs.append(h('button.chip', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; paintTabs(); render(); } }, `${t(l)} ${k === 'all' ? items.length : items.filter(i => i.status === k).length}`))); };
  function render() {
    clear(list); const rows = items.filter(i => tab === 'all' || i.status === tab);
    if (!rows.length) { list.append(empty('inbox', t('my.empty'), h('a.btn.sm', { href: '/ask' }, t('home.ask')))); return; }
    rows.forEach(q => list.append(h('a.card.q', { href: `/q/${q.id}` }, h('div.meta', catTag(q.category_id), h('span', timeAgo(q.created_at, getLang())), q.is_anonymous ? h('span', icon('eyeoff', ''), ' ' + t('ask.anon.short')) : null),
      h('h3', { dir: 'auto' }, q.title), h('div.foot', statusTag(q), h('span.small.muted', t('my.status.' + q.status))))));
  }
  paintTabs(); render();
}
