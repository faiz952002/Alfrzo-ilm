import { S, errMsg, requireAuth, catName } from '../store.js';
import { t, getLang } from '../i18n.js';
import '../i18n.pages.js';
import { h, icon, toast, confirmBox, busy, clear, timeAgo, CONTACT_RE } from '../ui.js';
import { pageTitle, skeletons } from '../components.js';

// Specialty chips shared by the application form and the scholar dashboard profile editor.
export function specialtyPicker(selected = []) {
  const chosen = new Set(selected);
  const box = h('div.chips', { role: 'group', 'aria-label': t('bs.spec') });
  const paint = () => {
    clear(box);
    S.cats.forEach(c => {
      const v = c.name_en; // stored in English so filtering works in both languages
      box.append(h('button.chip', { type: 'button', 'aria-pressed': String(chosen.has(v)), onclick: () => {
        if (chosen.has(v)) chosen.delete(v); else if (chosen.size < 10) chosen.add(v);
        paint();
      } }, c.icon + ' ' + catName(c)));
    });
  };
  paint();
  return { el: box, get value() { return [...chosen]; } };
}

export default async function becomeScholar(view, ctx) {
  ctx.setTitle(t('bs.title'));
  if (!requireAuth(ctx)) return;
  view.append(pageTitle(t('bs.title')));

  if (S.scholar) {
    view.append(h('div.card.center', h('span.tag', S.scholar.verified ? t('verified') : t('sch.pending')),
      h('p.muted', S.scholar.verified ? t('bs.already') : t('bs.already.pending')),
      h('a.btn.block', { href: '/dashboard' }, icon('dash'), t('dash.title'))));
    return;
  }

  const holder = h('div'); view.append(holder); holder.append(...skeletons(2));
  const r = await S.sb.from('scholar_applications').select('*').order('created_at', { ascending: false }).limit(5);
  if (!ctx.alive()) return;
  clear(holder);
  if (r.error) { holder.append(h('div.notice.bad', icon('alert'), h('div', errMsg(r.error)))); return; }
  const latest = r.data[0];

  if (latest?.status === 'pending') {
    const withdraw = h('button.btn.ghost.sm', { type: 'button', onclick: async () => {
      if (!(await confirmBox(t('bs.withdraw'), t('bs.withdraw.d'), t('bs.withdraw'), t('cancel'), true))) return;
      const d = await S.sb.from('scholar_applications').delete().eq('id', latest.id);
      if (d.error) return toast(errMsg(d.error), true);
      toast(t('bs.withdrawn')); S.go('/become-scholar', true);
    } }, t('bs.withdraw'));
    holder.append(h('div.card.center', h('span.tag.warn', icon('clock', ''), t('bs.pending')),
      h('p.muted', t('bs.pending.d')), h('div.small.muted', t('bs.sent') + ' ' + timeAgo(latest.created_at, getLang())), h('div', { style: 'margin-top:12px' }, withdraw)));
    return;
  }

  if (latest?.status === 'rejected') {
    holder.append(h('div.notice.bad', icon('info'), h('div', h('b', t('bs.rejected')), h('div', latest.admin_note || t('bs.rejected.d')))));
  }

  const quals = h('textarea', { id: 'bq', maxlength: 500, style: 'min-height:84px', dir: 'auto', required: true, placeholder: t('bs.quals.ph') });
  const bio = h('textarea', { id: 'bb', maxlength: 1500, style: 'min-height:110px', dir: 'auto', placeholder: t('bs.bio.ph') });
  const note = h('textarea', { id: 'bn', maxlength: 1000, style: 'min-height:90px', dir: 'auto', required: true, placeholder: t('bs.note.ph') });
  const picker = specialtyPicker([]);
  const err = h('div.err', { role: 'alert' });
  const btn = h('button.btn.block', { type: 'submit' }, icon('send'), t('bs.submit'));
  const form = h('form.card', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const q = quals.value.trim(), b = bio.value.trim(), n = note.value.trim(), sp = picker.value;
    if (q.length < 5) { err.textContent = t('bs.err.quals'); quals.focus(); return; }
    if (n.length < 10) { err.textContent = t('bs.err.note'); note.focus(); return; }
    if (!sp.length) { err.textContent = t('bs.err.spec'); return; }
    if (CONTACT_RE.test(q + ' ' + b)) { err.textContent = t('err.contact'); return; }
    busy(btn, true);
    const ins = await S.sb.from('scholar_applications').insert({ user_id: S.user.id, qualifications: q, specialties: sp, bio: b, credentials_note: n });
    busy(btn, false);
    if (ins.error) { err.textContent = /ALREADY_SCHOLAR/.test(ins.error.message) ? t('bs.already') : errMsg(ins.error); return; }
    toast(t('bs.done')); S.go('/become-scholar', true);
  } },
    h('div.notice', icon('info'), h('div', t('bs.intro'))),
    h('label.f', { for: 'bq', style: 'margin-top:0' }, t('bs.quals')), quals,
    h('label.f', t('bs.spec')), picker.el, h('div.hint', t('bs.spec.d')),
    h('label.f', { for: 'bb' }, t('bs.bio')), bio,
    h('label.f', { for: 'bn' }, t('bs.note')), note, h('div.hint', icon('lock', ''), ' ', t('bs.note.d')),
    err, h('div', { style: 'margin-top:14px' }, btn));
  holder.append(form);
}
