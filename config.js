// All configuration comes from environment variables. Nothing secret is ever written to a file or sent to the browser.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const int = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : d; };
const trimSlash = s => (s || '').trim().replace(/\/+$/, '');

// A JWT's role claim, read WITHOUT trusting it (only used to refuse an obviously wrong key).
export function jwtRole(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')).role || null; } catch { return null; }
}

export function loadConfig(env = process.env) {
  const cfg = {
    port: int(env.PORT, 3000, 1, 65535),
    publicDir: path.resolve(here, '..', 'public'),
    supabaseUrl: trimSlash(env.SUPABASE_URL),
    anonKey: (env.SUPABASE_ANON_KEY || '').trim(),
    serviceKey: (env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    razorpay: {
      keyId: (env.RAZORPAY_KEY_ID || '').trim(),
      keySecret: (env.RAZORPAY_KEY_SECRET || '').trim(),
      webhookSecret: (env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
      apiBase: trimSlash(env.RAZORPAY_API_BASE) || 'https://api.razorpay.com',
    },
    amountPaise: int(env.PREMIUM_PRICE_PAISE, 9900, 100, 10_000_000),
    days: int(env.PREMIUM_DAYS, 30, 1, 366),
    currency: 'INR',
    siteUrl: trimSlash(env.SITE_URL),
    contactEmail: (env.CONTACT_EMAIL || '').trim(),
    meetingBase: /^https:\/\/[a-z0-9.-]+\/?$/i.test((env.MEETING_BASE_URL || '').trim()) ? (env.MEETING_BASE_URL.trim().replace(/\/+$/, '') + '/') : 'https://meet.jit.si/',
    trustProxy: env.TRUST_PROXY === '1',
    problems: [],
  };

  // Safety net: a service-role key pasted into the PUBLIC anon slot would give every visitor full database access.
  if (cfg.anonKey && jwtRole(cfg.anonKey) === 'service_role') {
    cfg.problems.push('SUPABASE_ANON_KEY contains a service_role key. It was NOT exposed to the browser. Use the public "anon" key there.');
    cfg.anonKey = '';
  }
  if (cfg.serviceKey && jwtRole(cfg.serviceKey) === 'anon') {
    cfg.problems.push('SUPABASE_SERVICE_ROLE_KEY looks like the public anon key. Payments are disabled.');
    cfg.serviceKey = '';
  }
  cfg.supabaseReady = !!(cfg.supabaseUrl && cfg.anonKey);
  cfg.paymentsReady = !!(cfg.supabaseReady && cfg.serviceKey && cfg.razorpay.keyId && cfg.razorpay.keySecret);
  cfg.webhookReady = !!(cfg.paymentsReady && cfg.razorpay.webhookSecret);
  if ((cfg.razorpay.keyId || cfg.razorpay.keySecret) && !cfg.paymentsReady) cfg.problems.push('Razorpay keys are set but SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are incomplete. Payments are disabled.');
  if (cfg.paymentsReady && !cfg.webhookReady) cfg.problems.push('RAZORPAY_WEBHOOK_SECRET is not set: payments are verified when the buyer returns, but delayed captures and refunds will not be processed.');
  return cfg;
}

// The ONLY values the browser receives. Built field by field so a secret can never slip in by accident.
export function publicConfig(cfg) {
  return {
    SUPABASE_URL: cfg.supabaseReady ? cfg.supabaseUrl : '',
    SUPABASE_ANON_KEY: cfg.supabaseReady ? cfg.anonKey : '',
    CONTACT_EMAIL: cfg.contactEmail,
    MEETING_BASE: cfg.meetingBase,
    PAYMENTS: { enabled: cfg.paymentsReady, provider: 'razorpay', amountPaise: cfg.amountPaise, days: cfg.days, currency: cfg.currency },
  };
}
