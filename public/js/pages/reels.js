import { S, errMsg } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, toast, clear } from '../ui.js';
import { skeletons, empty, errorBox, verifiedBadge, reportModal, needLogin } from '../components.js';

export const reelUrl = path => `${S.cfg.SUPABASE_URL}/storage/v1/object/public/reels/${path}`;

export default async function reels(view, ctx) {
  ctx.setTitle(t('reel.title'));
  const list = h('div.reels');
  view.append(h('div.page-title', h('button.back', { type: 'button', 'aria-label': t('back'), onclick: () => (history.length > 1 ? history.back() : S.go('/')) }, icon('arrowL')), h('h1', t('reel.title'))), list);
  list.append(...skeletons(1));
  const [r, lk] = await Promise.all([S.sb.from('reel_feed').select('*').order('created_at', { ascending: false }).limit(20), S.user ? S.sb.from('reel_likes').select('reel_id') : { data: [] }]);
  if (!ctx.alive()) return; clear(list);
  if (r.error) return list.append(errorBox(() => S.go('/reels')));
  if (!r.data.length) return list.append(empty('video', t('reel.empty')));
  const liked = new Set((lk.data || []).map(x => x.reel_id)), counted = new Set();
  let muted = true; const videos = [];
  const io = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) {
      v.muted = muted; v.play().catch(() => {});
      if (!counted.has(v.dataset.id)) { counted.add(v.dataset.id); S.sb.rpc('reel_viewed', { p_id: v.dataset.id }); }
    } else v.pause();
  }), { threshold: [0, 0.6] });
  ctx.cleanup(() => { io.disconnect(); videos.forEach(v => v.pause()); });

  r.data.forEach(x => {
    let on = liked.has(x.id), likes = x.likes_count;
    const v = h('video', { src: reelUrl(x.video_path), loop: true, playsinline: true, preload: 'metadata', 'data-id': x.id, 'aria-label': x.caption }); v.muted = true; videos.push(v);
    const cnt = h('span', String(likes));
    const likeBtn = h('button' + (on ? '.on' : ''), { type: 'button', 'aria-label': t('like'), 'aria-pressed': String(on) }, icon('heart'));
    likeBtn.onclick = async () => {
      if (!S.user) return needLogin();
      const next = !on; likeBtn.disabled = true;
      const q = next ? await S.sb.from('reel_likes').insert({ reel_id: x.id, user_id: S.user.id }) : await S.sb.from('reel_likes').delete().eq('reel_id', x.id).eq('user_id', S.user.id);
      likeBtn.disabled = false;
      if (q.error && !/23505/.test(q.error.code)) return toast(errMsg(q.error), true);
      on = next; likes += next ? 1 : -1; cnt.textContent = String(likes); likeBtn.classList.toggle('on', on); likeBtn.setAttribute('aria-pressed', String(on));
    };
    const soundBtn = h('button', { type: 'button', 'aria-label': t('reel.sound') }, icon('mute'));
    soundBtn.onclick = () => { muted = !muted; videos.forEach(o => { o.muted = muted; }); list.querySelectorAll('.snd').forEach(b => { clear(b).append(icon(muted ? 'mute' : 'sound')); }); };
    soundBtn.classList.add('snd');
    list.append(h('article.reel', v,
      h('button.tap', { type: 'button', 'aria-label': 'Play / pause', onclick: () => (v.paused ? v.play().catch(() => {}) : v.pause()) }),
      h('div.shade', h('a', { href: `/scholar/${x.scholar_id}` }, x.scholar_name, ' ', verifiedBadge()), h('p', { dir: 'auto' }, x.caption)),
      h('div.side', h('div', likeBtn, cnt), soundBtn, h('button', { type: 'button', 'aria-label': t('report'), onclick: () => reportModal('reel', x.id) }, icon('flag')))));
    io.observe(v);
  });
}
