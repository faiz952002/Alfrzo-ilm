import { S } from '../store.js';
import { t } from '../i18n.js';
import { h } from '../ui.js';
import { pageTitle, catTile } from '../components.js';

export default async function categories(view, ctx) {
  ctx.setTitle(t('cat.title'), t('meta.feed'));
  view.append(pageTitle(t('cat.title')), h('div.tiles.v2', S.cats.map(catTile)));
}
