// DOM helpers, icons and small utilities. User content is ONLY ever inserted via textContent.
const SVG = 'http://www.w3.org/2000/svg';
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  qa: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12.5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scholars: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>', arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  heart: '<path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  badge: '<path d="M12 2l2.4 2 3.1-.2 1 3 2.6 1.8-1 3 1 3-2.6 1.8-1 3-3.1-.2L12 22l-2.4-2-3.1.2-1-3L2.9 15.4l1-3-1-3 2.6-1.8 1-3 3.1.2z"/><path d="M8.5 12l2.5 2.5L15.5 9.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4M6.6 6.7C3.9 8.5 2.5 12 2.5 12S6 19 12 19a9.6 9.6 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V4.5M8 7h8"/>',
  star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2-2.5 3.5M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  thumb: '<path d="M7 11v9H3v-9zM7 11l4-8c1.5 0 2.5 1.2 2.2 2.7L12.7 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/>',
  dash: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  fire: '<path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.5 1 2 2 2-1-3 0-6 1-9z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
  s.innerHTML = P[name] || ''; return s;
}

export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m ? m[1] : tag);
  if (m && m[2]) for (const x of m[2].match(/[.#][\w-]+/g)) x[0] === '#' ? el.id = x.slice(1) : el.classList.add(x.slice(1));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') v.split(' ').filter(Boolean).forEach(c => el.classList.add(c));
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids); return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
}
export const frag = (...k) => { const f = document.createDocumentFragment(); add(f, k); return f; };
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function logo(size) {
  const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 64 64'); if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<defs><linearGradient id="lg${size || 0}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#139071"/><stop offset="1" stop-color="#052e24"/></linearGradient></defs>
  <rect width="64" height="64" rx="17" fill="url(#lg${size || 0})"/>
  <path d="M32 11c-3.5 4-3.5 8 0 10 3.5-2 3.5-6 0-10z" fill="#f3d98b"/>
  <path d="M16 46c0-9 7-15 16-15s16 6 16 15z" fill="#fff"/><rect x="13" y="46" width="38" height="5" rx="2" fill="#f3d98b"/>
  <rect x="10" y="26" width="4" height="25" rx="1.5" fill="#fff" opacity=".92"/><rect x="50" y="26" width="4" height="25" rx="1.5" fill="#fff" opacity=".92"/>
  <path d="M12 20l-3 6h6z M52 20l-3 6h6z" fill="#f3d98b"/>`;
  return s;
}
export function skyline() {
  const s = document.createElementNS(SVG, 'svg'); s.setAttribute('class', 'skyline'); s.setAttribute('viewBox', '0 0 400 96'); s.setAttribute('preserveAspectRatio', 'xMidYMax slice'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<g fill="#052e24" opacity=".55"><rect x="0" y="70" width="400" height="26"/>
  <path d="M120 70c0-26 18-40 40-40s40 14 40 40z"/><rect x="157" y="14" width="6" height="16"/><path d="M160 6c-3 3-3 7 0 9 3-2 3-6 0-9z"/>
  <rect x="86" y="30" width="9" height="42" rx="2"/><path d="M90.5 18l-6 12h12z"/><rect x="226" y="36" width="9" height="36" rx="2"/><path d="M230.5 24l-6 12h12z"/>
  <path d="M250 70c0-15 10-24 25-24s25 9 25 24z"/><path d="M30 70c0-12 8-20 20-20s20 8 20 20z"/><path d="M320 70c0-12 8-20 20-20s20 8 20 20z"/>
  <rect x="372" y="44" width="8" height="28" rx="2"/><path d="M376 33l-5 11h10z"/></g>
  <g fill="#f3d98b" opacity=".35"><circle cx="40" cy="22" r="1.6"/><circle cx="300" cy="14" r="1.4"/><circle cx="360" cy="26" r="1.2"/><circle cx="210" cy="12" r="1.2"/></g>`;
  return s;
}

// ---------- feedback ----------
let toasts;
export function toast(msg, bad = false) {
  toasts ||= document.getElementById('toasts');
  const el = h('div.toast' + (bad ? '.bad' : ''), { role: bad ? 'alert' : 'status' }, msg);
  toasts.append(el); setTimeout(() => el.remove(), bad ? 5200 : 3000);
}
export function modal(build) {
  const prev = document.activeElement;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true' });
  const ov = h('div.overlay', { onclick: e => { if (e.target === ov) close(); } }, sheet);
  build(sheet, close); document.body.append(ov); document.addEventListener('keydown', onKey);
  (sheet.querySelector('textarea,input,select,button') || sheet).focus?.();
  return close;
}
export function confirmBox(title, text, okLabel, cancelLabel, danger = false) {
  return new Promise(res => modal((sheet, close) => {
    sheet.append(h('h2', title), h('p.muted', text),
      h('div.row', { style: 'justify-content:flex-end;margin-top:14px' },
        h('button.btn.ghost.sm', { type: 'button', onclick: () => { close(); res(false); } }, cancelLabel),
        h('button.btn.sm' + (danger ? '.danger' : ''), { type: 'button', onclick: () => { close(); res(true); } }, okLabel)));
  }));
}
export function busy(btn, on) { if (!btn) return; btn.disabled = on; btn.dataset.l ??= btn.textContent; if (on) { btn.textContent = '…'; } else { btn.textContent = btn.dataset.l; } }

// ---------- utils ----------
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const initial = n => ((n || '?').trim().match(/\p{L}/u) || ['?'])[0].toUpperCase();
export function timeAgo(iso, lang) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000, a = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat(lang === 'hi' ? 'hi' : 'en', { numeric: 'auto' });
  if (a < 60) return rtf.format(0, 'second');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const fmtMoney = (paise, cur = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(paise / 100);
// Strip characters that would break a PostgREST or()/ilike expression.
export const cleanSearch = s => s.replace(/[%*,()"\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
export const dirOf = txt => /[\u0600-\u06FF]/.test(txt || '') ? 'rtl' : 'ltr';
export const CONTACT_RE = /((\+?\d[\s\-.]?){10,})|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|(https?:\/\/|www\.|wa\.me|t\.me)/i;
