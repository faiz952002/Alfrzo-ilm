import { S, requireAuth } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, clear, timeAgo, toast } from '../ui.js';
import { pageTitle, skeletons, empty, toggleSave, verifiedBadge } from '../components.js';
import { scholarMap } from '../data.js';

export default async function saved(view, ctx) {
  ctx.setTitle(t('saved.title'));
  if (!requireAuth(ctx)) return;
  const list = h('div'); view.append(pageTitle(t('saved.title')), list); list.append(...skeletons(2));
  const sv = await S.sb.from('saved_answers').select('answer_id,created_at').order('created_at', { ascending: false });
  if (!ctx.alive()) return;
  clear(list);
  if (!sv.data?.length) { list.append(empty('bookmark', t('saved.empty'), h('a.btn.sm', { href: '/qa' }, t('nav.qa')))); return; }
  const a = await S.sb.from('answers').select('id,question_id,scholar_id,body,created_at').in('id', sv.data.map(x => x.answer_id));
  const qs = await S.sb.from('question_feed').select('id,title').in('id', [...new Set((a.data || []).map(x => x.question_id))]);
  const sm = await scholarMap((a.data || []).map(x => x.scholar_id));
  const titles = new Map((qs.data || []).map(q => [q.id, q.title])), byId = new Map((a.data || []).map(x => [x.id, x]));
  if (!ctx.alive()) return;
  sv.data.forEach(row => {
    const ans = byId.get(row.answer_id); if (!ans) return;
    const card = h('div.card', h('a.q', { href: `/q/${ans.question_id}` }, h('h3', { dir: 'auto' }, titles.get(ans.question_id) || '…'), h('div.excerpt', { dir: 'auto' }, ans.body)),
      h('div.row', { style: 'margin-top:8px' }, h('span.small.muted.grow', (sm.get(ans.scholar_id)?.display_name || t('scholar')) + ' · ' + timeAgo(ans.created_at, getLang())),
        h('button.act.on', { type: 'button', onclick: async () => { if (await toggleSave(ans.id, false)) { card.remove(); toast(t('saved.removed')); if (!list.children.length) list.append(empty('bookmark', t('saved.empty'))); } } }, icon('bookmark'), t('saved.remove'))));
    list.append(card);
  });
}
