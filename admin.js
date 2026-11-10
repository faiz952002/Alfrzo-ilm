import { S, errMsg, requireAuth, isAdmin, catName, loadCategories } from '../store.js';
import { h, icon, toast, clear, timeAgo, confirmBox, modal, busy, fmtMoney, debounce } from '../ui.js';
import { pageTitle, skeletons, empty, errorBox, catTag } from '../components.js';

// Admin panel. The UI check below is only for convenience: every action is an RPC / table write that the
// database authorises with is_admin() (see supabase/schema.sql), so a non-admin gets "FORBIDDEN" from the server.
// Admin tooling is English-only on purpose (operator-facing).
const TABS = [['overview', 'Overview'], ['moderation', 'Questions'], ['reports', 'Reports'], ['scholars', 'Scholars'], ['consults', 'Consultations'], ['users', 'Users'], ['categories', 'Categories'], ['payments', 'Payments'], ['audit', 'Audit log']];
const ago = d => timeAgo(d, 'en');

export default async function admin(view, ctx) {
  ctx.setTitle('Admin');
  if (!requireAuth(ctx)) return;
  if (!isAdmin()) { view.append(pageTitle('Admin'), h('div.notice.bad', icon('alert'), h('div', 'Administrators only.'))); return; }
  let tab = ctx.query.get('tab') || 'overview';
  const chips = h('div.chips', { style: 'margin-bottom:12px' }), body = h('div');
  view.append(pageTitle('Admin panel'), chips, body);
  const paintTabs = () => { clear(chips); TABS.forEach(([k, l]) => chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; history.replaceState(null, '', '/admin?tab=' + k); paintTabs(); show(); } }, l))); };
  const live = () => ctx.alive();
  const loading = () => { clear(body); body.append(...skeletons(2)); };
  const show = () => { loading(); const fn = { overview, moderation, reports, scholars, consults, users, categories, payments, audit }[tab]; fn().catch(e => { if (live()) { clear(body); body.append(errorBox(show)); console.error(e); } }); };
  // run an RPC, toast the result, then refresh the current tab
  const act = async (btn, fn, args, ok) => {
    busy(btn, true); const r = await S.sb.rpc(fn, args); busy(btn, false);
    if (r.error) { toast(r.error.message?.match(/^[A-Z_]{4,}/)?.[0] || errMsg(r.error), true); return false; }
    toast(ok); return true;
  };
  const btn = (label, cls, fn) => h('button.btn.sm' + (cls ? '.' + cls : ''), { type: 'button', onclick: fn }, label);

  // ---------------------------------------------------------------------------
  async function overview() {
    const r = await S.sb.rpc('admin_stats'); if (!live()) return; clear(body);
    if (r.error) return body.append(errorBox(show));
    const s = r.data;
    const K = [['Users', s.users], ['Verified scholars', s.scholars], ['Questions', s.questions], ['Waiting for review', s.pending], ['Answered', s.answered], ['Answers', s.answers],
      ['Open reports', s.open_reports], ['Active Premium', s.active_subscriptions], ['Questions (7 days)', s.questions_7d], ['Answers (7 days)', s.answers_7d], ['Revenue (paid)', fmtMoney(s.revenue_paise || 0)]];
    body.append(h('div.kpis', K.map(([l, v]) => h('div.kpi', h('b', String(v ?? 0)), h('span.small.muted', l)))));
    if (s.pending > 0) body.append(h('div.notice.warn', { style: 'margin-top:12px' }, icon('clock'), h('div', `${s.pending} question(s) waiting for review. `, h('a', { href: '/admin?tab=moderation' }, 'Review now'))));
    if (s.open_reports > 0) body.append(h('div.notice.bad', icon('flag'), h('div', `${s.open_reports} open report(s). `, h('a', { href: '/admin?tab=reports' }, 'Open reports'))));
  }

  // ---------------------------------------------------------------------------
  async function moderation() {
    let st = 'pending_review';
    const list = h('div'), sub = h('div.chips');
    const paint = () => { clear(sub); [['pending_review', 'Waiting for review'], ['open', 'Published (open)']].forEach(([k, l]) => sub.append(h('button.chip', { type: 'button', 'aria-pressed': String(st === k), onclick: () => { st = k; paint(); load(); } }, l))); };
    clear(body); body.append(sub, list); paint();
    async function load() {
      clear(list); list.append(...skeletons(2));
      const r = await S.sb.from('scholar_queue').select('*').eq('status', st).order('created_at').limit(50);
      if (!live()) return; clear(list);
      if (r.error) return list.append(errorBox(load));
      if (!r.data.length) return list.append(empty('check', st === 'pending_review' ? 'Nothing is waiting for review.' : 'No open questions.'));
      r.data.forEach(q => {
        const card = h('div.card.q', h('div.meta', catTag(q.category_id), h('span', ago(q.created_at)), q.language ? h('span.tag', q.language.toUpperCase()) : null),
          h('h3', { dir: 'auto' }, q.title), q.body ? h('div.excerpt', { dir: 'auto', style: 'display:block;-webkit-line-clamp:unset' }, q.body) : null);
        const row = h('div.row', { style: 'margin-top:10px;flex-wrap:wrap' });
        if (q.image_path) row.append(btn('View image', 'ghost', async () => {
          const u = await S.sb.storage.signedUrl('question-images', q.image_path, 300);
          if (u.error) return toast(errMsg(u.error), true);
          modal(sheet => sheet.append(h('img', { src: u.url, alt: 'Attached image', style: 'max-width:100%;border-radius:12px' })));
        }));
        if (st === 'pending_review') {
          row.append(btn('Approve', '', async e => { if (await act(e.target, 'moderate_question', { p_id: q.id, p_status: 'open' }, 'Approved')) card.remove(); }),
            btn('Reject', 'danger', async e => { if (await act(e.target, 'moderate_question', { p_id: q.id, p_status: 'rejected' }, 'Rejected')) card.remove(); }));
        } else {
          row.append(btn('Unpublish', 'danger', async e => { if (!(await confirmBox('Unpublish question', 'It will be hidden from everyone.', 'Unpublish', 'Cancel', true))) return; if (await act(e.target, 'admin_hide_content', { p_type: 'question', p_id: q.id }, 'Unpublished')) card.remove(); }),
            h('a.btn.ghost.sm', { href: `/q/${q.id}` }, 'Open'));
        }
        card.append(row); list.append(card);
      });
    }
    load();
  }

  // ---------------------------------------------------------------------------
  async function reports() {
    const r = await S.sb.rpc('admin_reports'); if (!live()) return; clear(body);
    if (r.error) return body.append(errorBox(show));
    if (!r.data.length) return body.append(empty('check', 'No reports.'));
    r.data.forEach(x => {
      const card = h('div.card', h('div.row', { style: 'flex-wrap:wrap' }, h('span.tag' + (x.status === 'open' ? '.red' : ''), x.status), h('span.tag', x.target_type), h('span.small.muted', ago(x.created_at))),
        h('p', { style: 'margin:8px 0 4px' }, h('b', 'Reason: '), x.reason), x.snippet ? h('blockquote', { dir: 'auto', style: 'margin:6px 0;padding:8px 12px;border-left:3px solid var(--line);color:var(--muted)' }, x.snippet) : h('p.small.muted', 'Content no longer exists.'));
      if (x.status === 'open') {
        card.append(h('div.row', { style: 'flex-wrap:wrap;margin-top:8px' },
          x.target_type === 'question' ? h('a.btn.ghost.sm', { href: `/q/${x.target_id}` }, 'Open') : null,
          !['question', 'answer', 'reel'].includes(x.target_type) ? null : btn('Hide content', 'danger', async e => { if (!(await confirmBox('Hide content', 'Hide the reported content and resolve the report?', 'Hide', 'Cancel', true))) return; if (await act(e.target, 'admin_hide_content', { p_type: x.target_type, p_id: x.target_id }, 'Content hidden') && await act(e.target, 'resolve_report', { p_id: x.id, p_status: 'resolved' }, 'Resolved')) show(); }),
          btn('Mark resolved', '', async e => { if (await act(e.target, 'resolve_report', { p_id: x.id, p_status: 'resolved' }, 'Resolved')) show(); }),
          btn('Dismiss', 'ghost', async e => { if (await act(e.target, 'resolve_report', { p_id: x.id, p_status: 'dismissed' }, 'Dismissed')) show(); })));
      }
      body.append(card);
    });
  }

  // ---------------------------------------------------------------------------
  async function consults() {
    const r = await S.sb.from('consultation_list').select('*').order('starts_at', { ascending: false }).limit(100); if (!live()) return; clear(body);
    if (r.error) return body.append(errorBox(show));
    if (!r.data.length) return body.append(empty('calendar', 'No consultations yet.'));
    const due = r.data.filter(k => k.refund_due);
    if (due.length) body.append(h('div.notice.bad', icon('alert'), h('div', `${due.length} cancelled paid booking(s) need a refund. Refund in the Razorpay dashboard, then press "Refund done".`)));
    [...due, ...r.data.filter(k => !k.refund_due)].forEach(k => body.append(h('div.card', h('div.row', { style: 'flex-wrap:wrap' }, h('span.tag', k.kind), h('span.tag' + (k.status === 'cancelled' ? '.red' : k.status === 'pending_payment' ? '.warn' : ''), k.status), k.refund_due ? h('span.tag.gold', 'refund due') : null),
      h('p', { style: 'margin:8px 0 2px' }, h('b', k.scholar_name), ' with ', k.client_name || 'anonymous user'), h('div.small.muted', `${new Date(k.starts_at).toLocaleString('en-IN')} · ${k.duration_min} min · ${fmtMoney(k.price_paise)}`),
      k.refund_due ? h('div', { style: 'margin-top:8px' }, btn('Refund done', '', async e => { if (await act(e.target, 'admin_refund_done', { p_id: k.id }, 'Marked as refunded')) show(); })) : null)));
  }

  // ---------------------------------------------------------------------------
  async function scholars() {
    const [apps, list] = await Promise.all([S.sb.rpc('admin_list_applications'), S.sb.rpc('admin_list_scholars')]); if (!live()) return; clear(body);
    if (apps.error || list.error) return body.append(errorBox(show));
    body.append(h('div.section-h', h('h2', `Applications (${apps.data.filter(a => a.status === 'pending').length} pending)`)));
    if (!apps.data.length) body.append(empty('inbox', 'No applications yet.'));
    apps.data.forEach(a => {
      const note = h('input', { maxlength: 500, placeholder: 'Note to applicant (optional)' });
      const card = h('div.card', h('div.row', { style: 'flex-wrap:wrap' }, h('b', a.display_name), h('span.small.muted', a.email), h('span.tag' + (a.status === 'pending' ? '.warn' : a.status === 'approved' ? '' : '.red'), a.status), h('span.small.muted', ago(a.created_at))),
        h('p', { style: 'margin:8px 0 2px' }, h('b', 'Qualifications: '), a.qualifications), a.specialties?.length ? h('div.small', h('b', 'Specialties: '), a.specialties.join(', ')) : null,
        a.bio ? h('p.small', { style: 'margin:4px 0' }, h('b', 'Bio: '), a.bio) : null,
        h('div.notice', { style: 'margin:8px 0' }, icon('lock'), h('div', h('b', 'Private credentials note: '), a.credentials_note)),
        a.admin_note ? h('div.small.muted', 'Decision note: ' + a.admin_note) : null);
      if (a.status === 'pending') card.append(note, h('div.row', { style: 'margin-top:8px' },
        btn('Approve & verify', '', async e => { if (await act(e.target, 'admin_review_application', { p_id: a.id, p_approve: true, p_note: note.value }, 'Scholar verified')) show(); }),
        btn('Reject', 'danger', async e => { if (await act(e.target, 'admin_review_application', { p_id: a.id, p_approve: false, p_note: note.value }, 'Rejected')) show(); })));
      body.append(card);
    });
    body.append(h('div.section-h', h('h2', 'Scholars')));
    if (!list.data.length) body.append(empty('scholars', 'No scholar accounts.'));
    list.data.forEach(s => body.append(h('div.card.row', h('div.grow', h('b', s.display_name), ' ', h('span.small.muted', s.email), h('div.small.muted', `${s.qualifications || '—'} · ${s.answers_count} answers`),
      h('div', { style: 'margin-top:4px' }, h('span.tag' + (s.verified ? '' : '.warn'), s.verified ? 'verified' : 'not verified'), s.suspended ? h('span.tag.red', 'suspended') : null)),
      btn(s.verified ? 'Remove verification' : 'Verify', s.verified ? 'ghost' : '', async e => { if (await act(e.target, 'admin_set_verified', { p_id: s.id, p_verified: !s.verified }, s.verified ? 'Verification removed' : 'Verified')) show(); }))));
  }

  // ---------------------------------------------------------------------------
  async function users() {
    const r = await S.sb.rpc('admin_list_users'); if (!live()) return; clear(body);
    if (r.error) return body.append(errorBox(show));
    const q = h('input', { type: 'search', placeholder: 'Search name or email…', maxlength: 80 });
    const email = h('input', { type: 'email', placeholder: 'Make scholar by email', maxlength: 120 });
    const list = h('div');
    body.append(h('div.card', h('div.row', { style: 'gap:8px' }, email, btn('Make scholar', '', async e => { if (!email.value.trim()) return; if (await act(e.target, 'admin_make_scholar', { p_email: email.value.trim() }, 'Account is now a scholar (still needs verification)')) { email.value = ''; show(); } }))),
      h('form.searchbar', { style: 'margin:0 0 12px', onsubmit: e => e.preventDefault() }, icon('search', 'i'), q), list);
    const render = () => {
      clear(list); const term = q.value.trim().toLowerCase();
      r.data.filter(u => !term || `${u.display_name} ${u.email}`.toLowerCase().includes(term)).slice(0, 100).forEach(u => {
        const isAdm = u.role === 'admin', me = u.id === S.user.id;
        list.append(h('div.card', h('div.row', { style: 'flex-wrap:wrap' }, h('b', u.display_name), h('span.tag' + (isAdm ? '.red' : ''), u.role), u.verified ? h('span.tag', 'verified') : null, u.premium ? h('span.tag.gold', 'premium') : null, u.suspended ? h('span.tag.red', 'suspended') : null),
          h('div.small.muted', { style: 'word-break:break-all' }, `${u.email} · joined ${ago(u.created_at)}`),
          isAdm || me ? null : h('div.row', { style: 'flex-wrap:wrap;margin-top:8px' },
            btn(u.suspended ? 'Unsuspend' : 'Suspend', u.suspended ? '' : 'danger', async e => { if (!u.suspended && !(await confirmBox('Suspend user', `${u.display_name} will not be able to ask or answer.`, 'Suspend', 'Cancel', true))) return; if (await act(e.target, 'admin_set_suspended', { p_id: u.id, p_suspended: !u.suspended }, u.suspended ? 'Unsuspended' : 'Suspended')) show(); }),
            btn(u.role === 'scholar' ? 'Make regular user' : 'Make scholar', 'ghost', async e => { if (await act(e.target, 'admin_set_role', { p_id: u.id, p_role: u.role === 'scholar' ? 'user' : 'scholar' }, 'Role updated')) show(); }),
            btn('Premium…', 'ghost', () => premiumModal(u)))));
      });
      if (!list.children.length) list.append(empty('search', 'No users match.'));
    };
    q.addEventListener('input', debounce(render, 200)); render();
  }
  function premiumModal(u) {
    modal((sheet, close) => {
      const days = h('input', { type: 'number', min: 0, max: 3650, value: 30 });
      sheet.append(h('h2', 'Premium for ' + u.display_name), h('p.muted.small', 'Manual grant (support). Enter 0 to revoke. This is not a payment.'), h('label.f', 'Days'), days,
        h('div', { style: 'margin-top:14px' }, btn('Apply', '', async e => { if (await act(e.target, 'admin_set_premium', { p_id: u.id, p_days: Number(days.value) }, 'Premium updated')) { close(); show(); } })));
    });
  }

  // ---------------------------------------------------------------------------
  async function categories() {
    const r = await S.sb.from('categories').select('*').order('sort_order'); if (!live()) return; clear(body);
    if (r.error) return body.append(errorBox(show));
    const save = async (id, vals) => { const x = await S.sb.from('categories').update(vals).eq('id', id); if (x.error) { toast(errMsg(x.error), true); return false; } await loadCategories(); toast('Saved'); return true; };
    const f = { slug: h('input', { placeholder: 'slug (a-z, 0-9, -)', maxlength: 40 }), hi: h('input', { placeholder: 'Hindi name', maxlength: 40 }), en: h('input', { placeholder: 'English name', maxlength: 40 }), ic: h('input', { placeholder: 'Emoji', maxlength: 4, style: 'max-width:90px' }), ord: h('input', { type: 'number', placeholder: 'Order', value: r.data.length + 1, style: 'max-width:90px' }) };
    body.append(h('form.card', { novalidate: true, onsubmit: async e => {
      e.preventDefault();
      if (!/^[a-z0-9-]{2,40}$/.test(f.slug.value.trim()) || !f.hi.value.trim() || !f.en.value.trim()) return toast('Fill slug, Hindi and English names (slug: a-z, 0-9, -).', true);
      const x = await S.sb.from('categories').insert({ slug: f.slug.value.trim(), name_hi: f.hi.value.trim(), name_en: f.en.value.trim(), icon: f.ic.value.trim() || '📖', sort_order: Number(f.ord.value) || 0 });
      if (x.error) return toast(errMsg(x.error), true);
      await loadCategories(); toast('Category added'); show();
    } }, h('h3', 'Add category'), h('div.stack', f.slug, f.hi, f.en, h('div.row', f.ic, f.ord)), h('div', { style: 'margin-top:10px' }, h('button.btn.sm', { type: 'submit' }, 'Add'))));
    r.data.forEach(c => {
      const hi = h('input', { value: c.name_hi, maxlength: 40 }), en = h('input', { value: c.name_en, maxlength: 40 }), ic = h('input', { value: c.icon, maxlength: 4, style: 'max-width:90px' }), ord = h('input', { type: 'number', value: c.sort_order, style: 'max-width:90px' });
      const act2 = h('input', { type: 'checkbox', checked: c.active });
      body.append(h('div.card', h('div.small.muted', c.slug), h('div.stack', hi, en, h('div.row', ic, ord)),
        h('label.switch', act2, h('span', 'Visible to users')),
        h('div', btn('Save', '', e => save(c.id, { name_hi: hi.value.trim(), name_en: en.value.trim(), icon: ic.value.trim() || '📖', sort_order: Number(ord.value) || 0, active: act2.checked })))));
    });
  }

  // ---------------------------------------------------------------------------
  async function payments() {
    const [p, s] = await Promise.all([S.sb.from('payments').select('*').order('created_at', { ascending: false }).limit(100), S.sb.from('subscriptions').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(100)]);
    if (!live()) return; clear(body);
    if (p.error || s.error) return body.append(errorBox(show));
    const table = (head, rows) => h('div.card.scroll-x', h('table.t', h('thead', h('tr', head.map(x => h('th', x)))), h('tbody', rows.map(r => h('tr', r.map(c => h('td', String(c ?? '—'))))))));
    body.append(h('div.section-h', h('h2', `Payments (${p.data.length})`)), p.data.length ? table(['When', 'Amount', 'Status', 'Provider', 'Order'], p.data.map(x => [ago(x.created_at), fmtMoney(x.amount_paise, x.currency), x.status, x.provider, x.provider_order_id])) : empty('inbox', 'No payments yet.'),
      h('div.section-h', h('h2', `Active subscriptions (${s.data.length})`)), s.data.length ? table(['Since', 'Plan', 'Until', 'Source'], s.data.map(x => [ago(x.created_at), x.plan, x.current_period_end ? new Date(x.current_period_end).toLocaleDateString('en-IN') : 'no end', x.provider])) : empty('inbox', 'No active subscriptions.'));
  }

  async function audit() {
    const r = await S.sb.from('audit_logs').select('*').order('id', { ascending: false }).limit(100); if (!live()) return; clear(body);
    if (r.error) return body.append(errorBox(show));
    if (!r.data.length) return body.append(empty('inbox', 'No activity logged yet.'));
    body.append(h('div.card.scroll-x', h('table.t', h('thead', h('tr', ['When', 'Action', 'Target', 'Details'].map(x => h('th', x)))),
      h('tbody', r.data.map(x => h('tr', h('td', ago(x.created_at)), h('td', x.action), h('td', { style: 'word-break:break-all;max-width:140px' }, x.target || '—'), h('td', { style: 'word-break:break-all' }, JSON.stringify(x.meta || {}))))))));
  }

  paintTabs(); show();
}
