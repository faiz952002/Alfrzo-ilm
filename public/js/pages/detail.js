import { S, catById, catName, errMsg, isVerifiedScholar, isAdmin } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, toast, clear, timeAgo, modal, confirmBox, busy, CONTACT_RE } from '../ui.js';
import { pageTitle, statusTag, catTag, verifiedBadge, avatar, shareQuestion, reportModal, toggleLike, toggleSave, needLogin, skeletons, empty } from '../components.js';
import { scholarMap } from '../data.js';

const SENSITIVE = new Set(['nikah', 'family', 'halal-haram', 'zakat', 'hajj', 'aqeedah']);

export default async function detail(view, ctx) {
  const id = ctx.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return S.go('/404', true);
  view.append(pageTitle(t('qd.title')), ...skeletons(2));
  const [pub, own, ans] = await Promise.all([
    S.sb.from('question_feed').select('*').eq('id', id).maybeSingle(),
    S.user ? S.sb.from('questions').select('*').eq('id', id).maybeSingle() : { data: null },
    S.sb.from('answers').select('*').eq('question_id', id).eq('status', 'published').order('created_at'),
  ]);
  if (!ctx.alive()) return;
  clear(view);
  let q = pub.data || (own.data ? { ...own.data, answers_count: ans.data?.length || 0, asker_name: null } : null);
  // a private question is not in the public feed: the answering scholar reads it from the scholar queue (no asker identity there)
  if (!q && isVerifiedScholar()) {
    const sq = await S.sb.from('scholar_queue').select('*').eq('id', id).maybeSingle();
    if (!ctx.alive()) return;
    if (sq.data) q = { ...sq.data, likes_count: 0, asker_name: null, has_image: !!sq.data.image_path };
  }
  if (!q) { view.append(pageTitle(t('qd.title')), empty('help', t('qd.notfound'), h('a.btn.sm', { href: '/qa' }, t('nav.qa')))); return; }
  const mine = own.data && own.data.user_id === S.user?.id ? own.data : null;
  const isPublic = ['open', 'answered'].includes(q.status);
  const priv = q.visibility === 'private', canShare = isPublic && !priv;
  const cat = catById(q.category_id);
  ctx.setTitle(q.title.slice(0, 70), (q.body || q.title).slice(0, 155));
  // most helpful first: the top one is shown as the best answer
  const answers = (ans.data || []).slice().sort((a, b) => (b.helpful_count - a.helpful_count) || (new Date(a.created_at) - new Date(b.created_at)));
  const sm = await scholarMap(answers.map(a => a.scholar_id));
  let liked = false, helpful = new Set(), saved = new Set();
  if (S.user) {
    const [l, hp, sv] = await Promise.all([
      S.sb.from('question_likes').select('question_id').eq('question_id', id),
      answers.length ? S.sb.from('answer_helpful').select('answer_id').in('answer_id', answers.map(a => a.id)) : { data: [] },
      answers.length ? S.sb.from('saved_answers').select('answer_id').in('answer_id', answers.map(a => a.id)) : { data: [] },
    ]);
    liked = !!l.data?.length; helpful = new Set((hp.data || []).map(x => x.answer_id)); saved = new Set((sv.data || []).map(x => x.answer_id));
  }
  if (!ctx.alive()) return;

  // ---- question card
  let likes = q.likes_count || 0;
  const likeBtn = h('button.act' + (liked ? '.on' : ''), { type: 'button', 'aria-pressed': String(liked), disabled: !canShare }, icon('heart'), h('span', String(likes)), ' ', t('like'));
  likeBtn.onclick = async () => {
    const next = !liked; liked = next; likes += next ? 1 : -1; paint();
    if (!(await toggleLike(id, next))) { liked = !next; likes += next ? -1 : 1; paint(); }
  };
  const paint = () => { likeBtn.classList.toggle('on', liked); likeBtn.setAttribute('aria-pressed', String(liked)); likeBtn.children[1].textContent = String(likes); };
  const imgBox = h('div');
  const qcard = h('article.card.qd', h('div.meta.row', { style: 'flex-wrap:wrap;font-size:12.5px;color:var(--faint)' }, catTag(q.category_id), h('span', timeAgo(q.created_at, getLang())), statusTag(q), priv ? h('span.tag.blue', icon('lock', ''), t('qd.private')) : null),
    h('h1', { dir: 'auto' }, q.title),
    h('div.asker', avatar(q.asker_name || '?'), h('div.grow', h('b', q.asker_name || t('ask.anon.short')), q.body ? h('div.body', { dir: 'auto' }, q.body) : null)), imgBox,
    h('div.row', { style: 'margin-top:10px;flex-wrap:wrap' }, likeBtn,
      h('button.act', { type: 'button', onclick: () => shareQuestion(q), disabled: !canShare }, icon('share'), t('share')),
      h('button.act', { type: 'button', onclick: () => reportModal('question', id), disabled: !canShare }, icon('flag'), t('report'))));
  view.append(pageTitle(t('qd.title'), true, canShare ? h('button.iconbtn', { type: 'button', 'aria-label': t('share'), onclick: () => shareQuestion(q) }, icon('share')) : null), qcard);

  if (mine) {
    qcard.append(h('div.notice' + (q.status === 'rejected' ? '.bad' : q.status === 'pending_review' ? '.warn' : ''), { style: 'margin:12px 0 0' }, icon('info'), h('div', t('my.status.' + q.status))));
    qcard.append(h('button.btn.ghost.sm', { type: 'button', style: 'margin-top:10px', onclick: async () => {
      if (!(await confirmBox(t('my.delete'), t('my.delete.d'), t('delete'), t('cancel'), true))) return;
      if (mine.image_path) S.sb.storage.remove('question-images', [mine.image_path]);
      const r = await S.sb.from('questions').delete().eq('id', id);
      if (r.error) return toast(errMsg(r.error), true);
      toast(t('my.deleted')); S.go('/my-questions', true);
    } }, icon('trash'), t('my.delete')));
  }
  // private image: visible only to the asker, verified scholars and admins (storage RLS decides)
  const imgPath = mine?.image_path || (q.has_image && (isVerifiedScholar() || isAdmin()) ? (await S.sb.from('scholar_queue').select('image_path').eq('id', id).maybeSingle()).data?.image_path : null);
  if (imgPath) S.sb.storage.signedUrl('question-images', imgPath, 600).then(r => { if (r.url && ctx.alive()) imgBox.append(h('img', { src: r.url, alt: t('qd.img'), loading: 'lazy', style: 'max-width:100%;border-radius:12px;margin-top:10px' })); });
  else if (q.has_image) imgBox.append(h('div.hint', icon('lock', ''), ' ', t('qd.img.private')));

  // ---- answers
  const list = h('section', { 'aria-label': t('qd.answers') });
  view.append(h('div.section-h', { style: 'margin-top:8px' }, h('h2', answers.length ? t('qd.best') : `${t('qd.answers')} (0)`)), list);
  if (!answers.length) list.append(h('div.card.center', h('span.tag.gold', t('st.open')), h('p.muted', isPublic ? t('qd.unanswered') : t('qd.notpublic'))));
  answers.forEach((a, i) => { if (i === 1) list.append(h('div.section-h', h('h2', `${t('qd.more')} (${answers.length - 1})`))); list.append(answerCard(a)); });
  if (answers.length || cat) {
    const strong = cat && SENSITIVE.has(cat.slug);
    view.append(h('div.disclaimer', icon('alert'), h('div', t(strong ? 'qd.disc.strong' : 'qd.disc'))));
  }

  function answerCard(a, editing = false) {
    const s = sm.get(a.scholar_id); const name = s?.display_name || t('scholar');
    let help = a.helpful_count, isHelp = helpful.has(a.id), isSaved = saved.has(a.id);
    const hb = h('button.act' + (isHelp ? '.on' : ''), { type: 'button', 'aria-pressed': String(isHelp) }, icon('thumb'), h('span', String(help)), ' ', t('helpful'));
    hb.onclick = async () => {
      if (!S.user) return needLogin(); const next = !isHelp; hb.disabled = true;
      const r = next ? await S.sb.from('answer_helpful').insert({ user_id: S.user.id, answer_id: a.id }) : await S.sb.from('answer_helpful').delete().eq('answer_id', a.id).eq('user_id', S.user.id);
      hb.disabled = false; if (r.error && !/23505/.test(r.error.code)) return toast(errMsg(r.error), true);
      isHelp = next; help += next ? 1 : -1; hb.classList.toggle('on', next); hb.setAttribute('aria-pressed', String(next)); hb.children[1].textContent = String(help);
    };
    const sb = h('button.act' + (isSaved ? '.on' : ''), { type: 'button', 'aria-pressed': String(isSaved) }, icon('bookmark'), t('save'));
    sb.onclick = async () => { const next = !isSaved; if (await toggleSave(a.id, next)) { isSaved = next; sb.classList.toggle('on', next); sb.setAttribute('aria-pressed', String(next)); toast(next ? t('saved.added') : t('saved.removed')); } };
    const refs = (a.quran_refs || a.hadith_refs) ? h('div.refs', h('div.small.muted', t('ans.refs.note')),
      a.quran_refs ? h('div', h('b', t('ans.quran') + ': '), h('span', { dir: 'auto' }, a.quran_refs)) : null,
      a.hadith_refs ? h('div', h('b', t('ans.hadith') + ': '), h('span', { dir: 'auto' }, a.hadith_refs)) : null) : null;
    const card = h('article.card.ans', h('div.who', avatar(name), h('div.grow', h('a', { href: s ? `/scholar/${s.id}` : '#', style: 'font-weight:800;text-decoration:none;color:inherit' }, name, ' ', s ? verifiedBadge() : null),
        h('div.small.muted', s?.qualifications || '', ' · ', timeAgo(a.created_at, getLang()), Math.abs(new Date(a.updated_at) - new Date(a.created_at)) > 5000 ? ' · ' + t('ans.edited') : '')),
      a.scholar_id === S.user?.id ? h('button.act', { type: 'button', onclick: () => card.replaceWith(editForm(a)) }, icon('edit'), t('edit')) : null),
      h('div.text', { dir: 'auto' }, a.body), refs,
      h('div.row', { style: 'margin-top:10px;flex-wrap:wrap' }, hb, sb, h('button.act', { type: 'button', onclick: () => reportModal('answer', a.id) }, icon('flag'), t('report'))));
    return card;
  }

  // ---- scholar answer form (create or edit) --------------------------------
  function editForm(existing) {
    const body = h('textarea', { maxlength: 8000, style: 'min-height:180px', dir: 'auto', placeholder: t('sa.ph') }, existing?.body || '');
    body.value = existing?.body || '';
    const qr = h('textarea', { maxlength: 1000, style: 'min-height:70px', dir: 'auto', placeholder: t('sa.quran.ph') }); qr.value = existing?.quran_refs || '';
    const hd = h('textarea', { maxlength: 1000, style: 'min-height:70px', dir: 'auto', placeholder: t('sa.hadith.ph') }); hd.value = existing?.hadith_refs || '';
    const chk = h('input', { type: 'checkbox' }); const err = h('div.err', { role: 'alert' });
    const btn = h('button.btn.block', { type: 'submit' }, icon('send'), t(existing ? 'sa.update' : 'sa.publish'));
    const f = h('form.card', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (body.value.trim().length < 10) { err.textContent = t('sa.err.short'); return; }
      if ((qr.value.trim() || hd.value.trim()) && !chk.checked) { err.textContent = t('sa.err.verify'); return; }
      if (CONTACT_RE.test(body.value + ' ' + qr.value + ' ' + hd.value)) { err.textContent = t('err.contact'); return; }
      btn.disabled = true;
      const vals = { body: body.value.trim(), quran_refs: qr.value.trim(), hadith_refs: hd.value.trim() };
      const r = existing ? await S.sb.from('answers').update(vals).eq('id', existing.id).select('*').single()
        : await S.sb.from('answers').insert({ question_id: id, scholar_id: S.user.id, ...vals }).select('*').single();
      btn.disabled = false;
      if (r.error) { err.textContent = errMsg(r.error); return; }
      toast(t(existing ? 'sa.updated' : 'sa.published')); sm.set(S.user.id, { id: S.user.id, display_name: S.profile.display_name, qualifications: S.scholar?.qualifications });
      if (existing) { f.replaceWith(answerCard(r.data)); } else { S.go(`/q/${id}`); }
    } },
      h('h3', { style: 'margin-bottom:6px' }, t(existing ? 'sa.edit' : 'sa.write')),
      h('div.notice.warn', icon('alert'), h('div', t('sa.rules'))),
      h('label.f', t('sa.answer')), body, h('label.f', t('ans.quran')), qr, h('label.f', t('ans.hadith')), hd,
      h('label.switch', chk, h('span.small', t('sa.verify'))), err, btn,
      existing ? h('button.btn.ghost.block', { type: 'button', style: 'margin-top:8px', onclick: () => f.replaceWith(answerCard(existing)) }, t('cancel')) : null);
    return f;
  }
  const alreadyAnswered = S.user && answers.some(a => a.scholar_id === S.user.id);
  if (isVerifiedScholar() && isPublic && !alreadyAnswered) view.append(editForm(null));
  else if (S.profile && !isVerifiedScholar() && S.scholar && isPublic) view.append(h('div.notice', icon('info'), h('div', t('sa.notverified'))));
}
