import { S, catName, errMsg, requireAuth } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, toast, clear, CONTACT_RE, dirOf } from '../ui.js';
import { pageTitle } from '../components.js';

const MAX_IMG = 2 * 1024 * 1024, OK_IMG = ['image/jpeg', 'image/png', 'image/webp'];

export default async function ask(view, ctx) {
  ctx.setTitle(t('ask.title'), t('meta.ask'));
  if (!requireAuth(ctx)) return;
  const lang0 = { hi: 'hi', en: 'en' }[S.profile.language] || 'hi';
  const title = h('textarea', { id: 'qt', maxlength: 200, rows: 3, required: true, style: 'min-height:90px', placeholder: t('ask.ph'), dir: 'auto' });
  const body = h('textarea', { id: 'qb', maxlength: 4000, placeholder: t('ask.detail.ph'), dir: 'auto', style: 'min-height:120px' });
  const count = h('span.hint', '0 / 200');
  const lang = h('select', { id: 'ql' }, [['hi', 'हिन्दी'], ['en', 'English'], ['ur', 'اردو']].map(([v, l]) => h('option', { value: v, selected: v === lang0 }, l)));
  const cat = h('select', { id: 'qc', required: true }, h('option', { value: '' }, t('ask.pickcat')), S.cats.map(c => h('option', { value: c.id }, c.icon + ' ' + catName(c))));
  const anon = h('input', { type: 'checkbox', id: 'qa', checked: S.profile.default_anonymous });
  const file = h('input', { type: 'file', accept: OK_IMG.join(','), id: 'qi', style: 'padding:9px' });
  const prev = h('div'), err = h('div.err', { role: 'alert' });
  const btn = h('button.btn.block', { type: 'submit' }, icon('send'), t('ask.submit'));
  let img = null, mode = ctx.query.get('mode') === 'private' ? 'private' : 'general';
  const note = h('div.small.muted', { style: 'margin:-4px 0 10px' });
  const seg = h('div.seg', { role: 'group', 'aria-label': t('ask.title') });
  const paintSeg = () => {
    clear(seg);
    [['general', 'qa', ''], ['private', 'lock', ''], ['priority', 'crown', 'gold']].forEach(([k, ic, cls]) => seg.append(h('button' + (cls ? '.' + cls : ''), { type: 'button', 'aria-pressed': String(mode === k), onclick: () => {
      if (k === 'priority' && !S.premium) { toast(t('ask.priority.off')); S.go('/premium'); return; }
      mode = k; paintSeg();
    } }, icon(ic), t('ask.mode.' + k))));
    note.textContent = mode === 'private' ? t('ask.private.d') : mode === 'priority' ? t('ask.priority.on') : '';
  };
  paintSeg();

  title.addEventListener('input', () => { count.textContent = `${title.value.length} / 200`; err.textContent = ''; });
  file.addEventListener('change', () => {
    clear(prev); img = null; err.textContent = '';
    const f = file.files[0]; if (!f) return;
    if (!OK_IMG.includes(f.type)) { err.textContent = t('ask.img.type'); file.value = ''; return; }
    if (f.size > MAX_IMG) { err.textContent = t('ask.img.size'); file.value = ''; return; }
    img = f; const u = URL.createObjectURL(f);
    prev.append(h('img', { src: u, alt: '', style: 'max-width:100%;max-height:180px;border-radius:12px;margin-top:8px' }), h('div.hint', t('ask.img.warn')));
  });

  const form = h('form.card', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const tt = title.value.trim(), bb = body.value.trim();
    if (tt.length < 10) { err.textContent = t('ask.err.short'); title.focus(); return; }
    if (!cat.value) { err.textContent = t('ask.err.cat'); cat.focus(); return; }
    if (CONTACT_RE.test(tt + ' ' + bb)) { err.textContent = t('err.contact'); return; }
    btn.disabled = true; btn.lastChild.textContent = t('ask.sending');
    let path = null;
    try {
      if (img) {
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[img.type];
        path = `${S.user.id}/${crypto.randomUUID()}.${ext}`;
        const up = await S.sb.storage.upload('question-images', path, img);
        if (up.error) throw up.error;
      }
      const r = await S.sb.from('questions').insert({ user_id: S.user.id, category_id: Number(cat.value), title: tt, body: bb, language: lang.value, is_anonymous: anon.checked, image_path: path, visibility: mode === 'private' ? 'private' : 'public' }).select('id,status').single();
      if (r.error) throw r.error;
      done(r.data);
    } catch (x) {
      if (path) S.sb.storage.remove('question-images', [path]);
      err.textContent = errMsg(x); btn.disabled = false; btn.lastChild.textContent = t('ask.submit');
    }
  } },
    seg, note,
    h('label.f', { for: 'qt', style: 'margin-top:0' }, t('ask.q')), title, count,
    h('label.f', { for: 'qb' }, t('ask.detail')), body,
    h('div.grid-2', h('div', h('label.f', { for: 'qc' }, t('ask.cat')), cat), h('div', h('label.f', { for: 'ql' }, t('ask.lang')), lang)),
    h('label.f', { for: 'qi' }, t('ask.img')), file, prev,
    h('label.switch', anon, h('span', h('b', t('ask.anon')), h('div.small.muted', t('ask.anon.d')))),
    h('div.notice.good', icon('lock'), h('div', t('ask.privacy'))), err, btn);

  function done(row) {
    clear(view);
    view.append(h('div.card.center', { style: 'padding:30px 18px' }, h('div', { style: 'width:70px;height:70px;border-radius:50%;background:var(--em-100);color:var(--em-700);display:grid;place-items:center;margin:0 auto 12px' }, icon('check')),
      h('h2', t('ask.done.t')), h('p.muted', t('ask.done.d')), h('span.tag.warn', t('st.pending')),
      h('div.stack', { style: 'margin-top:18px' }, h('a.btn.block', { href: '/my-questions' }, t('my.q')), h('a.btn.ghost.block', { href: '/ask', onclick: e => { e.preventDefault(); ask(clear(view), ctx); } }, t('ask.another')))));
  }
  view.append(pageTitle(t('ask.title')), form);
}
