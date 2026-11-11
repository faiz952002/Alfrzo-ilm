import { t } from '../i18n.js';
import { h, icon } from '../ui.js';
import { empty } from '../components.js';
export default async function nf(view, ctx) { ctx.setTitle('404'); view.append(empty('help', t('notfound'), h('a.btn.sm', { href: '/' }, t('nav.home')))); }
