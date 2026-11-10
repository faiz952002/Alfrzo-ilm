import { S, requireAuth } from '../store.js';
import { t } from '../i18n.js';
import { h, clear } from '../ui.js';
import { pageTitle, skeletons, empty, scholarCard } from '../components.js';

export default async function following(view, ctx) {
  ctx.setTitle(t('following.title'));
  if (!requireAuth(ctx)) return;
  const list = h('div'); view.append(pageTitle(t('following.title')), list); list.append(...skeletons(2));
  const f = await S.sb.from('scholar_followers').select('scholar_id');
  const ids = (f.data || []).map(x => x.scholar_id);
  const r = ids.length ? await S.sb.from('scholar_directory').select('*').in('id', ids) : { data: [] };
  if (!ctx.alive()) return; clear(list);
  if (!r.data.length) { list.append(empty('scholars', t('following.empty'), h('a.btn.sm', { href: '/scholars' }, t('nav.scholars')))); return; }
  r.data.forEach(s => list.append(scholarCard(s, true)));
}
