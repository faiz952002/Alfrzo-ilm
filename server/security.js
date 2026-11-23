import crypto from 'node:crypto';

// trustProxy = how many proxies in front of this server append to X-Forwarded-For (TRUST_PROXY, 1 on Render).
// Each trusted proxy appends the address it saw, so the client is the entry `trustProxy` places from the RIGHT.
// Entries further left were sent by the client itself and can be forged, so they are never used.
export function clientIp(req, trustProxy) {
  const hops = trustProxy === true ? 1 : Math.max(0, Math.floor(Number(trustProxy) || 0));
  if (hops > 0) {
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (chain.length) return chain[Math.max(0, chain.length - hops)];
  }
  return req.socket.remoteAddress || 'unknown';
}

// Fixed-window counter kept in memory. Fine for one instance; use a shared store if you scale to several.
export class RateLimiter {
  constructor() { this.hits = new Map(); this.timer = setInterval(() => this.sweep(), 60_000); this.timer.unref(); }
  sweep() { const now = Date.now(); for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k); }
  // returns true when the call is ALLOWED
  take(key, limit, windowMs) {
    const now = Date.now(); let e = this.hits.get(key);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; this.hits.set(key, e); }
    e.n++;
    return e.n <= limit;
  }
}

export function securityHeaders(cfg, req) {
  const sb = cfg.supabaseUrl;
  let sbWs = '';
  try { if (sb) sbWs = ' ' + new URL(sb).origin.replace(/^http/, 'ws'); } catch { /* ignore */ }
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://cdn.razorpay.com${sb ? ' ' + sb : ''}`,
    `connect-src 'self'${sb ? ' ' + sb : ''}${sbWs} https://api.razorpay.com https://lumberjack.razorpay.com`,
    `media-src 'self' blob:${sb ? ' ' + sb : ''}`,
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  const h = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  };
  const proto = cfg.trustProxy ? String(req.headers['x-forwarded-proto'] || '').split(',')[0] : (req.socket.encrypted ? 'https' : 'http');
  if (proto === 'https') h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

export const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
