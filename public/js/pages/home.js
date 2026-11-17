import { S } from '../store.js';
import { t } from '../i18n.js';
import '../i18n.ui3.js';
import { h, icon, logo } from '../ui.js';
import { heroScene, cityArt, scholarFigure, bannerSkyline } from '../home-art.js';
import { HOME_IMAGES as IMG } from '../home-images.js';

// Night & gold home: hero, search, quick topics, popular cities, ask a scholar, features, closing banner.
// Every tile links to an existing page; nothing here needs new database tables.
// Images come from home-images.js; where one is missing a coded illustration is drawn instead.
const CITIES = [['bengaluru', 'Bengaluru'], ['hyderabad', 'Hyderabad'], ['pune', 'Pune'], ['mumbai', 'Mumbai']];
const bg = src => `background-image:url("${src}")`;

export default async function home(view, ctx) {
  ctx.setTitle(null, t('meta.home'));
  const photo = (src, cls) => h('img', { src, class: cls, alt: '', decoding: 'async' });

  // ---- hero (menu + bell come from the shell, laid over it)
  const baked = !!(IMG.hero && IMG.heroHasText);          // the photo already shows logo, name and quote
  const hero = h('section.h3-hero' + (baked ? '.photo' : ''),
    IMG.hero ? photo(IMG.hero, 'hero-art') : heroScene(),
    IMG.scholar ? photo(IMG.scholar, 'hero-scholar') : null,
    h('div.h3-brand' + (baked ? '.sr-only' : ''), logo(58), h('h1', 'Alfrzo Ilm'), h('p.h3-tag', h('span', { 'aria-hidden': 'true' }), t('home3.tagline'), h('span', { 'aria-hidden': 'true' }))),
    h('p.h3-quote' + (baked ? '.sr-only' : ''), h('span.l1', t('home3.q1')), h('span.l2', t('home3.q2')), h('span.orn', { 'aria-hidden': 'true' })));

  // ---- search
  const input = h('input', { type: 'search', placeholder: t('home3.search'), 'aria-label': t('home3.search'), maxlength: 100, enterkeyhint: 'search' });
  const search = h('form.h3-search', { role: 'search', onsubmit: e => {
    e.preventDefault(); const q = input.value.trim(); S.go('/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
  } }, icon('search', 'i'), input, h('button.go', { type: 'submit', 'aria-label': t('home3.searchgo') }, icon('arrowRs')));

  // ---- quick topics
  const tile = (href, key, ic, label, tone) => IMG.tiles?.[key]
    ? h('a.h3-tile.img', { href, style: bg(IMG.tiles[key]) }, h('span', t(label)))
    : h(`a.h3-tile.${tone}`, { href }, icon(ic), h('span', t(label)));
  const quick = h('nav.h3-panel.h3-quick', { 'aria-label': t('home.cats') },
    tile('/qa?cat=quran-hadith', 'quran', 'quran', 'tile.quran', 'green'), tile('/qa?cat=quran-hadith', 'hadith', 'dome', 'tile.hadith', 'amber'),
    tile('/categories', 'fiqah', 'scales', 'tile.fiqah', 'violet'), tile('/scholars', 'scholars', 'scholar', 'tile.scholars', 'blue'), tile('/explore', 'more', 'grid', 'tile.more', 'slate'));

  // ---- popular cities (opens a search for the city name)
  const cities = h('section.h3-panel.h3-cities',
    h('div.h3-head', icon('pin', 'pin'), h('h2', t('home3.cities')), h('a', { href: '/search' }, t('home3.viewall'), ' ', icon('arrowRs'))),
    h('div.h3-city-row', CITIES.map(([key, q]) => h('a.h3-city' + (IMG.cities?.[key] ? '.img' : ''), { href: '/search?q=' + encodeURIComponent(q) },
      IMG.cities?.[key] ? photo(IMG.cities[key], 'city-art') : cityArt(key), h('span', t('city.' + key))))));

  // ---- ask a scholar
  const askText = h('span.txt', h('b.ttl', t('home3.askT')), h('span.sub', t('home3.askD')), h('span.h3-pill', t('home3.askB'), ' ', icon('arrowRs')));
  const ask = IMG.askBanner
    ? h('a.h3-ask.img', { href: '/ask', style: bg(IMG.askBanner) }, askText)
    : h('a.h3-ask', { href: '/ask' }, bannerSkyline(), h('span.fig', scholarFigure()), askText);

  // ---- features
  const unread = S.unreadMsgs > 0 ? h('span.badge-dot', S.unreadMsgs > 9 ? '9+' : String(S.unreadMsgs)) : null;
  const feat = (href, key, ic, label, tone, extra) => IMG.feats?.[key]
    ? h('a.h3-feat.img', { href, style: bg(IMG.feats[key]) }, h('span', t(label)), extra)
    : h(`a.h3-feat.${tone}`, { href }, icon(ic), h('span', t(label)), extra);
  const features = h('nav.h3-feats', { 'aria-label': t('menu.open') },
    feat('/messages', 'chat', 'chat', 'feat.chat', 'violet', unread), feat('/reels', 'reels', 'video', 'feat.reels', 'red'), feat('/profile', 'profile', 'user', 'feat.profile', 'blue'),
    feat('/scholars', 'consult', 'headset', 'feat.consult', 'green'), feat('/ask', 'ask', 'help', 'feat.ask', 'amber'));

  // ---- closing banner
  const footText = h('div', h('b', t('home3.foot1'), h('i', { 'aria-hidden': 'true' }, ' • '), t('home3.foot2')), h('span', t('home3.footD')));
  const foot = IMG.footBanner
    ? h('div.h3-foot.img', { style: bg(IMG.footBanner) }, footText)
    : h('div.h3-foot', bannerSkyline(), icon('lotus', 'lotus'), footText);

  view.append(hero, h('div.h3-body', search, quick, cities, ask, features, foot));
}
