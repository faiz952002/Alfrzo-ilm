import { S } from '../store.js';
import { t, getLang } from '../i18n.js';
import { h, icon, clear, debounce, cleanSearch } from '../ui.js';
import { scholarCard, skeletons, empty, pageTitle, errorBox } from '../components.js';

export default async function scholars(view, ctx) {
  ctx.setTitle(t('nav.scholars'), t('meta.scholars'));
  let filter = 'all', term = '';
  const q = h('input', { type: 'search', placeholder: t('sch.search'), 'aria-label': t('sch.search'), maxlength: 60 });
  const chips = h('div.chips'), list = h('div');
  const specs = [...new Set(S.cats.map(c => c.slug))];
  const paint = () => { clear(chips); [['all', t('cat.all')], ...S.cats.map(c => [c.slug, c.icon + ' ' + (getLang() === 'en' ? c.name_en : c.name_hi)])].forEach(([k, l]) => chips.append(h('button.chip', { type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; paint(); render(); } }, l))); };
  let all = null, followed = new Set();
  view.append(pageTitle(t('sch.title'), false), h('form.searchbar', { style: 'margin:0 0 12px', onsubmit: e => e.preventDefault() }, icon('search', 'i'), q), chips, list);
  q.addEventListener('input', debounce(() => { term = cleanSearch(q.value).toLowerCase(); render(); }, 200));
  paint(); list.append(...skeletons(3));
  const [r, f] = await Promise.all([S.sb.from('scholar_directory').select('*').order('answers_count', { ascending: false }), S.user ? S.sb.from('scholar_followers').select('scholar_id') : { data: [] }]);
  if (!ctx.alive()) return;
  if (r.error) { clear(list); list.append(errorBox(() => S.go(location.pathname + location.search))); return; }
  all = r.data; followed = new Set((f.data || []).map(x => x.scholar_id)); render();
  function render() {
    clear(list);
    const slugToName = Object.fromEntries(S.cats.map(c => [c.slug, [c.name_en, c.name_hi].map(x => x.toLowerCase())]));
    const items = all.filter(s => {
      if (term && !`${s.display_name} ${s.qualifications} ${(s.specialties || []).join(' ')} ${s.bio}`.toLowerCase().includes(term)) return false;
      if (filter !== 'all') { const names = slugToName[filter] || []; return (s.specialties || []).some(x => names.some(n => x.toLowerCase().includes(n) || n.includes(x.toLowerCase()))) || (s.specialties || []).includes(filter); }
      return true;
    });
    if (!items.length) list.append(empty('scholars', all.length ? t('sch.nomatch') : t('scholars.none'), S.user && !S.scholar ? h('a.btn.ghost.sm', { href: '/become-scholar' }, t('bs.title')) : null));
    items.forEach(s => list.append(scholarCard(s, followed.has(s.id))));
  }
}
