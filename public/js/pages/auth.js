import { S, errMsg, loadProfile } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, logo, toast, clear } from '../ui.js';

const safeNext = n => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') && !n.startsWith('/signup')) ? n : '/';

export default async function auth(view, ctx) {
  const mode = ctx.path.replace('/', '');
  ctx.setTitle(t('auth.' + mode));
  const next = safeNext(ctx.query.get('next'));
  if (S.user && (mode === 'login' || mode === 'signup')) return S.go(next, true);
  const wrap = h('div.authwrap');
  view.append(wrap);
  const head = (title, sub) => wrap.append(h('div.logo-lg', logo(78)), h('h1.center', { style: 'color:var(--em-800);font-size:23px' }, title), h('p.center.muted', sub));
  const err = h('div.err', { role: 'alert' });
  const field = (id, label, attrs) => [h('label.f', { for: id }, label), h('input', { id, required: true, ...attrs })];
  const submit = (label, fn) => {
    const f = h('form.card', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const b = f.querySelector('button[type=submit]'); b.disabled = true;
      try { await fn(); } catch (x) { err.textContent = errMsg(x); }
      b.disabled = false;
    } });
    return { f };
  };

  if (mode === 'login') {
    head(t('auth.login.h'), t('auth.login.d'));
    const em = field('em', t('email'), { type: 'email', autocomplete: 'username', inputmode: 'email' }), pw = field('pw', t('password'), { type: 'password', autocomplete: 'current-password' });
    let fails = 0;
    const { f } = submit(t('login'), async () => {
      if (fails >= 5) { err.textContent = t('auth.slow'); await new Promise(r => setTimeout(r, 4000)); }
      const r = await S.sb.auth.signIn(em[1].value.trim(), pw[1].value);
      if (r.error) { fails++; throw r.error; }
      await loadProfile(); S.pollUnread(); toast(t('auth.welcome')); S.go(next, true);
    });
    f.append(...em, ...pw, err, h('div', { style: 'text-align:right;margin-top:8px' }, h('a.small', { href: '/forgot' }, t('auth.forgot'))), h('button.btn.block', { type: 'submit', style: 'margin-top:14px' }, t('login')));
    wrap.append(f, h('p.center', t('auth.noacct'), ' ', h('a', { href: '/signup' + (next !== '/' ? '?next=' + encodeURIComponent(next) : '') }, t('signup'))));
  } else if (mode === 'signup') {
    head(t('auth.signup.h'), t('auth.signup.d'));
    const nm = field('nm', t('auth.name'), { type: 'text', maxlength: 60, autocomplete: 'nickname' }), em = field('em', t('email'), { type: 'email', autocomplete: 'email', inputmode: 'email' }),
      pw = field('pw', t('password'), { type: 'password', minlength: 8, autocomplete: 'new-password' });
    const agree = h('input', { type: 'checkbox', id: 'ag' });
    const { f } = submit(t('signup'), async () => {
      if (!nm[1].value.trim()) throw { message: t('auth.err.name') };
      if (pw[1].value.length < 8) throw { message: t('err.weak') };
      if (!agree.checked) throw { message: t('auth.err.agree') };
      const r = await S.sb.auth.signUp(em[1].value.trim(), pw[1].value, nm[1].value.trim());
      if (r.error) throw r.error;
      if (r.needsConfirmation) { clear(wrap); head(t('auth.check.t'), t('auth.check.d', { email: em[1].value.trim() })); wrap.append(h('a.btn.block', { href: '/login' }, t('login'))); return; }
      await loadProfile(); toast(t('auth.welcome')); S.go(next, true);
    });
    f.append(...nm, ...em, ...pw, h('div.hint', t('auth.pw.hint')), h('label.switch', agree, h('span.small', t('auth.agree'), ' ', h('a', { href: '/privacy' }, t('privacy.title')))), err);
    f.append(h('button.btn.block', { type: 'submit' }, t('signup')));
    wrap.append(f, h('p.center', t('auth.haveacct'), ' ', h('a', { href: '/login' }, t('login'))));
  } else if (mode === 'forgot') {
    head(t('auth.forgot.h'), t('auth.forgot.d'));
    const em = field('em', t('email'), { type: 'email', autocomplete: 'email' });
    const { f } = submit(t('auth.forgot.send'), async () => {
      const r = await S.sb.auth.resetPassword(em[1].value.trim(), location.origin + '/reset');
      if (r.error && r.error.status !== 400 && r.error.status !== 422) throw r.error;
      clear(wrap); head(t('auth.check.t'), t('auth.forgot.done')); wrap.append(h('a.btn.ghost.block', { href: '/login' }, t('login')));
    });
    f.append(...em, err, h('button.btn.block', { type: 'submit', style: 'margin-top:14px' }, t('auth.forgot.send')));
    wrap.append(f, h('p.center', h('a', { href: '/login' }, t('login'))));
  } else if (mode === 'reset') {
    if (!S.user) { head(t('auth.reset.h'), t('auth.reset.expired')); wrap.append(h('a.btn.block', { href: '/forgot' }, t('auth.forgot.send'))); return; }
    head(t('auth.reset.h'), t('auth.reset.d'));
    const pw = field('pw', t('auth.newpw'), { type: 'password', minlength: 8, autocomplete: 'new-password' });
    const { f } = submit(t('auth.reset.save'), async () => {
      if (pw[1].value.length < 8) throw { message: t('err.weak') };
      const r = await S.sb.auth.updateUser({ password: pw[1].value }); if (r.error) throw r.error;
      toast(t('auth.reset.done')); S.go('/', true);
    });
    f.append(...pw, h('div.hint', t('auth.pw.hint')), err, h('button.btn.block', { type: 'submit', style: 'margin-top:14px' }, t('auth.reset.save')));
    wrap.append(f);
  }
}
