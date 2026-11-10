// Shared app state + helpers used by every page. (Kept separate from app.js to avoid import cycles.)
import { createClient } from './sb.js';
import { t, getLang } from './i18n.js';

export const S = { sb: null, cfg: window.ASKDEEN || {}, user: null, profile: null, scholar: null, cats: [], premium: false, unread: 0, go: () => {}, refreshShell: () => {} };

export const isConfigured = () => !!(S.cfg.SUPABASE_URL && S.cfg.SUPABASE_ANON_KEY);
export function initClient() { S.sb = createClient(S.cfg.SUPABASE_URL, S.cfg.SUPABASE_ANON_KEY); return S.sb; }
export const isAdmin = () => S.profile?.role === 'admin';
export const isScholarRole = () => ['scholar', 'admin'].includes(S.profile?.role) && !!S.scholar;
export const isVerifiedScholar = () => isScholarRole() && S.scholar?.verified && !S.profile?.suspended;

export async function loadProfile() {
  S.user = S.sb.auth.user; S.profile = null; S.scholar = null; S.premium = false;
  if (!S.user) return;
  const p = await S.sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  S.profile = p.data;
  if (!S.profile) return;
  const [sc, sub] = await Promise.all([
    S.sb.from('scholars').select('*').eq('id', S.user.id).maybeSingle(),
    S.sb.from('subscriptions').select('status,current_period_end').eq('user_id', S.user.id).eq('status', 'active').limit(1),
  ]);
  S.scholar = sc.data || null;
  const s = sub.data?.[0]; S.premium = !!s && (!s.current_period_end || new Date(s.current_period_end) > new Date());
}
export async function loadCategories() {
  const { data } = await S.sb.from('categories').select('*').eq('active', true).order('sort_order');
  S.cats = data || [];
}
export const catById = id => S.cats.find(c => c.id === id);
export const catName = c => c ? (getLang() === 'en' ? c.name_en : c.name_hi) : '';

// Turn database / network errors into friendly, translated messages.
export function errMsg(e) {
  const m = `${e?.message || ''} ${e?.code || ''}`;
  if (/CONTACT_INFO/.test(m)) return t('err.contact');
  if (/RATE_LIMIT/.test(m)) return t('err.rate');
  if (/SUSPENDED/.test(m)) return t('err.suspended');
  if (/23505|duplicate key/.test(m)) return t('err.dup');
  if (/QUESTION_NOT_OPEN/.test(m)) return t('err.notopen');
  if (/row-level security|42501|FORBIDDEN|permission denied/.test(m)) return t('err.forbidden');
  if (/Invalid login/i.test(m)) return t('err.login');
  if (/already registered|already been registered/i.test(m)) return t('err.exists');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return t('err.network');
  if (/email.*not.*confirmed/i.test(m)) return t('err.unconfirmed');
  if (/weak|at least \d+ char/i.test(m)) return t('err.weak');
  return e?.message || t('err.generic');
}
export function requireAuth(ctx) {
  if (S.user && S.profile) return true;
  S.go('/login?next=' + encodeURIComponent(location.pathname + location.search), true); return false;
}
