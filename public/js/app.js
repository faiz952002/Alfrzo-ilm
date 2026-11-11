import { S, isConfigured, initClient, loadProfile, loadCategories, isAdmin, isScholarRole } from './store.js';
import { t, getLang, setLang, initLang } from './i18n.js';
import './i18n.v2.js';
import { h, icon, logo, clear, toast } from './ui.js';

const routes = [
  ['/', 'home'], ['/explore', 'explore'], ['/qa', 'feed'], ['/ask', 'ask'], ['/q/:id', 'detail'], ['/scholars', 'scholars'], ['/scholar/:id', 'scholar'],
  ['/categories', 'categories'], ['/search', 'search'], ['/profile', 'profile'], ['/my-questions', 'myquestions'], ['/saved', 'saved'],
  ['/following', 'following'], ['/settings', 'settings'], ['/notifications', 'notifications'], ['/login', 'auth'], ['/signup', 'auth'],
  ['/forgot', 'auth'], ['/reset', 'auth'], ['/dashboard', 'dashboard'], ['/become-scholar', 'becomescholar'], ['/admin', 'admin'],
  ['/premium', 'premium'], ['/privacy', 'privacy'],
  ['/reels', 'reels'], ['/consult/:id', 'consult'], ['/consultations', 'consultations'], ['/messages', 'messages'], ['/messages/:id', 'messages'],
].map(([p, m]) => ({ re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '/?$'), mod: m, path: p }));

let token = 0, cleanups = [], view, topbarEl, navEl, bellEl, msgEl;

function setMeta(title, desc, canonical) {
  const full = title ? `${title} · Alfrzo Ilm` : 'Alfrzo Ilm – ' + t('tagline');
  document.title = full;
  const set = (sel, attr, val) => { const el = document.querySelector(sel); if (el && val) el.setAttribute(attr, val); };
  if (desc) { set('meta[name=description]', 'content', desc); set('meta[property="og:description"]', 'content', desc); }
  set('meta[property="og:title"]', 'content', full);
  set('link[rel=canonical]', 'href', canonical || location.origin + location.pathname);
}

export function navigate(path, replace = false) {
  if (path === location.pathname + location.search && !replace) { render(); return; }
  history[replace ? 'replaceState' : 'pushState'](null, '', path); render();
}
S.go = navigate;

async function render() {
  const my = ++token;
  cleanups.forEach(f => { try { f(); } catch {} }); cleanups = [];
  closeDrawer();
  const url = new URL(location.href);
  const route = routes.find(r => r.re.test(url.pathname));
  const params = route ? url.pathname.match(route.re).groups || {} : {};
  clear(view); view.className = 'fade-in'; window.scrollTo(0, 0);
  paintNav(url.pathname);
  if (!isConfigured()) return renderSetup();
  if (offline) return renderOffline();
  const ctx = {
    params, query: url.searchParams, path: url.pathname, alive: () => my === token,
    cleanup: fn => cleanups.push(fn), setTitle: (a, b, c) => setMeta(a, b, c),
  };
  setMeta(null);
  try {
    const mod = await import(`./pages/${route ? route.mod : 'notfound'}.js`);
    if (my !== token) return;
    await mod.default(view, ctx);
  } catch (e) {
    console.error(e);
    if (my === token) { clear(view).append(h('div.empty', icon('alert'), h('p', t('err.generic')), h('button.btn.ghost.sm', { onclick: () => render() }, t('retry')))); }
  }
}

// The database could not be reached while starting (no internet, wrong SUPABASE_URL, paused Supabase project).
// Show a clear message with a retry button instead of an empty page.
function renderOffline() {
  setMeta(null);
  const btn = h('button.btn.ghost.sm', { type: 'button', onclick: async () => {
    btn.disabled = true;
    if (await connect()) { pollUnread(); }
    btn.disabled = false; render();
  } }, t('retry'));
  view.append(h('div.empty', { role: 'alert' }, icon('alert'), h('p', t('err.network')), btn));
}

function renderSetup() {
  setMeta('Setup');
  view.append(h('div.cfgwarn', h('div.logo-lg', logo(70)), h('h1', 'Alfrzo Ilm setup needed'),
    h('p', 'Supabase is not configured yet, so there is no data to show (the app never fakes data).'),
    h('p', 'Set ', h('code', 'SUPABASE_URL'), ' and ', h('code', 'SUPABASE_ANON_KEY'), ' as environment variables (server) or edit ', h('code', 'public/js/config.js'), '. See README.md.')));
}

// ---------------- bottom navigation ----------------
const NAV = [['/', 'home', 'nav.home'], ['/explore', 'search', 'nav.explore'], ['/ask', 'plus', 'nav.ask'], ['/messages', 'chat', 'nav.messages'], ['/profile', 'user', 'nav.profile']];
function activeFor(p) {
  if (p === '/') return '/';
  if (p === '/ask') return '/ask';
  if (p.startsWith('/messages')) return '/messages';
  if (/^\/(explore|search|categories|qa|q\/|scholars|scholar\/|reels|consult\/)/.test(p)) return '/explore';
  return '/profile';
}
function paintNav(path) {
  const a = activeFor(path);
  navEl.querySelectorAll('a').forEach(el => el.getAttribute('href') === a ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'));
}

// ---------------- side drawer ----------------
let drawerEl = null, drawerPrev = null;
function closeDrawer() { if (!drawerEl) return; drawerEl.remove(); drawerEl = null; document.removeEventListener('keydown', drawerKey); drawerPrev?.focus?.(); }
const drawerKey = e => { if (e.key === 'Escape') closeDrawer(); };
function openDrawer() {
  if (drawerEl) return;
  drawerPrev = document.activeElement;
  const link = (href, ic, label) => h('a', { href }, icon(ic), label);
  const panel = h('nav.drawer', { 'aria-label': t('menu.open') },
    h('div.dhead', logo(40), h('b', 'Alfrzo Ilm'), h('div.spacer', { style: 'flex:1' }), h('button.iconbtn', { type: 'button', 'aria-label': t('cancel'), onclick: closeDrawer }, icon('x'))),
    link('/', 'home', t('nav.home')), link('/ask', 'plus', t('home.ask')), link('/qa', 'qa', t('menu.browse')), link('/reels', 'video', t('menu.reels')),
    link('/scholars', 'scholars', t('menu.book')), S.user ? link('/consultations', 'calendar', t('menu.consults')) : null,
    isScholarRole() ? link('/dashboard', 'dash', t('dash.title')) : null, isAdmin() ? link('/admin', 'shield', t('admin.title')) : null,
    h('hr'), link('/premium', 'crown', t('menu.plans')), link('/privacy', 'info', t('menu.about')),
    h('button.dl', { type: 'button', onclick: () => switchLang() }, icon('globe'), t('lang.title'), h('span.muted.small', { style: 'margin-left:auto' }, t('lang.cur'))),
    S.user ? link('/settings', 'settings', t('set.title')) : null,
    h('hr'),
    S.user ? h('button.dl.danger', { type: 'button', onclick: async () => { closeDrawer(); await S.sb.auth.signOut(); toast(t('logout.done')); navigate('/', true); } }, icon('logout'), t('logout'))
      : link('/login', 'user', t('login')));
  drawerEl = h('div.drawer-ov', { onclick: e => { if (e.target === drawerEl) closeDrawer(); } }, panel);
  document.body.append(drawerEl); document.addEventListener('keydown', drawerKey);
  panel.querySelector('button')?.focus();
}

function buildShell(root) {
  clear(root);
  bellEl = h('a.iconbtn', { href: '/notifications', 'aria-label': t('nav.notifications') }, icon('bell'));
  topbarEl = h('header.topbar', h('a.brand', { href: '/' }, logo(36), h('span', 'Alfrzo Ilm', h('small', t('tagline')))), h('div.spacer'), bellEl,
    h('button.iconbtn', { type: 'button', 'aria-label': t('menu.open'), onclick: openDrawer }, icon('menu')));
  navEl = h('nav.bottomnav', { 'aria-label': 'Main' }, NAV.map(([href, ic, key]) =>
    href === '/ask'
      ? h('a.ask', { href }, h('span.fab', icon(ic)), h('em', t(key)))
      : h('a', { href, style: 'position:relative' }, icon(ic), h('span', t(key)))));
  msgEl = navEl.querySelector('a[href="/messages"]');
  view = h('main#view', { tabindex: '-1' });
  root.append(h('a.skip', { href: '#view' }, t('skip')), h('div.app', topbarEl, view, h('div.footwrap')), navEl, h('div#toasts.toasts', { 'aria-live': 'polite' }));
  addEventListener('scroll', () => topbarEl.classList.toggle('scrolled', scrollY > 6), { passive: true });
}
S.refreshShell = () => {
  if (!bellEl) return;
  bellEl.querySelector('.badge-dot')?.remove();
  if (S.unread > 0) bellEl.append(h('span.badge-dot', S.unread > 9 ? '9+' : String(S.unread)));
  msgEl?.querySelector('.badge-dot')?.remove();
  if (S.unreadMsgs > 0) msgEl?.append(h('span.badge-dot', { style: 'top:4px;right:22%' }, S.unreadMsgs > 9 ? '9+' : String(S.unreadMsgs)));
};
async function pollUnread() {
  if (!S.user) { S.unread = 0; S.unreadMsgs = 0; S.refreshShell(); return; }
  let r, m;
  try {
    [r, m] = await Promise.all([
      S.sb.from('notifications').select('id', { count: 'exact' }).eq('read', false).limit(1),
      S.sb.from('conversation_list').select('unread').gt('unread', 0),
    ]);
  } catch { return; }   // offline: keep the last badge counts, try again on the next poll
  if (!r.error) S.unread = r.count || 0;
  if (!m.error) S.unreadMsgs = (m.data || []).reduce((n, x) => n + x.unread, 0);
  S.refreshShell();
}
S.pollUnread = pollUnread;

async function switchLang() {
  setLang(getLang() === 'hi' ? 'en' : 'hi');
  if (S.user && S.profile) S.sb.from('profiles').update({ language: getLang() }).eq('id', S.user.id).then(() => {});
  closeDrawer(); buildShell(document.getElementById('root')); S.refreshShell(); render();
}
S.switchLang = switchLang;

document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href]');
  if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (href.startsWith('/') && !href.startsWith('//')) { e.preventDefault(); navigate(href); }
});
addEventListener('popstate', render);

// Load the signed-in profile and the categories. Returns false (and remembers it) when the database is unreachable.
let offline = false;
async function connect() {
  try { await Promise.all([loadProfile(), loadCategories()]); offline = false; }
  catch (e) { console.error('Could not reach the database:', e?.message || e); offline = true; }
  return !offline;
}

async function boot() {
  initLang();
  const root = document.getElementById('root');
  buildShell(root);
  if (isConfigured()) {
    initClient();
    const r = await S.sb.auth.consumeUrlSession().catch(() => null);
    if (r?.error) toast(r.error.message, true);
    await S.sb.auth.restore().catch(() => {});
    await connect();
    let savedLang = null; try { savedLang = localStorage.getItem('askdeen.lang'); } catch { /* storage blocked */ }
    if (S.profile?.language && !savedLang) { setLang(S.profile.language); buildShell(root); }
    S.sb.auth.onChange(async ev => {
      try { await loadProfile(); } catch { /* offline: keep the current state */ }
      pollUnread();
      if (ev === 'SIGNED_OUT') { S.unread = 0; S.unreadMsgs = 0; S.refreshShell(); if (/^\/(profile|my-|saved|following|settings|notifications|dashboard|admin|ask|messages|consult)/.test(location.pathname)) navigate('/login', true); }
    });
    if (r?.type === 'recovery') history.replaceState(null, '', '/reset');
    setInterval(pollUnread, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollUnread(); });
    pollUnread();
  }
  // legacy "#/q/<id>" links created by database notifications
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
}
boot();
