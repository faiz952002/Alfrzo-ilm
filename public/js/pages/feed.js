import { S, catName, catById } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, clear, timeAgo } from '../ui.js';
import { skeletons, empty, errorBox, pageTitle } from '../components.js';
import { fetchFeed, PAGE } from '../data.js';

const TABS = [['latest', 'tab.latest'], ['popular', 'tab.popular'], ['unanswered', 'tab.unanswered'], ['following', 'tab.following']];

// One line of the "All questions" list.
export function questionRow(q) {
  const c = catById(q.category_id);
  return h('a.qrow', { href: `/q/${q.id}` }, h('span.qic.c' + ((q.category_id || 0) % 5), { 'aria-hidden': 'true' }, 'Q'),
    h('div.grow', h('h3', { dir: 'auto' }, q.title),
      h('div.m', [`${q.answers_count} ${t('answers')}`, c ? catName(c) : null, timeAgo(q.created_at, getLang())].filter(Boolean).join(' · '))),
    h('span.lk', icon('heart'), String(q.likes_count)));
}

export default async function feed(view, ctx) {
  const want = ctx.query.get('tab') || (ctx.query.get('status') === 'open' ? 'unanswered' : 'latest');
  let tab = TABS.some(x => x[0] === want) ? want : 'latest', cat = ctx.query.get('cat'), offset = 0;
  const cobj = S.cats.find(c => c.slug === cat);
  ctx.setTitle(cobj ? catName(cobj) : t('feed.all'), t('meta.feed'));
  const list = h('div'), more = h('div.center', { style: 'margin:12px 0 16px' });
  let rows = null;
  const tabs = h('div.chips', { role: 'tablist', 'aria-label': t('filter') });
  const paintTabs = () => { clear(tabs); TABS.forEach(([k, lk]) => tabs.append(h('button.chip', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), 'aria-pressed': String(tab === k), onclick: () => {
    if (k === 'following' && !S.user) { S.go('/login?next=' + encodeURIComponent('/qa?tab=following')); return; }
    tab = k; paintTabs(); load(true);
  } }, t(lk)))); };
  const cats = h('div.chips', { role: 'group', 'aria-label': t('cat.title') });
  const paintCats = () => {
    clear(cats);
    cats.append(h('button.chip', { type: 'button', 'aria-pressed': String(!cat), onclick: () => { cat = null; paintCats(); load(true); } }, t('cat.all')));
    S.cats.forEach(c => cats.append(h('button.chip', { type: 'button', 'aria-pressed': String(cat === c.slug), onclick: () => { cat = c.slug; paintCats(); load(true); } }, catName(c))));
  };
  view.append(pageTitle(cobj ? catName(cobj) : t('feed.all'), true, h('a.iconbtn', { href: '/explore', 'aria-label': t('search') }, icon('search'))), tabs, cats, list, more);
  paintTabs(); paintCats();

  async function load(reset) {
    if (reset) { offset = 0; rows = null; clear(list); clear(more); list.append(...skeletons(3)); }
    try {
      const r = await fetchFeed({ tab: tab === 'unanswered' ? 'latest' : tab, status: tab === 'unanswered' ? 'open' : '', cat: cat ? S.cats.find(c => c.slug === cat)?.id : null, offset });
      if (!ctx.alive()) return;
      if (reset) clear(list);
      clear(more);
      if (!r.items.length && reset) {
        list.append(r.noFollows ? empty('scholars', t('feed.nofollow'), h('a.btn.sm', { href: '/scholars' }, t('nav.scholars'))) : empty('inbox', t('feed.empty'), h('a.btn.sm', { href: '/ask' }, t('home.ask'))));
        return;
      }
      if (!rows) { rows = h('div.qrows'); list.append(rows); }
      r.items.forEach(i => rows.append(questionRow(i)));
      offset += r.items.length;
      if (offset < r.total && r.items.length === PAGE) more.append(h('button.btn.ghost', { type: 'button', onclick: e => { e.target.disabled = true; load(false); } }, t('loadmore')));
    } catch (e) { if (ctx.alive()) { clear(list); list.append(errorBox(() => load(true))); } }
  }
  load(true);
}
