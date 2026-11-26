// Profile photos: private bucket "avatars" (migration 008). Only the owner can read their own photo, so it is shown
// through a short-lived signed link that is cached in memory (one request per photo, not one per page).
import { S } from './store.js';
import { h } from './ui.js';
import { avatar } from './components.js';

const cache = new Map();   // path -> { url, until }
export const photosSupported = () => !!S.profile && Object.prototype.hasOwnProperty.call(S.profile, 'avatar_path');

export async function avatarUrl(path) {
  if (!path) return null;
  const c = cache.get(path);
  if (c && c.until > Date.now()) return c.url;
  const r = await S.sb.storage.signedUrl('avatars', path, 3600).catch(() => ({ url: null }));
  if (!r.url) return null;
  cache.set(path, { url: r.url, until: Date.now() + 50 * 60 * 1000 });
  return r.url;
}
export const forgetAvatar = path => cache.delete(path);

// The initial letter is shown at once; the photo replaces it when (and only if) it loads.
export function avatarEl(profile, cls = '') {
  const el = avatar(profile?.display_name, cls);
  if (profile?.avatar_path) {
    avatarUrl(profile.avatar_path).then(u => {
      if (!u) return;
      const img = h('img', { src: u, alt: '', decoding: 'async' });
      img.onload = () => { el.textContent = ''; el.append(img); el.classList.add('has-photo'); };
    });
  }
  return el;
}

// Center-crops and shrinks a picked image to a small square (keeps uploads tiny and strips camera metadata).
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export async function squareImage(file, size = 320) {
  if (!file || !PHOTO_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('BAD_PHOTO');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('BAD_PHOTO'); }
  const side = Math.min(bmp.width, bmp.height), c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close?.();
  const blob = t => new Promise(r => c.toBlob(r, t, 0.86));
  let out = await blob('image/webp');
  if (!out || out.type !== 'image/webp') out = await blob('image/jpeg');
  if (!out) throw new Error('BAD_PHOTO');
  return { blob: out, ext: out.type === 'image/webp' ? 'webp' : 'jpg' };
}
