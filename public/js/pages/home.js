import { S } from '../store.js';
import { t } from '../i18n.js';
import '../i18n.ui3.js';
import { h, icon, logo } from '../ui.js';
import { heroScene, cityArt, scholarFigure, bannerSkyline } from '../home-art.js';
import { HOME_IMAGES } from '../home-images.js';

// Night & gold home: hero, search, quick topics, popular cities, ask a scholar, features, closing banner.
// Every tile links to an existing page; nothing here needs new database tables.
const CITIES = [['bengaluru', 'Bengaluru'], ['hyderabad', 'Hyderabad'], ['pune', 'Pune'], ['mumbai', 'Mumbai']];

export default async function home(view, ctx) {
  ctx.setTitle(null, t('meta.home'));
  const photo = (src, cls) => h('img', { src, class: cls, alt: '', decoding: 'async' });

  // ---- hero: brand, tagline, quote over the night scene (menu + bell come from the shell, laid over it)
  const hero = h('section.h3-hero',
    HOME_IMAGES.hero ? photo(HOME_IMAGES.hero, 'hero-art') : heroScene(),
    HOME_IMAGES.scholar ? photo(HOME_IMAGES.scholar, 'hero-scholar') : null,
    h('div.h3-brand', logo(58), h('h1', 'Alfrzo Ilm'), h('p.h3-tag', h('span', { 'aria-hidden': 'true' }), t('home3.tagline'), h('span', { 'aria-hidden': 'true' }))),
    h('p.h3-quote', h('span.l1', t('home3.q1')), h('span.l2', t('home3.q2')), h('span.orn', { 'aria-hidden': 'true' })));

  // ---- search
  const input = h('input', { type: 'search', placeholder: t('home3.search'), 'aria-label': t('home3.search'), maxlength: 100, enterkeyhint: 'search' });
  const search = h('form.h3-search', { role: 'search', onsubmit: e => {
    e.preventDefault(); const q = input.value.trim(); S.go('/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
  } }, icon('search', 'i'), input, h('button.go', { type: 'submit', 'aria-label': t('home3.searchgo') }, icon('arrowRs')));

  // ---- quick topics
  const tile = (href, ic, key, tone) => h(`a.h3-tile.${tone}`, { href }, icon(ic), h('span', t(key)));
  const quick = h('nav.h3-panel.h3-quick', { 'aria-label': t('home.cats') },
    tile('/qa?cat=quran-hadith', 'quran', 'tile.quran', 'green'), tile('/qa?cat=quran-hadith', 'dome', 'tile.hadith', 'amber'),
    tile('/categories', 'scales', 'tile.fiqah', 'violet'), tile('/scholars', 'scholar', 'tile.scholars', 'blue'), tile('/explore', 'grid', 'tile.more', 'slate'));

  // ---- popular cities (opens a search for the city name)
  const cities = h('section.h3-panel.h3-cities',
    h('div.h3-head', icon('pin', 'pin'), h('h2', t('home3.cities')), h('a', { href: '/search' }, t('home3.viewall'), ' ', icon('arrowRs'))),
    h('div.h3-city-row', CITIES.map(([key, q]) => h('a.h3-city', { href: '/search?q=' + encodeURIComponent(q) },
      HOME_IMAGES.cities[key] ? photo(HOME_IMAGES.cities[key], 'city-art') : cityArt(key), h('span', t('city.' + key))))));

  // ---- ask a scholar
  const ask = h('a.h3-ask', { href: '/ask' }, bannerSkyline(), h('span.fig', scholarFigure()),
    h('span.txt', h('b.ttl', t('home3.askT')), h('span.sub', t('home3.askD')), h('span.h3-pill', t('home3.askB'), ' ', icon('arrowRs'))));

  // ---- features
  const unread = S.unreadMsgs > 0 ? h('span.badge-dot', S.unreadMsgs > 9 ? '9+' : String(S.unreadMsgs)) : null;
  const feat = (href, ic, key, tone, extra) => h(`a.h3-feat.${tone}`, { href }, icon(ic), h('span', t(key)), extra);
  const features = h('nav.h3-feats', { 'aria-label': t('menu.open') },
    feat('/messages', 'chat', 'feat.chat', 'violet', unread), feat('/reels', 'video', 'feat.reels', 'red'), feat('/profile', 'user', 'feat.profile', 'blue'),
    feat('/scholars', 'headset', 'feat.consult', 'green'), feat('/ask', 'help', 'feat.ask', 'amber'));

  // ---- closing banner
  const foot = h('div.h3-foot', bannerSkyline(), icon('lotus', 'lotus'),
    h('div', h('b', t('home3.foot1'), h('i', { 'aria-hidden': 'true' }, ' • '), t('home3.foot2')), h('span', t('home3.footD'))));

  view.append(hero, h('div.h3-body', search, quick, cities, ask, features, foot));
}
