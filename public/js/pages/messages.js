import { S, errMsg, requireAuth } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, toast, clear, timeAgo, CONTACT_RE } from '../ui.js';
import { pageTitle, skeletons, empty, errorBox, avatar, verifiedBadge, reportModal } from '../components.js';

const nameOf = c => c.other_name || t('consult.anon');

export default async function messages(view, ctx) {
  ctx.setTitle(t('msg.title'));
  if (!requireAuth(ctx)) return;
  return ctx.params.id ? thread(view, ctx, ctx.params.id) : inbox(view, ctx);
}

async function inbox(view, ctx) {
  let tab = 'all', rows = [];
  const list = h('div'), chips = h('div.chips');
  view.append(h('div.page-title', h('h1', t('msg.title'))), chips, list); list.append(...skeletons(3));
  const paint = () => {
    clear(chips); [['all', 'tab.all'], ['active', 'msg.active'], ['past', 'msg.past']].forEach(([k, lk]) => chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; paint(); } }, t(lk))));
    clear(list);
    const items = rows.filter(c => tab === 'all' || (tab === 'active') === (c.status === 'confirmed'));
    if (!items.length) return list.append(empty('chat', t('msg.empty'), h('a.btn.sm', { href: '/scholars' }, t('consult.title'))));
    items.forEach(c => list.append(h('a.card.convo', { href: `/messages/${c.id}` }, avatar(nameOf(c)),
      h('div.grow', h('div', { style: 'font-weight:800' }, nameOf(c), ' ', c.other_is_scholar ? verifiedBadge() : null),
        h('div.small.muted.last', { dir: 'auto', style: c.unread ? 'font-weight:700;color:var(--ink)' : '' }, c.last_body || t('msg.none'))),
      h('div', { style: 'text-align:right;flex:none' }, h('div.small.muted', timeAgo(c.last_message_at || c.created_at, getLang())), c.unread ? h('span.tag.red', String(c.unread)) : null))));
  };
  const r = await S.sb.from('conversation_list').select('*').order('created_at', { ascending: false }).limit(100);
  if (!ctx.alive()) return;
  if (r.error) { clear(list); return list.append(errorBox(() => S.go('/messages'))); }
  rows = r.data.sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at));
  paint();
}

async function thread(view, ctx, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return S.go('/messages', true);
  view.append(pageTitle(t('msg.title')), ...skeletons(2));
  const c = (await S.sb.from('conversation_list').select('*').eq('id', id).maybeSingle()).data;
  if (!ctx.alive()) return; clear(view);
  if (!c) { view.append(pageTitle(t('msg.title')), empty('chat', t('qd.notfound'), h('a.btn.sm', { href: '/messages' }, t('msg.title')))); return; }
  const open = c.status === 'confirmed';
  const box = h('div.thread', { 'aria-live': 'polite' }), seen = new Set(); let last = null, timer = null;
  const time = iso => new Date(iso).toLocaleTimeString(getLang() === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });
  const add = m => { if (seen.has(m.id)) return; seen.add(m.id); box.querySelector('.empty')?.remove(); box.append(h('div.bub' + (m.sender_id === S.user.id ? '.me' : ''), { dir: 'auto' }, m.body, h('time', time(m.created_at)))); last = m.created_at; };
  async function pull(first) {
    let q = S.sb.from('messages').select('id,sender_id,body,created_at').eq('conversation_id', id).order('created_at').limit(200);
    if (last) q = q.gt('created_at', last);
    const r = await q; if (!ctx.alive() || r.error) return;
    const fresh = r.data.filter(m => !seen.has(m.id));
    fresh.forEach(add);
    if (first && !r.data.length) box.append(empty('chat', t('msg.none')));
    if (fresh.some(m => m.sender_id !== S.user.id) || (first && c.unread)) S.sb.rpc('mark_conversation_read', { p_id: id }).then(() => S.pollUnread?.());
    if (fresh.length) window.scrollTo(0, document.body.scrollHeight);
  }
  const input = h('textarea', { id: 'mi', maxlength: 2000, placeholder: t('msg.ph'), 'aria-label': t('msg.ph'), dir: 'auto', rows: 1 });
  const sendBtn = h('button.btn', { type: 'submit', 'aria-label': t('msg.send') }, icon('send'));
  const form = h('form.composer', { onsubmit: async e => {
    e.preventDefault(); const body = input.value.trim(); if (!body) return;
    if (CONTACT_RE.test(body)) return toast(t('err.contact'), true);
    sendBtn.disabled = true;
    const r = await S.sb.from('messages').insert({ conversation_id: id, sender_id: S.user.id, body }).select('id,sender_id,body,created_at').single();
    sendBtn.disabled = false;
    if (r.error) return toast(errMsg(r.error), true);
    input.value = ''; add(r.data); window.scrollTo(0, document.body.scrollHeight); input.focus();
  } }, input, sendBtn);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  view.append(pageTitle(nameOf(c), true, h('button.iconbtn', { type: 'button', 'aria-label': t('msg.report'), title: t('msg.report'), onclick: () => reportModal('conversation', id) }, icon('flag'))),
    h('div.notice', { style: 'margin-bottom:6px' }, icon('lock'), h('div', t('msg.rule'))), box,
    open ? form : h('div.notice.warn', icon('info'), h('div', t('msg.closed'))));
  await pull(true);
  if (open) { timer = setInterval(() => { if (!document.hidden) pull(false); }, 4000); ctx.cleanup(() => clearInterval(timer)); }
}
