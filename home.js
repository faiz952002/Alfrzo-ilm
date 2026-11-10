import { S, catName } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, clear, timeAgo } from '../ui.js';
import { catArt, duskScene } from '../art.js';
import { questionCard, skeletons, empty, errorBox, avatar, verifiedBadge } from '../components.js';
import { fetchFeed, decorate, scholarMap } from '../data.js';

// Home: category shortcuts, "Aaj ka Sawal" (most liked answered question), then a feed of scholars' answers.
export default async function home(view, ctx) {
  ctx.setTitle(null, t('meta.home'));
  let tab = 'all';
  const story = (href, slug, label) => h('a.story', { href, role: 'listitem' }, h('span.ring', catArt(slug)), h('span.lbl', label));
  const stories = h('div.stories', { role: 'list' }, story('/qa', 'foryou', t('home.foryou')), S.cats.map(c => story(`/qa?cat=${c.slug}`, c.slug, catName(c))));
  const today = h('div'), list = h('div'), tabs = h('div.utabs', { role: 'tablist' });
  const TABS = [['all', 'tab.all'], ['following', 'tab.following'], ['popular', 'tab.popular'], ['recent', 'tab.recent']];
  const paintTabs = () => { clear(tabs); TABS.forEach(([k, lk]) => tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => {
    if (k === 'following' && !S.user) return S.go('/login?next=/');
    tab = k; paintTabs(); load();
  } }, t(lk)))); };

  view.append(stories, tabs, today, list,
    h('p.center.small', { style: 'margin-top:14px' }, h('a', { href: '/privacy' }, t('privacy.link'))));
  paintTabs();

  // ---- Aaj ka Sawal ----
  S.sb.from('question_feed').select('id,title,likes_count,answers_count').gt('answers_count', 0).order('likes_count', { ascending: false }).order('created_at', { ascending: false }).limit(1).then(r => {
    if (!ctx.alive()) return; const q = r.data?.[0];
    // nothing answered yet (a brand-new site): greet instead of leaving the top empty
    if (!q) { today.append(h('a.today', { href: '/ask' }, duskScene(), h('small', 'Alfrzo Ilm'), h('h2', t('home.h1a') + ' ' + t('home.h1b')), h('div.row', h('span.btn.gold.sm', icon('plus'), t('home.ask'))))); return; }
    today.append(h('a.today', { href: `/q/${q.id}` }, duskScene(), h('small', t('home.today')), h('h2', { dir: 'auto' }, q.title),
      h('div.row', h('span.row', { style: 'gap:6px' }, icon('heart'), String(q.likes_count)), h('span.row', { style: 'gap:6px' }, icon('qa'), String(q.answers_count)), h('span.end', icon('bookmark')))));
  });

  async function load() {
    clear(list); list.append(...skeletons(3));
    try {
      if (tab === 'all') return await answers();
      const r = await fetchFeed({ tab: tab === 'recent' ? 'latest' : tab });
      if (!ctx.alive()) return; clear(list);
      if (!r.items.length) { list.append(r.noFollows ? empty('scholars', t('feed.nofollow'), h('a.btn.sm', { href: '/scholars' }, t('nav.scholars'))) : empty('inbox', t('home.noq'), h('a.btn.sm', { href: '/ask' }, t('home.ask')))); return; }
      const st = await decorate(r.items); if (!ctx.alive()) return;
      r.items.forEach(q => list.append(questionCard(q, st)));
      list.append(h('div.center', { style: 'margin:6px 0' }, h('a.btn.ghost.sm', { href: '/qa' }, t('viewall'))));
    } catch { if (ctx.alive()) { clear(list); list.append(errorBox(load)); } }
  }

  // Feed of answers: each card is a scholar's answer to a PUBLIC question (private ones are never in question_feed).
  async function answers() {
    const a = await S.sb.from('answers').select('id,question_id,scholar_id,body,created_at').eq('status', 'published').order('created_at', { ascending: false }).limit(30);
    if (a.error) throw a.error;
    const ids = [...new Set(a.data.map(x => x.question_id))];
    const [qs, sm] = await Promise.all([ids.length ? S.sb.from('question_feed').select('id,title,category_id').in('id', ids) : { data: [] }, scholarMap(a.data.map(x => x.scholar_id))]);
    if (!ctx.alive() || tab !== 'all') return; clear(list);
    const titles = new Map((qs.data || []).map(q => [q.id, q]));
    const posts = a.data.filter(x => titles.has(x.question_id) && sm.has(x.scholar_id)).slice(0, 12);
    if (!posts.length) {
      const r = await fetchFeed({ tab: 'latest' }); if (!ctx.alive()) return;
      if (!r.items.length) { list.append(empty('inbox', t('home.noans'), h('a.btn.sm', { href: '/ask' }, t('home.ask')))); return; }
      const st = await decorate(r.items); if (!ctx.alive()) return;
      r.items.forEach(q => list.append(questionCard(q, st))); return;
    }
    posts.forEach(x => {
      const s = sm.get(x.scholar_id), q = titles.get(x.question_id);
      list.append(h('a.card.post', { href: `/q/${x.question_id}` },
        h('div.who', avatar(s.display_name), h('div.grow', h('div', { style: 'font-weight:800' }, s.display_name, ' ', verifiedBadge()), h('div.small.muted', t('verified') + ' · ' + timeAgo(x.created_at, getLang())))),
        h('p.qt', { dir: 'auto' }, q.title), h('div.ex', { dir: 'auto' }, x.body), h('span.more', t('post.more'))));
    });
  }
  load();
}
