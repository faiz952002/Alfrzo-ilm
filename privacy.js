import { S } from '../store.js';
import { t } from '../i18n.js';
import '../i18n.pages.js';
import '../i18n.v2.js';
import { h, icon } from '../ui.js';
import { pageTitle } from '../components.js';

// Every statement here describes what the code and database actually do (see supabase/schema.sql).
const SECTIONS = [['eyeoff', 'pv.anon'], ['lock', 'pv.phone'], ['shield', 'pv.who'], ['image', 'pv.img'], ['book', 'pv.refs'], ['chat', 'pv.chat'], ['video', 'pv.reels'], ['trash', 'pv.delete'], ['alert', 'pv.disc']];

export default async function privacy(view, ctx) {
  ctx.setTitle(t('privacy.title'), t('pv.intro'));
  const mail = S.cfg.CONTACT_EMAIL;
  view.append(pageTitle(t('privacy.title')),
    h('div.notice.good', icon('shield'), h('div', t('pv.intro'))),
    ...SECTIONS.map(([ic, k]) => h('section.card', h('h3', { style: 'display:flex;gap:8px;align-items:center;color:var(--em-800)' }, icon(ic, ''), t(k + '.t')), h('p', { style: 'margin:8px 0 0' }, t(k + '.d')))),
    h('section.card', h('h3', t('pv.contact.t')), h('p', { style: 'margin:8px 0 0' }, mail ? [t('pv.contact.d'), ' ', h('a', { href: 'mailto:' + mail }, mail)] : t('pv.contact.none'))),
    h('p.center.small.muted', t('pv.updated')));
}
