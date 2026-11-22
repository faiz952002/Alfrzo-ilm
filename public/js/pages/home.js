import { S, catName } from '../store.js';
import { t } from '../i18n.js';
import '../i18n.ui3.js';
import { h, icon } from '../ui.js';
import { scholarFigure } from '../home-art.js';

// Home (mockup v2: design/home-mockup-v2.png): hero, search, popular categories, our scholars, Quran & Hadith banner.
// Images come from tools/extract_home_v2_images.py. Every tile links to an existing page.
// "Our Scholars" lists the verified scholars from the database (never the people pictured in the mockup).
const IMG = name => `/img/home2/${name}.jpg`;
const CATS = ['aqeedah', 'namaz', 'roza', 'zakat', 'nikah', 'family', 'hajj', 'akhlaq', 'quran-hadith'];

export default async function home(view, ctx) {
  ctx.setTitle(null, t('meta.home'));

  // ---- hero: the picture already shows "Learn Islam / Live Better" and the Explore button
  const hero = h('section.h4-hero', { style: `background-image:url("${IMG('hero')}")` },
    h('div.sr-only', h('h1', 'Alfrzo Ilm'), h('p', t('home3.q1') + ' – ' + t('home3.q2')), h('p', t('home4.k'))),
    h('a.h4-explore', { href: '/explore' }, h('span.sr-only', t('home4.explore'))));

  // ---- search
  const input = h('input', { type: 'search', placeholder: t('home3.search'), 'aria-label': t('home3.search'), maxlength: 100, enterkeyhint: 'search' });
  const search = h('form.h4-search', { role: 'search', onsubmit: e => {
    e.preventDefault(); const q = input.value.trim(); S.go('/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
  } }, icon('search', 'i'), input, h('button.go', { type: 'submit', 'aria-label': t('home3.searchgo') }, icon('arrowRs')));

  const head = (title, href) => h('div.h4-head', h('h2', title), h('a', { href }, t('home3.viewall'), ' ', icon('arrowRs')));

  // ---- popular categories (labels come from the database, so they follow the language)
  const label = slug => slug === 'quran-hadith' ? t('tile.quran') : catName(S.cats.find(c => c.slug === slug)) || slug;
  const tiles = CATS.map(slug => h('a.h4-cat', { href: '/qa?cat=' + slug, style: `background-image:url("${IMG('cat-' + slug.split('-')[0])}")` }, h('span', label(slug))));
  tiles.push(h('a.h4-cat', { href: '/categories', style: `background-image:url("${IMG('cat-more')}")` }, h('span', t('tile.more'))));
  const cats = h('section.h4-sec', head(t('home4.cats'), '/categories'), h('nav.h4-cats', { 'aria-label': t('home4.cats') }, tiles));

  // ---- our scholars (verified scholars from the database)
  const row = h('div.h4-sch-row');
  const scroll = dir => () => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: 'smooth' });
  const scholars = h('section.h4-sec', head(t('home4.scholars'), '/scholars'),
    h('div.h4-sch', h('button.h4-arrow.prev', { type: 'button', 'aria-label': t('home4.prev'), onclick: scroll(-1) }, icon('arrowRs')), row,
      h('button.h4-arrow.next', { type: 'button', 'aria-label': t('home4.next'), onclick: scroll(1) }, icon('arrowRs'))));
  for (let i = 0; i < 4; i++) row.append(h('div.h4-scholar.skel', h('span.fig'), h('b', ' ')));

  // ---- Quran & Hadith banner (text is part of the picture)
  const banner = h('a.h4-banner', { href: '/qa?cat=quran-hadith', style: `background-image:url("${IMG('banner-quran')}")` },
    h('span.sr-only', t('home4.qhT') + ' – ' + t('home4.qhD') + ' – ' + t('home4.qhB')));

  view.append(hero, h('div.h4-body', search, cats, scholars, banner));

  const r = await S.sb.from('scholar_directory').select('id,display_name,qualifications').order('answers_count', { ascending: false }).limit(12);
  if (!ctx.alive()) return;
  row.replaceChildren();
  const list = r.error ? [] : r.data || [];
  list.forEach(s => row.append(h('a.h4-scholar', { href: `/scholar/${s.id}` }, h('span.fig', scholarFigure()), h('b', s.display_name))));
  if (!list.length) row.append(h('a.h4-scholar.empty', { href: S.user ? '/become-scholar' : '/scholars' }, h('span.fig', scholarFigure()), h('b', t('home4.none')), S.user && !S.scholar ? h('small', t('home4.join')) : null));
  scholars.classList.toggle('few', list.length < 4);
}
