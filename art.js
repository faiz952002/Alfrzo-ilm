// Small coded illustrations (category tiles, story rings, cover banners).
// They are drawn here instead of using photos, so the app ships without any image that needs a licence.
const NS = 'http://www.w3.org/2000/svg';
let seq = 0;

// slug -> [sky top, sky bottom, artwork]. "ID" is replaced by a unique number for gradient / mask ids.
const SCENES = {
  namaz: ['#2a2d6e', '#e8845c', `<circle cx="90" cy="28" r="11" fill="#ffe1a3"/>
    <g fill="#17123a"><rect y="94" width="120" height="26"/><path d="M36 94c0-22 11-34 24-34s24 12 24 34z"/><rect x="58.6" y="44" width="2.8" height="16"/><circle cx="60" cy="42" r="3.2"/>
    <rect x="20" y="52" width="8" height="44" rx="1.5"/><path d="M24 38l-6 14h12z"/><rect x="92" y="52" width="8" height="44" rx="1.5"/><path d="M96 38l-6 14h12z"/></g>
    <path d="M53 94V82a7 7 0 0 1 14 0v12z" fill="#ffc46b"/>`],
  roza: ['#0e1f45', '#1d5c7c', `<g fill="#fff" opacity=".85"><circle cx="20" cy="22" r="1.4"/><circle cx="44" cy="12" r="1"/><circle cx="104" cy="16" r="1.3"/><circle cx="108" cy="78" r="1"/><circle cx="14" cy="92" r="1"/></g>
    <mask id="mID"><rect width="120" height="120" fill="#fff"/><circle cx="86" cy="42" r="22" fill="#000"/></mask>
    <circle cx="74" cy="48" r="26" fill="#ffd77a" mask="url(#mID)"/>
    <path d="M34 22v14" stroke="#ffd77a" stroke-width="2"/><path d="M26 46l8-9 8 9v30l-8 8-8-8z" fill="#e9963a"/><rect x="29.5" y="50" width="9" height="22" rx="3" fill="#fff2c9"/>
    <path d="M26 46h16M26 76h16" stroke="#8a4b12" stroke-width="2"/>`],
  'quran-hadith': ['#4b2f17', '#d9a55c', `<path d="M60 12L20 80h80z" fill="#fff1c0" opacity=".2"/>
    <path d="M60 56c-9-7-22-8-33-4v28c11-4 24-3 33 4z" fill="#fffaf0"/><path d="M60 56c9-7 22-8 33-4v28c-11-4-24-3-33 4z" fill="#f3e6c8"/>
    <path d="M60 56v28" stroke="#b08445" stroke-width="1.5"/>
    <g stroke="#c9b48a" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M34 60c6-1.6 13-1 20 2M34 66c6-1.6 13-1 20 2M34 72c6-1.6 13-1 20 2M66 62c7-3 14-3.6 20-2M66 68c7-3 14-3.6 20-2M66 74c7-3 14-3.6 20-2"/></g>
    <path d="M30 104l60-17M30 87l60 17" stroke="#3a210d" stroke-width="6" stroke-linecap="round"/>`],
  nikah: ['#f4b6c0', '#fbe6d2', `<circle cx="47" cy="70" r="21" fill="none" stroke="#c9972c" stroke-width="7"/><circle cx="73" cy="70" r="21" fill="none" stroke="#e3b958" stroke-width="7"/>
    <path d="M73 40l9-10H64z" fill="#fff"/><path d="M64 30h18l-4-6H68z" fill="#fff" opacity=".8"/>
    <g fill="#fff"><circle cx="24" cy="26" r="2"/><circle cx="100" cy="24" r="1.6"/><circle cx="102" cy="104" r="1.6"/></g>`],
  family: ['#ffb168', '#ee6a5c', `<circle cx="60" cy="46" r="28" fill="#ffe3ac" opacity=".75"/>
    <g fill="#4a1f24"><rect y="102" width="120" height="18"/><circle cx="40" cy="56" r="8"/><path d="M26 104V80a14 14 0 0 1 28 0v24z"/><circle cx="80" cy="56" r="8"/><path d="M66 104V80a14 14 0 0 1 28 0v24z"/></g>
    <g fill="#7b3239"><circle cx="60" cy="76" r="6"/><path d="M50 104V93a10 10 0 0 1 20 0v11z"/></g>`],
  zakat: ['#0c6a52', '#8fd0a4', `<g stroke="#a87812" stroke-width="1.5"><ellipse cx="48" cy="92" rx="24" ry="8" fill="#e9bc4e"/><ellipse cx="48" cy="82" rx="24" ry="8" fill="#f0c860"/><ellipse cx="48" cy="72" rx="24" ry="8" fill="#f6d578"/>
    <ellipse cx="86" cy="94" rx="18" ry="6" fill="#e9bc4e"/><ellipse cx="86" cy="86" rx="18" ry="6" fill="#f6d578"/></g>
    <path d="M84 26l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#fff" opacity=".92"/><path d="M30 44c8-11 21-11 28 0-9 9-20 9-28 0z" fill="#d6f2de" opacity=".9"/>`],
  hajj: ['#f1cf96', '#fff4dc', `<circle cx="94" cy="26" r="10" fill="#fff" opacity=".85"/><rect y="96" width="120" height="24" fill="#e0c38c"/>
    <rect x="36" y="44" width="48" height="52" fill="#16161a"/><rect x="36" y="56" width="48" height="8" fill="#d8a838"/><rect x="62" y="72" width="11" height="24" fill="#d8a838"/>
    <g fill="#b39a6f"><circle cx="16" cy="99" r="3"/><circle cx="26" cy="101" r="3"/><circle cx="98" cy="100" r="3"/><circle cx="108" cy="102" r="3"/></g>`],
  aqeedah: ['#0a3a38', '#15776a', `<g fill="none" stroke="#f3d98b" stroke-width="3" stroke-linejoin="round"><rect x="38" y="38" width="44" height="44"/><rect x="38" y="38" width="44" height="44" transform="rotate(45 60 60)"/><circle cx="60" cy="60" r="10"/></g>
    <circle cx="60" cy="60" r="3.5" fill="#f3d98b"/>`],
  akhlaq: ['#9fd2fb', '#eef8ff', `<path d="M60 98C34 80 26 66 26 53a17 17 0 0 1 34-5a17 17 0 0 1 34 5c0 13-8 27-34 45z" fill="#fff"/>
    <path d="M56 55a10 10 0 0 0-20 3c0 8 5 16 18 27" fill="none" stroke="#7fbcf0" stroke-width="3" stroke-linecap="round"/>
    <path d="M94 20l2.5 6.5 6.5 2.5-6.5 2.5L94 38l-2.5-6.5L85 29l6.5-2.5z" fill="#fff"/>`],
  'halal-haram': ['#1c3550', '#3e8170', `<g stroke="#f1cf73" stroke-linecap="round" fill="none"><path d="M60 28v60M32 42h56" stroke-width="4"/><path d="M32 42L20 66M32 42l12 24M88 42L76 66M88 42l12 24" stroke-width="2.5"/></g>
    <g fill="#f1cf73"><path d="M18 66a14 9 0 0 0 28 0z"/><path d="M74 66a14 9 0 0 0 28 0z"/><rect x="44" y="88" width="32" height="6" rx="3"/><circle cx="60" cy="28" r="4.5"/></g>`],
  foryou: ['#0d6a4c', '#17976b', `<path d="M60 26l8 22 22 8-22 8-8 22-8-22-22-8 22-8z" fill="#fff"/><path d="M92 22l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#f3d98b"/><circle cx="28" cy="92" r="4" fill="#f3d98b"/>`],
};

function svg(viewBox, cls, inner, slice) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  if (slice) s.setAttribute('preserveAspectRatio', slice);
  s.innerHTML = inner; return s;
}

// Square illustration for a category slug ("foryou" for the first story). Unknown slugs get the star pattern.
export function catArt(slug) {
  const id = ++seq, [a, b, art] = SCENES[slug] || SCENES.aqeedah;
  return svg('0 0 120 120', 'art', `<defs><linearGradient id="gID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="120" height="120" fill="url(#gID)"/>${art}`.replace(/ID/g, id));
}

// Wide dusk skyline used behind "Aaj ka Sawal" and on a scholar's profile.
export function duskScene() {
  const id = ++seq;
  return svg('0 0 400 220', 'dusk', `<defs><linearGradient id="dID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2058"/><stop offset=".5" stop-color="#7d4577"/><stop offset=".82" stop-color="#ee9d62"/><stop offset="1" stop-color="#f7c57e"/></linearGradient></defs>
    <rect width="400" height="220" fill="url(#dID)"/><circle cx="292" cy="170" r="50" fill="#ffe3a6" opacity=".55"/>
    <g fill="#fff" opacity=".8"><circle cx="40" cy="30" r="1.5"/><circle cx="120" cy="18" r="1.2"/><circle cx="210" cy="36" r="1.3"/><circle cx="330" cy="22" r="1.5"/><circle cx="372" cy="58" r="1.1"/><circle cx="76" cy="66" r="1"/></g>
    <g fill="#140e30"><rect y="186" width="400" height="34"/>
      <path d="M150 186c0-36 22-56 50-56s50 20 50 56z"/><rect x="198" y="104" width="4" height="26"/><circle cx="200" cy="101" r="5"/>
      <rect x="112" y="96" width="12" height="92" rx="2"/><path d="M118 72l-9 24h18z"/><rect x="276" y="96" width="12" height="92" rx="2"/><path d="M282 72l-9 24h18z"/>
      <path d="M40 186c0-20 13-32 30-32s30 12 30 32z"/><path d="M300 186c0-20 13-32 30-32s30 12 30 32z"/>
      <rect x="10" y="130" width="9" height="58" rx="2"/><path d="M14.5 112l-7 18h14z"/><rect x="381" y="130" width="9" height="58" rx="2"/><path d="M385.5 112l-7 18h14z"/></g>
    <g fill="#ffc46b"><path d="M190 186v-16a10 10 0 0 1 20 0v16z"/><rect x="166" y="166" width="7" height="12" rx="3.5"/><rect x="227" y="166" width="7" height="12" rx="3.5"/></g>`.replace(/ID/g, id), 'xMidYMax slice');
}
