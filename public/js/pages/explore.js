import { S, catName } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, clear } from '../ui.js';
import { scholarCard, skeletons } from '../components.js';
import { catArt } from '../art.js';

export default async function explore(view, ctx) {
  ctx.setTitle(t('nav.explore'), t('meta.feed'));
  const input = h('input', { type: 'search', id: 'exq', placeholder: t('home.search'), 'aria-label': t('home.search'), enterkeyhint: 'search', maxlength: 100 });
  const form = h('form.searchbar', { role: 'search', style: 'margin:0 0 16px', onsubmit: e => { e.preventDefault(); const q = input.value.trim(); S.go(q ? `/search?q=${encodeURIComponent(q)}` : '/qa'); } },
    icon('search', 'i'), input, h('button.go', { type: 'submit', 'aria-label': t('search') }, icon('arrowR')));
  const popular = h('div.chips', { style: 'flex-wrap:wrap' }), scholars = h('div', skeletons(1));
  view.append(h('div.page-title', h('h1', t('nav.explore'))), form,
    h('div.section-h', h('h2', t('ex.popular')), h('a', { href: '/qa?tab=popular' }, t('viewall'))), popular,
    h('div.section-h', h('h2', t('ex.cats'))),
    h('div.tiles', S.cats.map(c => h('a.tile', { href: `/qa?cat=${c.slug}` }, catArt(c.slug), catName(c)))),
    h('div.section-h', h('h2', t('ex.scholars')), h('a', { href: '/scholars' }, t('viewall'))), scholars,
    h('div', { style: 'margin:14px 0' }, h('a.btn.ghost.block', { href: '/reels' }, icon('video'), t('home.reels'))));

  const [pq, sc, f] = await Promise.all([
    S.sb.from('question_feed').select('id,title,likes_count').order('likes_count', { ascending: false }).order('created_at', { ascending: false }).limit(6),
    S.sb.from('scholar_directory').select('*').order('answers_count', { ascending: false }).limit(3),
    S.user ? S.sb.from('scholar_followers').select('scholar_id') : { data: [] },
  ]);
  if (!ctx.alive()) return;
  (pq.data || []).forEach(q => popular.append(h('a.chip', { href: `/q/${q.id}`, dir: 'auto', style: 'text-decoration:none;max-width:100%;overflow:hidden;text-overflow:ellipsis' }, q.title.length > 34 ? q.title.slice(0, 33) + '…' : q.title)));
  if (!popular.children.length) popular.append(h('span.muted.small', t('home.nopop')));
  clear(scholars);
  const followed = new Set((f.data || []).map(x => x.scholar_id));
  if (!(sc.data || []).length) scholars.append(h('p.muted.small.center', t('scholars.none')));
  else sc.data.forEach(s => scholars.append(scholarCard(s, followed.has(s.id))));
}
