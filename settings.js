import { S, errMsg, requireAuth, loadProfile } from '../store.js';
import { t, getLang } from '../i18n.js';
import '../i18n.pages.js';
import { h, icon, toast, confirmBox, busy } from '../ui.js';
import { pageTitle } from '../components.js';

export default async function settings(view, ctx) {
  ctx.setTitle(t('set.title'));
  if (!requireAuth(ctx)) return;
  const p = S.profile;

  // ---- profile -------------------------------------------------------------
  const name = h('input', { id: 'dn', maxlength: 60, value: p.display_name, required: true, autocomplete: 'nickname' });
  const lang = h('select', { id: 'lg' }, [['hi', 'हिन्दी'], ['en', 'English']].map(([v, l]) => h('option', { value: v }, l)));
  lang.value = getLang();
  const perr = h('div.err', { role: 'alert' });
  const pbtn = h('button.btn.block', { type: 'submit' }, t('set.save'));
  const profileForm = h('form.card', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); perr.textContent = '';
    const dn = name.value.trim();
    if (!dn) { perr.textContent = t('auth.err.name'); name.focus(); return; }
    busy(pbtn, true);
    const r = await S.sb.from('profiles').update({ display_name: dn, language: lang.value }).eq('id', S.user.id);
    busy(pbtn, false);
    if (r.error) { perr.textContent = errMsg(r.error); return; }
    await loadProfile(); toast(t('set.saved'));
    if (lang.value !== getLang()) await S.switchLang();
  } },
    h('h3', t('set.profile')),
    h('label.f', { for: 'dn' }, t('set.name')), name,
    h('label.f', { for: 'lg' }, t('set.lang')), lang, perr, h('div', { style: 'margin-top:12px' }, pbtn));

  // ---- privacy + notification switches (saved the moment they are flipped) --
  const sw = (field, title, desc) => {
    const input = h('input', { type: 'checkbox', checked: !!S.profile[field] });
    input.onchange = async () => {
      input.disabled = true;
      const r = await S.sb.from('profiles').update({ [field]: input.checked }).eq('id', S.user.id);
      input.disabled = false;
      if (r.error) { input.checked = !input.checked; toast(errMsg(r.error), true); return; }
      S.profile[field] = input.checked; toast(t('set.saved'));
    };
    return h('label.switch', input, h('span', h('b', title), desc ? h('div.small.muted', desc) : null));
  };
  const prefs = h('div.card', h('h3', t('set.privacy')),
    sw('default_anonymous', t('set.anon'), t('set.anon.d')),
    h('p.small.muted', { style: 'margin:0 0 6px' }, h('a', { href: '/privacy' }, t('privacy.title'))),
    h('h3', { style: 'margin-top:12px' }, t('set.notif')),
    sw('notify_answers', t('set.n.answers')), sw('notify_followed', t('set.n.followed')));

  // ---- account: email (read only) + password ---------------------------------
  const pw = h('input', { id: 'npw', type: 'password', minlength: 8, autocomplete: 'new-password' });
  const aerr = h('div.err', { role: 'alert' });
  const abtn = h('button.btn.ghost.block', { type: 'submit' }, t('set.pw'));
  const account = h('form.card', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); aerr.textContent = '';
    if (pw.value.length < 8) { aerr.textContent = t('err.weak'); pw.focus(); return; }
    busy(abtn, true);
    const r = await S.sb.auth.updateUser({ password: pw.value });
    busy(abtn, false);
    if (r.error) { aerr.textContent = errMsg(r.error); return; }
    pw.value = ''; toast(t('set.pw.done'));
  } },
    h('h3', t('set.account')),
    h('div.small.muted', t('email')), h('div', { style: 'font-weight:700;margin-bottom:6px;word-break:break-all' }, S.user.email),
    h('label.f', { for: 'npw' }, t('set.pw.new')), pw, h('div.hint', t('auth.pw.hint')), aerr, h('div', { style: 'margin-top:12px' }, abtn));

  // ---- danger zone -------------------------------------------------------------
  const delBtn = h('button.btn.danger.block', { type: 'button' }, icon('trash'), t('set.del'));
  delBtn.onclick = async () => {
    if (!(await confirmBox(t('set.del'), t('set.del.d'), t('set.del.go'), t('cancel'), true))) return;
    delBtn.disabled = true;
    try {
      // Private question images live in storage, outside the database cascade: remove them first.
      const imgs = await S.sb.from('questions').select('image_path').eq('user_id', S.user.id).f('image_path', 'not', 'is.null');
      const paths = (imgs.data || []).map(x => x.image_path).filter(Boolean);
      if (paths.length) await S.sb.storage.remove('question-images', paths);
      const r = await S.sb.rpc('delete_my_account');
      if (r.error) throw r.error;
      await S.sb.auth.signOut();
      toast(t('set.deleted')); S.go('/', true);
    } catch (x) { delBtn.disabled = false; toast(errMsg(x), true); }
  };
  const danger = h('div.card', { style: 'border-color:#e8b4ad' }, h('h3', { style: 'color:var(--danger)' }, t('set.danger')), h('p.muted.small', t('set.del.d')), delBtn);

  view.append(pageTitle(t('set.title')), h('div.stack', profileForm, prefs, account, danger));
}
