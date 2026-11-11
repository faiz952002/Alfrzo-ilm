import { S } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, clear, timeAgo } from '../ui.js';
import { avatar, verifiedBadge, pageTitle, skeletons, empty, toggleFollow } from '../components.js';
import { duskScene } from '../art.js';
import { reelUrl } from './reels.js';

// Public profile of a verified scholar: cover, real counts, follow / book, then answers, reels and about.
export default async function scholar(view, ctx) {
  const id = ctx.params.id;
  view.append(pageTitle(t('sch.profile')), ...skeletons(2));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return S.go('/scholars', true);
  const [s, ans, f, rl] = await Promise.all([
    S.sb.from('scholar_directory').select('*').eq('id', id).maybeSingle(),
    S.sb.from('answers').select('id,question_id,body,created_at').eq('scholar_id', id).eq('status', 'published').order('created_at', { ascending: false }).limit(30),
    S.user ? S.sb.from('scholar_followers').select('scholar_id').eq('scholar_id', id) : { data: [] },
    S.sb.from('reel_feed').select('id,video_path,caption,created_at').eq('scholar_id', id).order('created_at', { ascending: false }).limit(12),
  ]);
  if (!ctx.alive()) return;
  clear(view);
  if (!s.data) { view.append(pageTitle(t('sch.profile')), empty('help', t('sch.notfound'), h('a.btn.sm', { href: '/scholars' }, t('nav.scholars')))); return; }
  const sc = s.data, reels = rl.data || []; let on = !!f.data?.length, followers = sc.followers_count, tab = 'answers';
  ctx.setTitle(sc.display_name, `${sc.qualifications} ${sc.bio}`.slice(0, 155));

  const cnt = h('b', String(followers));
  const btn = h('button.btn' + (on ? '.ghost' : ''), { type: 'button' }, on ? t('following.on') : t('follow'));
  btn.onclick = async () => {
    btn.disabled = true; const next = !on;
    if (await toggleFollow(id, next)) { on = next; followers += next ? 1 : -1; cnt.textContent = String(followers); btn.className = 'btn' + (on ? ' ghost' : ''); btn.textContent = on ? t('following.on') : t('follow'); }
    btn.disabled = false;
  };
  const cell = (n, label) => h('div', n, h('span', label));
  const tabs = h('div.utabs', { role: 'tablist' }), body = h('div');
  const paintTabs = () => { clear(tabs); [['answers', 'sch.tab.answers'], ['reels', 'reel.title'], ['about', 'sch.tab.about']].forEach(([k, lk]) =>
    tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; paintTabs(); show(); } }, t(lk)))); };

  view.append(
    h('div.sp-cover', duskScene(), h('button.back', { type: 'button', 'aria-label': t('back'), onclick: () => (history.length > 1 ? history.back() : S.go('/scholars')) }, icon('arrowL'))),
    h('div.sp-head', avatar(sc.display_name), h('h1', sc.display_name, ' ', verifiedBadge()), sc.specialties?.length ? h('div.sub', sc.specialties.join(' · ')) : null),
    h('div.sp-stats', cell(cnt, t('followers')), cell(h('b', String(sc.answers_count)), t('answers')), cell(h('b', String(reels.length)), t('reel.title'))),
    h('ul.sp-info', sc.qualifications ? h('li', icon('book'), h('span', { dir: 'auto' }, sc.qualifications)) : null, h('li', icon('badge'), h('span', t('sch.verifiednote')))),
    h('div.sp-actions', btn, h('a.btn.ghost', { href: `/consult/${id}` }, icon('calendar'), t('consult.title'))),
    tabs, body);

  async function show() {
    clear(body);
    if (tab === 'about') {
      body.append(h('div.card', h('h3', { style: 'margin-bottom:6px' }, t('sch.bio')), h('p', { style: 'white-space:pre-wrap;margin:0', dir: 'auto' }, sc.bio || t('sch.nobio')),
        sc.specialties?.length ? h('div', { style: 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap' }, sc.specialties.map(x => h('span.tag', x))) : null));
      return;
    }
    if (tab === 'reels') {
      if (!reels.length) return body.append(empty('video', t('reel.empty')));
      body.append(h('div.vgrid', reels.map(r => h('div', h('video', { src: reelUrl(r.video_path), controls: true, playsinline: true, preload: 'metadata', 'aria-label': r.caption }), h('div.cap', { dir: 'auto' }, r.caption)))));
      return;
    }
    if (!ans.data?.length) return body.append(empty('inbox', t('sch.noans')));
    const qs = await S.sb.from('question_feed').select('id,title').in('id', [...new Set(ans.data.map(a => a.question_id))]);
    if (!ctx.alive() || tab !== 'answers') return;
    const titles = new Map((qs.data || []).map(x => [x.id, x.title]));
    const pub = ans.data.filter(a => titles.has(a.question_id));
    if (!pub.length) return body.append(empty('inbox', t('sch.noans')));
    pub.forEach(a => body.append(h('a.card.q', { href: `/q/${a.question_id}` }, h('h3', { dir: 'auto' }, titles.get(a.question_id)), h('div.excerpt', { dir: 'auto' }, a.body), h('div.meta', { style: 'margin:8px 0 0' }, timeAgo(a.created_at, getLang())))));
  }
  paintTabs(); show();
}
