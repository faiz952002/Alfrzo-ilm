// Data access used by several pages. Every call goes to the real Supabase backend.
import { S } from './store.js';
import { cleanSearch } from './ui.js';

export const PAGE = 15;

export async function fetchFeed({ tab = 'latest', cat = null, q = '', status = '', offset = 0 } = {}) {
  let ids = null;
  if (tab === 'following') {
    const f = await S.sb.from('scholar_followers').select('scholar_id').eq('user_id', S.user.id);
    const sids = (f.data || []).map(x => x.scholar_id);
    if (!sids.length) return { items: [], total: 0, noFollows: true };
    const a = await S.sb.from('answers').select('question_id').in('scholar_id', sids).order('created_at', { ascending: false }).limit(200);
    ids = [...new Set((a.data || []).map(x => x.question_id))];
    if (!ids.length) return { items: [], total: 0 };
  }
  let qb = S.sb.from('question_feed').select('*', { count: 'exact' });
  if (ids) qb = qb.in('id', ids);
  if (cat) qb = qb.eq('category_id', cat);
  if (status) qb = qb.eq('status', status);
  const term = cleanSearch(q);
  if (term) qb = qb.or(`title.ilike.*${term}*,body.ilike.*${term}*`);
  qb = tab === 'popular' ? qb.order('likes_count', { ascending: false }).order('created_at', { ascending: false }) : qb.order('created_at', { ascending: false });
  const r = await qb.range(offset, offset + PAGE - 1);
  if (r.error) throw r.error;
  return { items: r.data, total: r.count ?? r.data.length };
}

// For a page of questions: which I liked, first answer id (for saving) and which answers I saved.
export async function decorate(items) {
  const out = { liked: new Set(), firstAnswer: new Map(), saved: new Set() };
  if (!items.length) return out;
  const ids = items.map(i => i.id);
  const answered = items.filter(i => i.answers_count > 0).map(i => i.id);
  const [likes, ans] = await Promise.all([
    S.user ? S.sb.from('question_likes').select('question_id').in('question_id', ids) : { data: [] },
    answered.length ? S.sb.from('answers').select('id,question_id').in('question_id', answered).order('created_at') : { data: [] },
  ]);
  (likes.data || []).forEach(l => out.liked.add(l.question_id));
  (ans.data || []).forEach(a => { if (!out.firstAnswer.has(a.question_id)) out.firstAnswer.set(a.question_id, a.id); });
  if (S.user && out.firstAnswer.size) {
    const sv = await S.sb.from('saved_answers').select('answer_id').in('answer_id', [...out.firstAnswer.values()]);
    (sv.data || []).forEach(s => out.saved.add(s.answer_id));
  }
  return out;
}

export async function scholarMap(ids) {
  const m = new Map(); ids = [...new Set(ids)];
  if (!ids.length) return m;
  const { data } = await S.sb.from('scholar_directory').select('*').in('id', ids);
  (data || []).forEach(s => m.set(s.id, s)); return m;
}
