import { S, catById, catName, errMsg } from './store.js';
import { t, getLang } from './i18n.js';
import { h, icon, toast, modal, timeAgo, initial, dirOf, busy } from './ui.js';

export const skeletons = (n = 3) => Array.from({ length: n }, () => h('div.skeleton'));
export const empty = (ic, text, action) => h('div.empty', icon(ic), h('p', text), action || null);
export const errorBox = (retry) => h('div.empty', icon('alert'), h('p', t('err.load')), retry ? h('button.btn.ghost.sm', { onclick: retry }, t('retry')) : null);
export function pageTitle(title, back = true, right = null) {
  return h('div.page-title', back ? h('button.back', { type: 'button', 'aria-label': t('back'), onclick: () => (history.length > 1 ? history.back() : S.go('/')) }, icon('arrowL')) : null, h('h1', title), right);
}
export const verifiedBadge = () => h('span.verified', { title: t('verified'), role: 'img', 'aria-label': t('verified') }, icon('badge'));
export const avatar = (name, cls = '') => h('div.avatar' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' }, initial(name));

export function statusTag(q) {
  if (q.status === 'answered' || q.answers_count > 0) return h('span.tag', icon('check', ''), t('st.answered'));
  if (q.status === 'pending_review') return h('span.tag.warn', t('st.pending'));
  if (q.status === 'rejected') return h('span.tag.red', t('st.rejected'));
  return h('span.tag.gold', t('st.open'));
}
export function catTag(id) {
  const c = catById(id); if (!c) return null;
  return h('a.tag', { href: `/qa?cat=${c.slug}`, onclick: e => e.stopPropagation() }, c.icon + ' ' + catName(c));
}

export async function shareQuestion(q) {
  const url = `${location.origin}/q/${q.id}`;
  try { if (navigator.share) { await navigator.share({ title: q.title, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast(t('share.copied')); } catch { prompt(t('share.copy'), url); }
}
export function needLogin() { toast(t('login.needed'), true); S.go('/login?next=' + encodeURIComponent(location.pathname + location.search)); return false; }

export async function toggleLike(qid, on) {
  if (!S.user) return needLogin() && false;
  const r = on ? await S.sb.from('question_likes').insert({ user_id: S.user.id, question_id: qid })
    : await S.sb.from('question_likes').delete().eq('question_id', qid).eq('user_id', S.user.id);
  if (r.error && !/23505/.test(r.error.code)) { toast(errMsg(r.error), true); return false; } return true;
}
export async function toggleSave(aid, on) {
  if (!S.user) return needLogin() && false;
  const r = on ? await S.sb.from('saved_answers').insert({ user_id: S.user.id, answer_id: aid })
    : await S.sb.from('saved_answers').delete().eq('answer_id', aid).eq('user_id', S.user.id);
  if (r.error && !/23505/.test(r.error.code)) { toast(errMsg(r.error), true); return false; } return true;
}
export async function toggleFollow(sid, on) {
  if (!S.user) return needLogin() && false;
  const r = on ? await S.sb.from('scholar_followers').insert({ user_id: S.user.id, scholar_id: sid })
    : await S.sb.from('scholar_followers').delete().eq('scholar_id', sid).eq('user_id', S.user.id);
  if (r.error && !/23505/.test(r.error.code)) { toast(errMsg(r.error), true); return false; } return true;
}

export function reportModal(type, id) {
  if (!S.user) return needLogin();
  modal((sheet, close) => {
    const reason = h('select', ['misleading', 'inappropriate', 'spam', 'contact', 'wrong_ref', 'other'].map(k => h('option', { value: k }, t('report.r.' + k))));
    const note = h('textarea', { maxlength: 300, style: 'min-height:80px', placeholder: t('report.note') });
    const send = h('button.btn.block', { type: 'button' }, t('report.send'));
    send.onclick = async () => {
      busy(send, true);
      const text = `${t('report.r.' + reason.value)}${note.value.trim() ? ': ' + note.value.trim() : ''}`.slice(0, 500);
      const r = await S.sb.from('reports').insert({ reporter_id: S.user.id, target_type: type, target_id: id, reason: text });
      busy(send, false);
      if (r.error) { toast(/23505/.test(r.error.code) ? t('report.dup') : errMsg(r.error), true); if (/23505/.test(r.error.code)) close(); return; }
      toast(t('report.done')); close();
    };
    sheet.append(h('h2', t('report.title')), h('p.muted.small', t('report.help')), h('label.f', t('report.reason')), reason, h('label.f', t('report.more')), note, h('div', { style: 'margin-top:14px' }, send));
  });
}

// A feed card. state = {liked:Set, firstAnswer:Map, saved:Set}
export function questionCard(q, state = {}) {
  const liked = state.liked?.has(q.id); const aid = state.firstAnswer?.get(q.id);
  let likes = q.likes_count, isLiked = !!liked, isSaved = aid ? state.saved?.has(aid) : false;
  const likeBtn = h('button.act' + (isLiked ? '.on' : ''), { type: 'button', 'aria-pressed': String(isLiked), 'aria-label': t('like') }, icon('heart'), h('span', String(likes)));
  likeBtn.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    isLiked = !isLiked; likes += isLiked ? 1 : -1; paint();
    if (!(await toggleLike(q.id, isLiked))) { isLiked = !isLiked; likes += isLiked ? 1 : -1; paint(); }
  };
  const paint = () => { likeBtn.classList.toggle('on', isLiked); likeBtn.setAttribute('aria-pressed', String(isLiked)); likeBtn.lastChild.textContent = String(likes); };
  const saveBtn = h('button.act' + (isSaved ? '.on' : ''), { type: 'button', 'aria-label': t('save'), 'aria-pressed': String(isSaved), disabled: !aid, title: aid ? t('save') : t('save.noanswer') }, icon('bookmark'));
  saveBtn.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const next = !isSaved; if (await toggleSave(aid, next)) { isSaved = next; saveBtn.classList.toggle('on', next); saveBtn.setAttribute('aria-pressed', String(next)); toast(next ? t('saved.added') : t('saved.removed')); }
  };
  const shareBtn = h('button.act', { type: 'button', 'aria-label': t('share'), onclick: e => { e.preventDefault(); e.stopPropagation(); shareQuestion(q); } }, icon('share'));
  const repBtn = h('button.act', { type: 'button', 'aria-label': t('report'), onclick: e => { e.preventDefault(); e.stopPropagation(); reportModal('question', q.id); } }, icon('flag'));
  return h('a.card.q', { href: `/q/${q.id}` },
    h('div.meta', catTag(q.category_id), h('span', timeAgo(q.created_at, getLang())), q.asker_name ? h('span', '· ' + q.asker_name) : null),
    h('h3', { dir: 'auto' }, q.title),
    q.body ? h('div.excerpt', { dir: 'auto' }, q.body) : null,
    h('div.foot', likeBtn, h('span.row', { style: 'gap:5px' }, icon('qa', ''), String(q.answers_count)), saveBtn, shareBtn, repBtn, h('span.st', statusTag(q))));
}

export function scholarCard(s, followed, onFollow) {
  let on = followed; 
  const btn = h('button.btn.sm' + (on ? '.ghost' : ''), { type: 'button' }, on ? t('following.on') : t('follow'));
  btn.onclick = async e => {
    e.preventDefault(); e.stopPropagation(); btn.disabled = true;
    const next = !on; if (await toggleFollow(s.id, next)) { on = next; btn.className = 'btn sm' + (on ? ' ghost' : ''); btn.textContent = on ? t('following.on') : t('follow'); onFollow?.(on); }
    btn.disabled = false;
  };
  return h('a.card.scholar', { href: `/scholar/${s.id}` }, avatar(s.display_name),
    h('div.grow', h('div', { style: 'font-weight:800' }, s.display_name, ' ', verifiedBadge()),
      h('div.small.muted', s.specialties?.length ? s.specialties.join(' · ') : s.qualifications),
      h('div.small.muted', `${s.answers_count} ${t('answers')} · ${s.followers_count} ${t('followers')}`)), btn);
}
