import { S, catName } from '../store.js';
import { t } from '../i18n.js';
import { h } from '../ui.js';
import { pageTitle } from '../components.js';

export default async function categories(view, ctx) {
  ctx.setTitle(t('cat.title'), t('meta.feed'));
  view.append(pageTitle(t('cat.title')), h('div.card', h('div.cats', S.cats.map(c => h('a.cat', { href: `/qa?cat=${c.slug}` }, h('i', c.icon), h('span', catName(c)))))));
}
