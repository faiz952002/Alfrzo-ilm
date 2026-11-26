import { S, errMsg, requireAuth, loadProfile } from '../store.js';
import { t, getLang } from '../i18n.js';
import '../i18n.pages.js';
import { h, icon, toast, confirmBox, busy, modal } from '../ui.js';
import { pageTitle } from '../components.js';
import { avatarEl, photosSupported, squareImage, forgetAvatar, PHOTO_TYPES } from '../avatar.js';
import { emailConfirmed } from './profile.js';

// Same rules as the database (migration 008) - checked here first so mistakes are explained before saving.
export function nameProblem(raw) {
  const v = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!v || v.length > 60 || !/\p{L}/u.test(v)) return 'err.name';
  if (/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/.test(v)) return 'err.name';
  if (/(\+?\d[\s\-.]?){10,}/.test(v) || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(v) || /(https?:\/\/|www\.|wa\.me|t\.me)/i.test(v)) return 'err.contact';
  return null;
}
export const pwProblem = pw => (pw.length < 8 || pw.length > 72 || !/\p{L}/u.test(pw) || !/\d/.test(pw)) ? 'set.pw.rule' : null;

const section = (id, ic, title, ...kids) => h('section.card.set-sec', { id, 'aria-labelledby': id + '-h' }, h('h3', { id: id + '-h' }, icon(ic, ''), title), ...kids);

export default async function settings(view, ctx) {
  ctx.setTitle(t('set.title'));
  if (!requireAuth(ctx)) return;
  const p = S.profile, me = S.user.id;

  // ---- profile: photo, name, language ----------------------------------------
  const photoBox = h('div.photo-row');
  const paintPhoto = () => {
    photoBox.replaceChildren();
    if (!photosSupported()) { photoBox.append(avatarEl(S.profile, 'md'), h('p.small.muted', t('set.photo.na'))); return; }
    const file = h('input', { type: 'file', accept: PHOTO_TYPES.join(','), hidden: true, 'aria-label': t('set.photo') });
    const pick = h('button.btn.ghost.sm', { type: 'button', onclick: () => file.click() }, icon('upload'), t(S.profile.avatar_path ? 'set.photo.change' : 'set.photo.add'));
    const rm = S.profile.avatar_path ? h('button.btn.ghost.sm', { type: 'button', style: 'color:var(--danger)' }, t('set.photo.remove')) : null;
    const setBusy = on => { pick.disabled = on; if (rm) rm.disabled = on; photoBox.setAttribute('aria-busy', String(on)); };
    file.onchange = async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      setBusy(true);
      try {
        const { blob, ext } = await squareImage(f);
        const path = `${me}/avatar-${Date.now()}.${ext}`, old = S.profile.avatar_path;
        const up = await S.sb.storage.upload('avatars', path, blob);
        if (up.error) throw up.error;
        const r = await S.sb.from('profiles').update({ avatar_path: path }).eq('id', me);
        if (r.error) { await S.sb.storage.remove('avatars', [path]); throw r.error; }
        if (old) { forgetAvatar(old); S.sb.storage.remove('avatars', [old]).catch(() => {}); }   // the old file is no longer used
        S.profile.avatar_path = path; toast(t('set.saved'));
      } catch (e) { toast(e?.message === 'BAD_PHOTO' ? t('set.photo.bad') : errMsg(e), true); }
      setBusy(false); paintPhoto();
    };
    if (rm) rm.onclick = async () => {
      setBusy(true);
      const old = S.profile.avatar_path, r = await S.sb.from('profiles').update({ avatar_path: null }).eq('id', me);
      if (r.error) toast(errMsg(r.error), true);
      else { forgetAvatar(old); S.sb.storage.remove('avatars', [old]).catch(() => {}); S.profile.avatar_path = null; toast(t('set.saved')); }
      setBusy(false); paintPhoto();
    };
    photoBox.append(avatarEl(S.profile, 'md'), h('div', h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, pick, rm), h('div.hint', t('set.photo.hint'))), file);
  };
  paintPhoto();

  const name = h('input', { id: 'dn', maxlength: 60, value: p.display_name, required: true, autocomplete: 'nickname', dir: 'auto', 'aria-describedby': 'dn-hint' });
  const lang = h('select', { id: 'lg' }, [['hi', 'हिन्दी'], ['en', 'English']].map(([v, l]) => h('option', { value: v }, l)));
  lang.value = getLang();
  const perr = h('div.err', { role: 'alert' });
  const pbtn = h('button.btn.block', { type: 'submit', disabled: true }, t('set.save'));
  const dirty = () => { pbtn.disabled = name.value.trim() === S.profile.display_name && lang.value === getLang(); };
  name.oninput = () => { perr.textContent = ''; dirty(); }; lang.onchange = dirty;
  const profileForm = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); perr.textContent = '';
    const dn = name.value.replace(/\s+/g, ' ').trim(), bad = nameProblem(dn);
    if (bad) { perr.textContent = t(bad); name.focus(); return; }
    busy(pbtn, true);
    let r; try { r = await S.sb.from('profiles').update({ display_name: dn, language: lang.value }).eq('id', me).select('display_name,language').maybeSingle(); } catch (x) { r = { error: x }; }
    busy(pbtn, false);
    if (r.error) { perr.textContent = errMsg(r.error); dirty(); return; }
    if (!r.data) { perr.textContent = t('err.forbidden'); return; }   // nothing was updated (not the owner / signed out)
    try { await loadProfile(); } catch { /* keep going: the change is saved */ }
    toast(t('set.saved'));
    if (lang.value !== getLang()) { await S.switchLang(); return; }
    name.value = S.profile.display_name; dirty();
  } },
    h('label.f', { for: 'dn' }, t('set.name')), name, h('div.hint', { id: 'dn-hint' }, t('set.name.hint')),
    h('label.f', { for: 'lg' }, t('set.lang')), lang, perr, h('div', { style: 'margin-top:12px' }, pbtn));

  // ---- switches (saved the moment they are flipped; reverted if saving fails) ----
  const sw = (field, title, desc) => {
    if (!Object.prototype.hasOwnProperty.call(S.profile, field)) return null;   // column not in this database yet
    const input = h('input', { type: 'checkbox', checked: !!S.profile[field] });
    input.onchange = async () => {
      input.disabled = true;
      const want = input.checked;
      let r; try { r = await S.sb.from('profiles').update({ [field]: want }).eq('id', me).select(field).maybeSingle(); } catch (e) { r = { error: e }; }
      input.disabled = false;
      if (r.error || !r.data) { input.checked = !want; toast(errMsg(r.error || {}), true); return; }
      S.profile[field] = r.data[field]; input.checked = !!r.data[field]; toast(t('set.saved'));
    };
    return h('label.switch', input, h('span', h('b', title), desc ? h('div.small.muted', desc) : null));
  };
  const locked = (title, desc) => h('label.switch.locked', h('input', { type: 'checkbox', checked: true, disabled: true }), h('span', h('b', title), h('div.small.muted', desc)));

  const privacy = section('privacy', 'lock', t('set.privacy'),
    sw('default_anonymous', t('set.anon'), t('set.anon.d')),
    h('p.small.muted', { style: 'margin:6px 0 0' }, t('set.privacy.d'), ' ', h('a', { href: '/privacy' }, t('privacy.title'))));
  const notif = section('notifications', 'bell', t('set.notif'),
    sw('notify_answers', t('set.n.answers')), sw('notify_followed', t('set.n.followed')), sw('notify_consult', t('set.n.consult')),
    locked(t('set.n.account'), t('set.n.always')));

  // ---- account security --------------------------------------------------------
  const verified = emailConfirmed();
  const resend = verified ? null : h('button.btn.ghost.sm', { type: 'button' }, icon('mail'), t('email.resend'));
  if (resend) resend.onclick = async () => {
    busy(resend, true);
    const r = await S.sb.auth.resendConfirmation(location.origin + '/');
    busy(resend, false);
    if (r.error) toast(errMsg(r.error), true); else { toast(t('email.sent')); resend.disabled = true; }
  };
  const pwField = (id, key, ac) => [h('label.f', { for: id }, t(key)), h('input', { id, type: 'password', maxlength: 72, autocomplete: ac })];
  const [l1, cur] = pwField('cpw', 'set.pw.cur', 'current-password'), [l2, pw] = pwField('npw', 'set.pw.new', 'new-password'), [l3, pw2] = pwField('npw2', 'set.pw.confirm', 'new-password');
  const aerr = h('div.err', { role: 'alert' });
  const abtn = h('button.btn.ghost.block', { type: 'submit' }, t('set.pw'));
  const pwForm = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); aerr.textContent = '';
    const bad = !cur.value ? ['set.pw.wrong', cur] : pwProblem(pw.value) ? ['set.pw.rule', pw] : pw.value !== pw2.value ? ['set.pw.mismatch', pw2] : pw.value === cur.value ? ['set.pw.same', pw] : null;
    if (bad) { aerr.textContent = t(bad[0]); bad[1].focus(); return; }
    busy(abtn, true);
    try {
      if (!(await S.sb.auth.verifyPassword(cur.value))) { aerr.textContent = t('set.pw.wrong'); cur.focus(); return; }
      const r = await S.sb.auth.updateUser({ password: pw.value });
      if (r.error) { aerr.textContent = errMsg(r.error); return; }
      cur.value = pw.value = pw2.value = ''; toast(t('set.pw.done'));
    } catch (x) { aerr.textContent = errMsg(x); }
    finally { busy(abtn, false); }
  } }, l1, cur, l2, pw, l3, pw2, h('div.hint', t('set.pw.rule')), aerr, h('div', { style: 'margin-top:12px' }, abtn));

  const outAll = h('button.btn.ghost.block', { type: 'button' }, icon('logout'), t('set.logoutall'));
  outAll.onclick = async () => {
    if (!(await confirmBox(t('set.logoutall'), t('set.logoutall.d'), t('set.logoutall'), t('cancel'), true))) return;
    outAll.disabled = true; await S.sb.auth.signOut('global'); toast(t('logout.done')); S.go('/', true);
  };

  const dl = h('button.btn.ghost.block', { type: 'button' }, icon('inbox'), t('set.data.go'));
  dl.onclick = async () => {
    busy(dl, true);
    try {
      const q = (table, col = 'user_id', cols = '*') => S.sb.from(table).select(cols).eq(col, me).limit(1000).then(r => r.error ? null : r.data);
      const parts = { profile: q('profiles', 'id'), questions: q('questions'), saved_answers: q('saved_answers'), followed_scholars: q('scholar_followers'),
        question_likes: q('question_likes'), helpful_marks: q('answer_helpful'), notifications: q('notifications'), consultations: q('consultations'),
        payments: q('payments', 'user_id', 'id,amount_paise,currency,status,purpose,created_at'), subscriptions: q('subscriptions', 'user_id', 'plan,status,current_period_end,created_at'),
        reports: q('reports', 'reporter_id'), messages_sent: q('messages', 'sender_id'), scholar_applications: q('scholar_applications'),
        ...(S.scholar ? { scholar_profile: q('scholars', 'id'), answers_written: q('answers', 'scholar_id') } : {}) };
      const keys = Object.keys(parts), vals = await Promise.all(Object.values(parts));
      const out = { exported_at: new Date().toISOString(), account: { id: me, email: S.user.email, email_confirmed: verified, created_at: S.user.created_at || null } };
      keys.forEach((k, i) => { if (vals[i]) out[k] = vals[i]; });
      const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      const a = h('a', { href: url, download: `alfrzo-ilm-my-data-${new Date().toISOString().slice(0, 10)}.json`, hidden: true });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(t('set.data.done'));
    } catch (x) { toast(errMsg(x), true); }
    busy(dl, false);
  };

  const security = section('security', 'shield', t('set.security'),
    h('div.small.muted', t('email')), h('div', { style: 'font-weight:700;word-break:break-all' }, S.user.email),
    h('div.row', { style: 'gap:8px;flex-wrap:wrap;margin:6px 0 4px' }, h('span.tag' + (verified ? '' : '.warn'), icon(verified ? 'check' : 'alert', ''), t(verified ? 'email.ok' : 'email.no')), resend),
    h('hr'), h('b', t('set.pw')), pwForm,
    h('hr'), h('b', t('set.sessions')), h('p.small.muted', t('set.sessions.d')), outAll,
    h('hr'), h('b', t('set.data')), h('p.small.muted', t('set.data.d')), dl);

  // ---- danger zone: password needed, then a final confirmation -------------------
  const delBtn = h('button.btn.danger.block', { type: 'button' }, icon('trash'), t('set.del'));
  delBtn.onclick = () => modal((sheet, close) => {
    const dpw = h('input', { id: 'delpw', type: 'password', autocomplete: 'current-password', maxlength: 72 });
    const derr = h('div.err', { role: 'alert' });
    const go = h('button.btn.sm.danger', { type: 'button' }, t('set.del.go'));
    go.onclick = async () => {
      derr.textContent = '';
      if (!dpw.value) { derr.textContent = t('set.pw.wrong'); dpw.focus(); return; }
      busy(go, true);
      try {
        if (!(await S.sb.auth.verifyPassword(dpw.value))) { derr.textContent = t('set.pw.wrong'); dpw.focus(); return; }
        // Files live in storage, outside the database cascade: remove them first.
        const imgs = await S.sb.from('questions').select('image_path').eq('user_id', me).f('image_path', 'not', 'is.null');
        const paths = (imgs.data || []).map(x => x.image_path).filter(Boolean);
        if (paths.length) await S.sb.storage.remove('question-images', paths);
        if (S.profile.avatar_path) await S.sb.storage.remove('avatars', [S.profile.avatar_path]);
        const r = await S.sb.rpc('delete_my_account');
        if (r.error) throw r.error;
        close(); await S.sb.auth.signOut();
        toast(t('set.deleted')); S.go('/', true);
      } catch (x) { derr.textContent = errMsg(x); }
      finally { if (go.isConnected) busy(go, false); }
    };
    sheet.append(h('h2', { style: 'color:var(--danger)' }, t('set.del')), h('p.muted', t('set.del.d')),
      h('label.f', { for: 'delpw' }, t('set.del.pw')), dpw, derr,
      h('div.row', { style: 'justify-content:flex-end;margin-top:14px;gap:8px' }, h('button.btn.ghost.sm', { type: 'button', onclick: close }, t('cancel')), go));
    setTimeout(() => dpw.focus(), 30);
  });
  const danger = h('section.card.set-sec.danger-zone', h('h3', { style: 'color:var(--danger)' }, icon('trash', ''), t('set.danger')), h('p.muted.small', t('set.del.d')), delBtn);

  const nav = h('nav.set-nav', { 'aria-label': t('set.title') }, [['profile', 'set.profile'], ['privacy', 'set.privacy'], ['notifications', 'set.notif'], ['security', 'set.security']]
    .map(([id, key]) => h('button.chip', { type: 'button', onclick: () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, t(key))));
  view.append(pageTitle(t('set.title')), nav, h('div.stack',
    section('profile', 'user', t('set.profile'), photoBox, profileForm), privacy, notif, security, danger));
}
