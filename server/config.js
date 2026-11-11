// Server configuration, read ONLY from environment variables (see .env.example).
// loadConfig()   -> everything the server needs, secrets included (never sent to a browser)
// publicConfig() -> the small, browser-safe subset served as /js/config.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const str = v => (v == null ? '' : String(v).trim());
const int = (v, def, min, max) => { const n = Number.parseInt(str(v), 10); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
const bool = v => /^(1|true|yes|on)$/i.test(str(v));

// Supabase keys: legacy JWT keys carry a "role" claim; new-style keys are sb_publishable_... / sb_secret_...
function keyRole(key) {
  if (!key) return '';
  if (key.startsWith('sb_secret_')) return 'service_role';
  if (key.startsWith('sb_publishable_')) return 'anon';
  try { return JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8')).role || ''; } catch { return ''; }
}
function httpUrl(v, { httpsOnly = false } = {}) {
  const s = str(v); if (!s) return '';
  try { const u = new URL(s); if (u.protocol === 'https:' || (!httpsOnly && u.protocol === 'http:')) return s.replace(/\/+$/, ''); } catch { /* invalid */ }
  return null;
}

export function loadConfig(env = process.env) {
  const problems = [];

  let supabaseUrl = httpUrl(env.SUPABASE_URL);
  if (supabaseUrl === null) { problems.push('SUPABASE_URL is not a valid http(s) URL'); supabaseUrl = ''; }

  let anonKey = str(env.SUPABASE_ANON_KEY);
  if (anonKey && keyRole(anonKey) === 'service_role') {
    problems.push('SUPABASE_ANON_KEY contains a service_role (secret) key. It was NOT used and NOT exposed. Put the public "anon" key there.');
    anonKey = '';
  }
  const serviceKey = str(env.SUPABASE_SERVICE_ROLE_KEY);
  if (serviceKey && keyRole(serviceKey) !== 'service_role') problems.push('SUPABASE_SERVICE_ROLE_KEY does not look like a service_role key');
  const supabaseReady = !!(supabaseUrl && anonKey);
  if (!supabaseReady) problems.push('Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY');

  let siteUrl = httpUrl(env.SITE_URL);
  if (siteUrl === null) { problems.push('SITE_URL is not a valid http(s) URL; ignored'); siteUrl = ''; }

  let meetingBase = httpUrl(env.MEETING_BASE_URL, { httpsOnly: true });
  if (meetingBase === null) { problems.push('MEETING_BASE_URL must be an https URL; using the default'); meetingBase = ''; }
  meetingBase = (meetingBase || 'https://meet.jit.si') + '/';

  const contactEmail = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(str(env.CONTACT_EMAIL)) ? str(env.CONTACT_EMAIL) : '';

  const razorpay = {
    keyId: str(env.RAZORPAY_KEY_ID), keySecret: str(env.RAZORPAY_KEY_SECRET), webhookSecret: str(env.RAZORPAY_WEBHOOK_SECRET),
    apiBase: httpUrl(env.RAZORPAY_API_BASE) || 'https://api.razorpay.com',
  };
  const paymentsReady = !!(supabaseReady && serviceKey && keyRole(serviceKey) === 'service_role' && razorpay.keyId && razorpay.keySecret);
  const webhookReady = !!(paymentsReady && razorpay.webhookSecret);
  if ((razorpay.keyId || razorpay.keySecret) && !paymentsReady) problems.push('Razorpay keys are set but payments stay OFF: SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are all required');
  if (paymentsReady && !webhookReady) problems.push('RAZORPAY_WEBHOOK_SECRET is not set: payments work, but a buyer who closes the page before returning is only confirmed after a retry');

  return {
    port: int(env.PORT, 3000, 1, 65535),
    publicDir: path.resolve(here, '..', 'public'),
    trustProxy: bool(env.TRUST_PROXY),
    siteUrl, contactEmail, meetingBase,
    supabaseUrl, anonKey, serviceKey, supabaseReady,
    razorpay, paymentsReady, webhookReady,
    amountPaise: int(env.PREMIUM_PRICE_PAISE, 9900, 100, 10_000_000),
    currency: 'INR',
    days: int(env.PREMIUM_DAYS, 30, 1, 366),
    problems,
  };
}

// Browser-safe values only. Never add a secret (service key, Razorpay key/secret, webhook secret) here.
export function publicConfig(cfg) {
  return {
    SUPABASE_URL: cfg.supabaseReady ? cfg.supabaseUrl : '',
    SUPABASE_ANON_KEY: cfg.supabaseReady ? cfg.anonKey : '',
    PAYMENTS: { enabled: cfg.paymentsReady, amountPaise: cfg.amountPaise, days: cfg.days, currency: cfg.currency },
    MEETING_BASE: cfg.meetingBase,
    CONTACT_EMAIL: cfg.contactEmail,
  };
}
