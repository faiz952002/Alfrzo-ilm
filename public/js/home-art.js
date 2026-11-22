// Coded illustrations for the night & gold home page (used until real photos are added in home-images.js).
// Drawn as SVG so they stay sharp on every screen and need no image licence.
const NS = 'http://www.w3.org/2000/svg';
let seq = 0;
function svg(viewBox, inner, cls, slice = 'xMidYMid slice') {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox); s.setAttribute('preserveAspectRatio', slice); s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner.replace(/ID/g, 'h' + (++seq)); return s;
}

// one mosque silhouette: big onion dome, side domes, minarets, warm windows
function mosque(x, y, k, body, glow) {
  const T = (px, py) => `${(x + px * k).toFixed(1)},${(y + py * k).toFixed(1)}`;
  const dome = (cx, base, w, hgt) => `<path d="M${T(cx - w, base)} C${T(cx - w, base - hgt * .7)} ${T(cx - w * .35, base - hgt * .85)} ${T(cx, base - hgt)} C${T(cx + w * .35, base - hgt * .85)} ${T(cx + w, base - hgt * .7)} ${T(cx + w, base)}Z" fill="${body}"/>`;
  const minaret = (cx, top) => `<rect x="${(x + (cx - 3) * k).toFixed(1)}" y="${(y + top * k).toFixed(1)}" width="${(6 * k).toFixed(1)}" height="${((100 - top) * k).toFixed(1)}" fill="${body}"/>
    <path d="M${T(cx - 4, top)} L${T(cx, top - 16)} L${T(cx + 4, top)}Z" fill="${body}"/><rect x="${(x + (cx - 5) * k).toFixed(1)}" y="${(y + (top + 14) * k).toFixed(1)}" width="${(10 * k).toFixed(1)}" height="${(2.4 * k).toFixed(1)}" fill="${body}"/>`;
  const win = (wx, wy) => `<path d="M${T(wx - 2.4, wy + 6)} V${(y + (wy + 1) * k).toFixed(1)} a${(2.4 * k).toFixed(1)} ${(2.4 * k).toFixed(1)} 0 0 1 ${(4.8 * k).toFixed(1)} 0 V${(y + (wy + 6) * k).toFixed(1)}Z" fill="${glow}"/>`;
  return `${minaret(-58, 22)}${minaret(-40, 34)}${minaret(40, 34)}${minaret(58, 22)}
    <rect x="${(x - 52 * k).toFixed(1)}" y="${(y + 62 * k).toFixed(1)}" width="${(104 * k).toFixed(1)}" height="${(38 * k).toFixed(1)}" fill="${body}"/>
    ${dome(-27, 64, 13, 22)}${dome(27, 64, 13, 22)}${dome(0, 64, 26, 50)}
    <path d="M${T(0, 14)} V${(y + 6 * k).toFixed(1)}" stroke="${glow}" stroke-width="${(1.2 * k).toFixed(1)}"/>
    ${[-36, -24, -12, 12, 24, 36].map(wx => win(wx, 74)).join('')}${win(0, 70)}${win(-6, 84)}${win(6, 84)}`;
}

// Hero: violet dusk sky, crescent, stars, lit mosque reflected in water, palms, a glowing lantern.
export function heroScene() {
  const stars = Array.from({ length: 34 }, (_, i) => `<circle cx="${(i * 97) % 400}" cy="${(i * 53) % 120 + 6}" r="${i % 5 ? .7 : 1.3}" fill="#fff" opacity="${.35 + (i % 4) * .15}"/>`).join('');
  const palms = (px, s) => `<g transform="translate(${px} 222) scale(${s})" fill="#0d1624"><rect x="-1.4" y="-40" width="2.8" height="40"/><path d="M0-40c-10-6-22-4-28 2 9-2 17-1 28-2zM0-40c10-6 22-4 28 2-9-2-17-1-28-2zM0-40c-5-9-15-12-23-10 8 2 15 5 23 10zM0-40c5-9 15-12 23-10-8 2-15 5-23 10z"/></g>`;
  return svg('0 0 400 300', `
    <defs><linearGradient id="skyID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111d2f"/><stop offset=".45" stop-color="#263b5a"/><stop offset=".78" stop-color="#7a4a6e"/><stop offset="1" stop-color="#d08a63"/></linearGradient>
      <linearGradient id="waterID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2d45"/><stop offset="1" stop-color="#0a121e"/></linearGradient>
      <radialGradient id="lampID"><stop offset="0" stop-color="#ffd38a" stop-opacity=".95"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
      <radialGradient id="hazeID" cx=".62" cy=".72" r=".5"><stop offset="0" stop-color="#ffb46a" stop-opacity=".45"/><stop offset="1" stop-color="#ffb46a" stop-opacity="0"/></radialGradient></defs>
    <rect width="400" height="300" fill="url(#skyID)"/><rect width="400" height="300" fill="url(#hazeID)"/>${stars}
    <mask id="moonID"><rect width="400" height="300" fill="#fff"/><circle cx="306" cy="92" r="11" fill="#000"/></mask>
    <circle cx="300" cy="96" r="12" fill="#ffe6ad" mask="url(#moonID)"/>
    <g opacity=".32">${mosque(150, 118, .62, '#1f304a', '#ffcf7a')}</g>
    ${mosque(250, 112, 1.05, '#162438', '#ffc86b')}
    ${palms(118, 1)}${palms(352, 1.15)}${palms(380, .9)}
    <rect y="222" width="400" height="78" fill="url(#waterID)"/>
    <g opacity=".22" transform="translate(0 444) scale(1 -1)">${mosque(250, 112, 1.05, '#162438', '#ffc86b')}</g>
    <g stroke="#ffcf7a" stroke-opacity=".35" stroke-width="1.2">${[232, 246, 258, 272].map((yy, i) => `<path d="M${200 + i * 6} ${yy}h${80 - i * 14}"/>`).join('')}</g>
    <circle cx="18" cy="268" r="30" fill="url(#lampID)"/>
    <g transform="translate(18 254) scale(.6)"><path d="M0-22v8" stroke="#c99a4a" stroke-width="2"/><path d="M-14-14h28l-4 6h-20z" fill="#8a6326"/>
      <path d="M-12-8h24v46h-24z" fill="#ffcf7a" opacity=".9"/><path d="M-12-8h24v46h-24z M0-8v46 M-12 15h24" fill="none" stroke="#7a5420" stroke-width="2.2"/>
      <path d="M-15 38h30l-3 6h-24z" fill="#8a6326"/></g>
    <rect x="10" y="284" width="70" height="16" fill="#0d1624" opacity=".9"/>`, 'hero-art', 'xMidYMax slice');
}

const SAND = ['#e2b47a', '#b98451', '#8a5a33'];
function cityFrame(art, sky = ['#2b3f5e', '#c98a62', '#f2c27f']) {
  return svg('0 0 160 110', `<defs><linearGradient id="cID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".6" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient></defs>
    <rect width="160" height="110" fill="url(#cID)"/>${art}<rect y="96" width="160" height="14" fill="#3b2a24"/>`, 'city-art', 'xMidYMax slice');
}
const B = SAND[0], D = SAND[1], E = SAND[2];
const CITY_ART = {
  // Vidhana Soudha: long colonnaded front, central dome on a drum, corner domes
  bengaluru: `<rect x="14" y="60" width="132" height="36" fill="${D}"/><rect x="20" y="54" width="120" height="8" fill="${B}"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${24 + i * 8.4}" y="63" width="3" height="30" fill="${B}"/>`).join('')}
    <rect x="62" y="40" width="36" height="16" fill="${B}"/><path d="M64 40c0-14 8-22 16-22s16 8 16 22z" fill="${D}"/><rect x="78.8" y="10" width="2.4" height="9" fill="${E}"/>
    <path d="M22 54c0-7 4-11 8-11s8 4 8 11zM122 54c0-7 4-11 8-11s8 4 8 11z" fill="${D}"/>`,
  // Charminar: four minarets, big arch, balcony
  hyderabad: `<rect x="44" y="44" width="72" height="52" fill="${D}"/><path d="M62 96V70a18 18 0 0 1 36 0v26z" fill="#4a2f2a"/>
    <rect x="44" y="42" width="72" height="6" fill="${B}"/>${[40, 112].map(mx => `<rect x="${mx}" y="18" width="8" height="78" fill="${B}"/>
    <path d="M${mx - 1} 18c0-6 2.5-9 5-9s5 3 5 9z" fill="${D}"/><rect x="${mx - 2}" y="34" width="12" height="3" fill="${E}"/><rect x="${mx - 2}" y="56" width="12" height="3" fill="${E}"/>`).join('')}
    ${[54, 66, 78, 90, 102].map(ax => `<path d="M${ax} 40v-4a3 3 0 0 1 6 0v4z" fill="${E}"/>`).join('')}`,
  // Shaniwar Wada: fort wall, two round bastions, central gate
  pune: `<rect x="20" y="56" width="120" height="40" fill="${D}"/>${Array.from({ length: 15 }, (_, i) => `<rect x="${21 + i * 8}" y="51" width="5" height="6" fill="${D}"/>`).join('')}
    ${[46, 114].map(bx => `<rect x="${bx - 12}" y="44" width="24" height="52" rx="5" fill="${B}"/><rect x="${bx - 12}" y="44" width="24" height="5" fill="${E}"/>`).join('')}
    <path d="M68 96V72a12 12 0 0 1 24 0v24z" fill="#4a2f2a"/><rect x="64" y="58" width="32" height="5" fill="${B}"/>
    <circle cx="10" cy="80" r="12" fill="#2e3a2a"/><circle cx="152" cy="82" r="11" fill="#2e3a2a"/>`,
  // Gateway of India: central arch, four turrets, side wings
  mumbai: `<rect x="40" y="38" width="80" height="58" fill="${B}"/><path d="M62 96V62a18 18 0 0 1 36 0v34z" fill="#4a2f2a"/>
    ${[44, 66, 94, 116].map(tx => `<rect x="${tx - 4}" y="22" width="8" height="18" fill="${D}"/><path d="M${tx - 5} 22c0-5 2.5-8 5-8s5 3 5 8z" fill="${D}"/>`).join('')}
    <rect x="12" y="62" width="30" height="34" fill="${D}"/><rect x="118" y="62" width="30" height="34" fill="${D}"/>
    ${[20, 30, 126, 136].map(wx => `<path d="M${wx} 80v-8a3 3 0 0 1 6 0v8z" fill="#4a2f2a"/>`).join('')}<rect x="40" y="46" width="80" height="3" fill="${E}"/>`,
};
export const cityArt = key => cityFrame(CITY_ART[key] || CITY_ART.mumbai);

// Scholar figure for the "Ask a Scholar" banner: white cap and kurta, dark beard, coat.
export function scholarFigure() {
  return svg('0 0 100 100', `<defs><linearGradient id="kID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5f2ea"/><stop offset="1" stop-color="#b9b3a6"/></linearGradient></defs>
    <path d="M14 100c2-20 16-30 36-30s34 10 36 30z" fill="url(#kID)"/><path d="M38 72l12 28 12-28-12 6z" fill="#222e40"/><path d="M46 78l4 22 4-22z" fill="#e9e4d8"/>
    <path d="M33 34c0 14 7 26 17 26s17-12 17-26z" fill="#c69a7a"/><path d="M32 40c0 18 8 34 18 34s18-16 18-34c-4 8-10 11-18 11s-14-3-18-11z" fill="#1d1a26"/>
    <path d="M40 49c3 2 7 3 10 3s7-1 10-3" stroke="#c69a7a" stroke-width="2.2" fill="none"/>
    <path d="M31 31c0-11 8-17 19-17s19 6 19 17z" fill="#fbfaf6"/><rect x="31" y="29" width="38" height="5" rx="2" fill="#e6e1d4"/>`, 'scholar-art', 'xMidYMid meet');
}

// Small mosque skyline for banners (right side, faded).
export function bannerSkyline() {
  return svg('0 0 240 80', `<g opacity=".9">${mosque(150, 4, .62, '#142033', '#e9b35f')}${mosque(206, 18, .48, '#142033', '#e9b35f')}${mosque(96, 26, .4, '#1a283e', '#c9964d')}</g>`, 'banner-sky', 'xMaxYMax slice');
}
