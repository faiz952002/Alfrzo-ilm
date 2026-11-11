import { S } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, clear, debounce } from '../ui.js';
import { questionCard, skeletons, empty, pageTitle, errorBox } from '../components.js';
import { fetchFeed, decorate } from '../data.js';

const HKEY = 'askdeen.recent';
const recent = () => { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { return []; } };
const remember = q => { try { localStorage.setItem(HKEY, JSON.stringify([q, ...recent().filter(x => x !== q)].slice(0, 8))); } catch {} };

export default async function search(view, ctx) {
  ctx.setTitle(t('search'), t('meta.feed'));
  const input = h('input', { type: 'search', value: ctx.query.get('q') || '', placeholder: t('feed.search'), 'aria-label': t('feed.search'), maxlength: 100, autofocus: true });
  const results = h('div');
  const form = h('form.searchbar', { style: 'margin:0 0 14px', onsubmit: e => { e.preventDefault(); run(true); } }, icon('search', 'i'), input, h('button.go', { type: 'submit', 'aria-label': t('search') }, icon('arrowR')));
  view.append(pageTitle(t('search')), form, results);
  const live = debounce(() => run(false), 350);
  input.addEventListener('input', live);

  async function run(save) {
    const q = input.value.trim();
    history.replaceState(null, '', q ? `/search?q=${encodeURIComponent(q)}` : '/search');
    clear(results);
    if (!q) {
      const r = recent();
      if (r.length) results.append(h('div.card', h('b', t('search.recent')), ...r.map(x => h('button.li', { type: 'button', onclick: () => { input.value = x; run(false); } }, icon('clock', 'l'), h('span.grow', x)))));
      else results.append(empty('search', t('search.hint')));
      return;
    }
    if (save) remember(q);
    results.append(...skeletons(2));
    try {
      const r = await fetchFeed({ q, tab: 'popular' });
      if (!ctx.alive() || input.value.trim() !== q) return;
      clear(results);
      if (!r.items.length) { results.append(empty('search', t('search.none'), h('a.btn.sm', { href: '/ask' }, t('home.ask')))); return; }
      const st = await decorate(r.items); if (!ctx.alive()) return;
      results.append(h('p.muted.small', t('search.count', { n: r.total })), ...r.items.map(i => questionCard(i, st)));
    } catch { if (ctx.alive()) { clear(results); results.append(errorBox(() => run(false))); } }
  }
  run(false);
}
