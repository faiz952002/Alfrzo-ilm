import { S, errMsg, requireAuth, isScholarRole, isVerifiedScholar, loadProfile, catById, catName } from '../store.js';
import { t, getLang } from '../i18n.js';
import '../i18n.pages.js';
import { h, icon, toast, clear, timeAgo, busy, confirmBox, CONTACT_RE } from '../ui.js';
import { pageTitle, skeletons, empty, errorBox, catTag } from '../components.js';
import { specialtyPicker } from './becomescholar.js';
import { consultCard, housekeeping } from './consultations.js';
import { whenText } from './consult.js';

// Scholar dashboard: question queue, my answers, my public profile.
// The queue is the `scholar_queue` view: it never contains who asked (only a Premium priority flag).
export default async function dashboard(view, ctx) {
  ctx.setTitle(t('dash.title'));
  if (!requireAuth(ctx)) return;
  if (!isScholarRole()) { S.go('/become-scholar', true); return; }
  let tab = ctx.query.get('tab') || 'queue';
  const body = h('div'), tabs = h('div.utabs', { role: 'tablist' });
  const stats = h('div.card.stat3');

  view.append(pageTitle(t('dash.title')));
  if (!isVerifiedScholar()) view.append(h('div.notice.warn', icon('clock'), h('div', t(S.profile.suspended ? 'err.suspended' : 'sa.notverified'))));
  view.append(stats, tabs, body);

  const paintTabs = () => {
    clear(tabs);
    [['queue', 'dash.queue'], ['mine', 'dash.mine'], ['consults', 'dash.consults'], ['reels', 'dash.reels'], ['profile', 'dash.profile']].forEach(([k, lk]) =>
      tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; history.replaceState(null, '', '/dashboard?tab=' + k); paintTabs(); show(); } }, t(lk))));
  };
  const show = () => { clear(body); (({ queue, mine, consults, reels: reelsTab, profile })[tab] || queue)(); };

  // ---- stats ---------------------------------------------------------------
  (async () => {
    const [sd, mineCount] = await Promise.all([
      S.sb.from('scholar_directory').select('followers_count,answers_count').eq('id', S.user.id).maybeSingle(),
      S.sb.from('answers').select('id', { count: 'exact' }).eq('scholar_id', S.user.id).limit(1),
    ]);
    if (!ctx.alive()) return;
    const cell = (n, k) => h('div', h('b', String(n ?? 0)), h('span.small.muted', t(k)));
    clear(stats); stats.append(cell(mineCount.count, 'answers'), cell(sd.data?.followers_count, 'followers'), cell(S.scholar?.verified ? '✓' : '…', 'verified'));
  })();

  // ---- queue ----------------------------------------------------------------
  async function queue() {
    let onlyMine = false, cat = null;
    const list = h('div'), chips = h('div.chips');
    const myNames = () => (S.scholar?.specialties || []).map(s => s.toLowerCase());
    let rows = null;
    const paintChips = () => {
      clear(chips);
      chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(onlyMine), onclick: () => { onlyMine = !onlyMine; paintChips(); render(); } }, icon('star', ''), t('dash.mine.spec')));
      chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(!cat), onclick: () => { cat = null; paintChips(); render(); } }, t('cat.all')));
      S.cats.forEach(c => chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(cat === c.id), onclick: () => { cat = c.id; paintChips(); render(); } }, c.icon + ' ' + catName(c))));
    };
    body.append(h('p.muted.small', { style: 'margin:0 0 8px' }, t('dash.queue.d')), chips, list); paintChips(); list.append(...skeletons(3));
    const [q, a] = await Promise.all([
      S.sb.from('scholar_queue').select('*').eq('status', 'open').order('created_at').limit(60),
      S.sb.from('answers').select('question_id').eq('scholar_id', S.user.id).limit(500),
    ]);
    if (!ctx.alive() || tab !== 'queue') return;
    if (q.error) { clear(list); list.append(errorBox(() => show())); return; }
    const done = new Set((a.data || []).map(x => x.question_id));
    // Premium questions first (priority answers), then oldest first.
    rows = q.data.filter(x => !done.has(x.id)).sort((x, y) => (y.is_premium - x.is_premium) || (new Date(x.created_at) - new Date(y.created_at)));
    render();
    function render() {
      clear(list);
      const items = rows.filter(x => (!cat || x.category_id === cat) && (!onlyMine || (() => { const c = catById(x.category_id); return c && myNames().some(n => n === c.name_en.toLowerCase()); })()));
      if (!items.length) { list.append(empty('inbox', t('dash.queue.empty'))); return; }
      items.forEach(x => list.append(h('a.card.q', { href: `/q/${x.id}` },
        h('div.meta', catTag(x.category_id), h('span', timeAgo(x.created_at, getLang())), x.is_premium ? h('span.tag.gold', icon('crown', ''), t('dash.priority')) : null, x.visibility === 'private' ? h('span.tag.blue', icon('lock', ''), t('qd.private')) : null),
        h('h3', { dir: 'auto' }, x.title), x.body ? h('div.excerpt', { dir: 'auto' }, x.body) : null,
        h('div.foot', h('span.small.muted', `${x.answers_count} ${t('answers')}`), h('span.tag.gold', icon('edit', ''), t('sa.write'))))));
    }
  }

  // ---- my answers -----------------------------------------------------------
  async function mine() {
    const list = h('div'); body.append(list); list.append(...skeletons(2));
    const a = await S.sb.from('answers').select('id,question_id,body,status,created_at,updated_at,helpful_count').eq('scholar_id', S.user.id).order('created_at', { ascending: false }).limit(50);
    if (!ctx.alive() || tab !== 'mine') return;
    clear(list);
    if (a.error) { list.append(errorBox(() => show())); return; }
    if (!a.data.length) { list.append(empty('inbox', t('dash.mine.empty'))); return; }
    const qs = await S.sb.from('question_feed').select('id,title').in('id', [...new Set(a.data.map(x => x.question_id))]);
    const titles = new Map((qs.data || []).map(x => [x.id, x.title]));
    if (!ctx.alive() || tab !== 'mine') return;
    a.data.forEach(x => list.append(h('a.card.q', { href: `/q/${x.question_id}` },
      h('h3', { dir: 'auto' }, titles.get(x.question_id) || '…'), h('div.excerpt', { dir: 'auto' }, x.body),
      h('div.foot', x.status === 'hidden' ? h('span.tag.red', t('dash.hidden')) : h('span.tag', icon('check', ''), t('dash.published')),
        h('span.small.muted', `👍 ${x.helpful_count} · ${timeAgo(x.created_at, getLang())}`)))));
  }

  // ---- public profile ---------------------------------------------------------
  function profile() {
    const sc = S.scholar;
    const quals = h('textarea', { maxlength: 500, style: 'min-height:84px', dir: 'auto' }); quals.value = sc.qualifications || '';
    const bio = h('textarea', { maxlength: 1500, style: 'min-height:120px', dir: 'auto' }); bio.value = sc.bio || '';
    const picker = specialtyPicker(sc.specialties || []);
    const err = h('div.err', { role: 'alert' });
    const btn = h('button.btn.block', { type: 'submit' }, t('set.save'));
    body.append(h('form.card', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (quals.value.trim().length < 5) { err.textContent = t('bs.err.quals'); return; }
      if (CONTACT_RE.test(quals.value + ' ' + bio.value)) { err.textContent = t('err.contact'); return; }
      busy(btn, true);
      const r = await S.sb.from('scholars').update({ qualifications: quals.value.trim(), bio: bio.value.trim(), specialties: picker.value }).eq('id', S.user.id);
      busy(btn, false);
      if (r.error) { err.textContent = errMsg(r.error); return; }
      await loadProfile(); toast(t('set.saved'));
    } },
      h('div.notice', icon('info'), h('div', t('dash.profile.d'))),
      h('label.f', { style: 'margin-top:0' }, t('bs.quals')), quals, h('label.f', t('bs.spec')), picker.el, h('label.f', t('bs.bio')), bio, err, h('div', { style: 'margin-top:14px' }, btn)),
      h('a.btn.ghost.block', { href: `/scholar/${S.user.id}`, style: 'margin-top:10px' }, t('dash.viewpublic')));
  }

  // ---- consultations: my services, my open times, my bookings ------------------
  async function consults() {
    const svcCard = h('div.card'), slotCard = h('div.card'), bookings = h('div');
    body.append(svcCard, slotCard, h('div.section-h', h('h2', t('dash.bookings'))), bookings);
    const sv = await S.sb.from('scholar_services').select('*').eq('scholar_id', S.user.id);
    if (!ctx.alive() || tab !== 'consults') return;
    const rows = ['audio', 'video', 'chat'].map(kind => {
      const ex = (sv.data || []).find(x => x.kind === kind);
      const on = h('input', { type: 'checkbox', checked: !!ex?.active });
      const price = h('input', { type: 'number', min: 0, max: 100000, step: 1, value: ex ? ex.price_paise / 100 : 0, 'aria-label': `${t('consult.' + kind)}: ${t('dash.price')}`, style: 'padding:10px 8px' });
      const dur = h('select', { 'aria-label': `${t('consult.' + kind)}: ${t('dash.duration')}`, style: 'padding:10px 6px' }, [15, 30, 45, 60].map(n => h('option', { value: n }, t('consult.min', { n }))));
      dur.value = String(ex?.duration_min || 30);
      return { kind, ex, on, price, dur };
    });
    const serr = h('div.err', { role: 'alert' });
    const sbtn = h('button.btn.sm', { type: 'button' }, t('set.save'));
    sbtn.onclick = async () => {
      serr.textContent = ''; busy(sbtn, true);
      for (const r of rows) {
        const vals = { price_paise: Math.max(0, Math.round(Number(r.price.value || 0) * 100)), duration_min: Number(r.dur.value), active: r.on.checked };
        const q = r.ex ? await S.sb.from('scholar_services').update(vals).eq('id', r.ex.id)
          : r.on.checked ? await S.sb.from('scholar_services').insert({ scholar_id: S.user.id, kind: r.kind, ...vals }) : { error: null };
        if (q.error) { busy(sbtn, false); serr.textContent = errMsg(q.error); return; }
      }
      busy(sbtn, false); toast(t('set.saved')); show();
    };
    svcCard.append(h('h3', t('dash.svc')), h('p.small.muted', { style: 'margin:4px 0 8px' }, t('dash.svc.d')),
      h('div.svcrow.head', h('span'), h('span', t('dash.price')), h('span', t('dash.duration'))),
      ...rows.map(r => h('div.svcrow', h('label.switch', { style: 'padding:0' }, r.on, h('b', t('consult.' + r.kind))), r.price, r.dur)), serr, h('div', { style: 'margin-top:10px' }, sbtn));

    // open times
    const when = h('input', { type: 'datetime-local', id: 'sl', 'aria-label': t('dash.addslot'), style: 'min-width:0;flex:1' }), slotList = h('div'), lerr = h('div.err', { role: 'alert' });
    const addBtn = h('button.btn.sm', { type: 'button' }, icon('plus'), t('dash.addslot'));
    async function loadSlots() {
      await housekeeping();
      const r = await S.sb.from('scholar_slots').select('*').eq('scholar_id', S.user.id).gt('starts_at', new Date().toISOString()).order('starts_at').limit(100);
      if (!ctx.alive() || tab !== 'consults') return; clear(slotList);
      if (!(r.data || []).length) return slotList.append(h('p.small.muted', t('dash.noslots')));
      r.data.forEach(x => slotList.append(h('div.row', { style: 'justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)' }, h('span', whenText(x.starts_at)),
        x.status === 'open' ? h('button.act', { type: 'button', 'aria-label': t('delete'), onclick: async () => { const d = await S.sb.from('scholar_slots').delete().eq('id', x.id); if (d.error) return toast(errMsg(d.error), true); loadSlots(); } }, icon('trash'))
          : h('span.tag' + (x.status === 'booked' ? '' : '.warn'), t(x.status === 'booked' ? 'consult.st.confirmed' : 'consult.st.pending_payment')))));
    }
    addBtn.onclick = async () => {
      lerr.textContent = ''; const d = new Date(when.value);
      if (!when.value || isNaN(d) || d.getTime() <= Date.now()) { lerr.textContent = t('dash.slot.err'); return; }
      busy(addBtn, true);
      const r = await S.sb.from('scholar_slots').insert({ scholar_id: S.user.id, starts_at: d.toISOString() });
      busy(addBtn, false);
      if (r.error) { lerr.textContent = errMsg(r.error); return; }
      when.value = ''; toast(t('dash.slot.added')); loadSlots();
    };
    slotCard.append(h('h3', t('dash.slots')), h('div.row', { style: 'gap:8px;margin:8px 0' }, when, addBtn), lerr, slotList);
    loadSlots();

    async function loadBookings() {
      clear(bookings); bookings.append(...skeletons(1));
      await housekeeping();
      const r = await S.sb.from('consultation_list').select('*').eq('i_am_client', false).eq('scholar_id', S.user.id).order('starts_at', { ascending: false }).limit(50);
      if (!ctx.alive() || tab !== 'consults') return; clear(bookings);
      if (r.error) return bookings.append(errorBox(loadBookings));
      if (!r.data.length) return bookings.append(empty('calendar', t('dash.nobookings')));
      r.data.forEach(k => bookings.append(consultCard(k, loadBookings)));
    }
    loadBookings();
  }

  // ---- reels: upload + my reels ---------------------------------------------------
  function reelsTab() {
    const OK = { 'video/mp4': 'mp4', 'video/webm': 'webm' }, MAX = 30 * 1024 * 1024;
    const file = h('input', { type: 'file', id: 'rf', accept: 'video/mp4,video/webm', style: 'padding:9px' });
    const cap = h('textarea', { id: 'rc', maxlength: 300, style: 'min-height:70px', dir: 'auto', placeholder: t('reel.caption.ph') });
    const cat = h('select', { id: 'rk' }, h('option', { value: '' }, t('ask.pickcat')), S.cats.map(c => h('option', { value: c.id }, c.icon + ' ' + catName(c))));
    const err = h('div.err', { role: 'alert' }), btn = h('button.btn.block', { type: 'submit' }, icon('upload'), t('reel.upload')), mineBox = h('div');
    const form = h('form.card', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const f = file.files[0], c = cap.value.trim();
      if (!f || !OK[f.type] || f.size > MAX) { err.textContent = t('reel.file.err'); return; }
      if (c.length < 3) { err.textContent = t('reel.err.caption'); cap.focus(); return; }
      if (CONTACT_RE.test(c)) { err.textContent = t('err.contact'); return; }
      btn.disabled = true; btn.lastChild.textContent = t('reel.uploading');
      const path = `${S.user.id}/${crypto.randomUUID()}.${OK[f.type]}`;
      const up = await S.sb.storage.upload('reels', path, f);
      const ins = up.error ? up : await S.sb.from('reels').insert({ scholar_id: S.user.id, video_path: path, caption: c, category_id: cat.value ? Number(cat.value) : null });
      btn.disabled = false; btn.lastChild.textContent = t('reel.upload');
      if (ins.error) { if (!up.error) S.sb.storage.remove('reels', [path]); err.textContent = errMsg(ins.error); return; }
      file.value = ''; cap.value = ''; toast(t('reel.uploaded')); loadMine();
    } }, h('h3', t('reel.upload')), h('label.f', { for: 'rf' }, t('reel.file')), file, h('label.f', { for: 'rc' }, t('reel.caption')), cap, h('label.f', { for: 'rk' }, t('ask.cat')), cat, err, h('div', { style: 'margin-top:12px' }, btn));
    async function loadMine() {
      clear(mineBox);
      const r = await S.sb.from('reels').select('*').eq('scholar_id', S.user.id).order('created_at', { ascending: false }).limit(50);
      if (!ctx.alive() || tab !== 'reels') return;
      if (!(r.data || []).length) return mineBox.append(h('p.small.muted.center', t('reel.none')));
      r.data.forEach(x => mineBox.append(h('div.card.row', h('div.grow', h('div', { dir: 'auto', style: 'font-weight:700' }, x.caption),
          h('div.small.muted', `♥ ${x.likes_count} · ▶ ${x.views_count} · ${timeAgo(x.created_at, getLang())}`), x.status === 'hidden' ? h('span.tag.red', t('dash.hidden')) : null),
        h('button.act', { type: 'button', 'aria-label': t('delete'), onclick: async () => {
          if (!(await confirmBox(t('delete'), x.caption, t('delete'), t('cancel'), true))) return;
          const d = await S.sb.from('reels').delete().eq('id', x.id); if (d.error) return toast(errMsg(d.error), true);
          S.sb.storage.remove('reels', [x.video_path]); toast(t('reel.deleted')); loadMine();
        } }, icon('trash')))));
    }
    body.append(form, h('div.section-h', h('h2', t('reel.mine'))), mineBox, h('a.btn.ghost.block', { href: '/reels', style: 'margin-top:10px' }, icon('video'), t('home.reels')));
    loadMine();
  }

  paintTabs(); show();
}
