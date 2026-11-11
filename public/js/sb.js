// Minimal dependency-free client for Supabase: Auth (GoTrue), Database (PostgREST) and Storage.
// Only the PUBLIC anon key is used here. All real protection is Row Level Security in Postgres.
const KEY = 'askdeen.session.v1';
const safe = fn => { try { return fn(); } catch { return null; } };

export function createClient(baseUrl, anonKey) {
  const url = baseUrl.replace(/\/+$/, '');
  let session = safe(() => JSON.parse(localStorage.getItem(KEY) || 'null'));
  const listeners = new Set();
  let timer = null;

  const save = s => { session = s; safe(() => s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY)); schedule(); };
  const emit = ev => listeners.forEach(f => { try { f(ev, session); } catch (e) { console.error(e); } });
  const toSession = d => ({
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user || session?.user || null,
  });
  function schedule() {
    clearTimeout(timer);
    if (!session) return;
    const ms = Math.max(5000, (session.expires_at * 1000 - Date.now()) - 60000);
    timer = setTimeout(() => refresh().catch(() => {}), Math.min(ms, 2 ** 30));
  }
  let refreshing = null;
  function refresh() {
    if (!session?.refresh_token) return Promise.reject(new Error('no session'));
    if (refreshing) return refreshing;
    refreshing = fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { if (r.status >= 400 && r.status < 500) { save(null); emit('SIGNED_OUT'); } throw new Error(d.msg || d.error_description || 'refresh failed'); }
      save(toSession(d)); emit('TOKEN_REFRESHED'); return session;
    }).finally(() => { refreshing = null; });
    return refreshing;
  }

  async function http(path, { method = 'GET', headers = {}, body, json = true, retry = true } = {}) {
    if (session && session.expires_at * 1000 - Date.now() < 15000 && session.refresh_token) { try { await refresh(); } catch {} }
    const h = { apikey: anonKey, Authorization: `Bearer ${session?.access_token || anonKey}`, ...headers };
    if (json && body !== undefined && !(body instanceof Blob)) h['Content-Type'] = 'application/json';
    const res = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : (json && !(body instanceof Blob) ? JSON.stringify(body) : body) });
    if (res.status === 401 && retry && session?.refresh_token) {
      try { await refresh(); return http(path, { method, headers, body, json, retry: false }); } catch { /* fallthrough */ }
    }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { res, data };
  }
  const fail = (res, data) => ({
    message: (data && (data.message || data.msg || data.error_description || data.error)) || res.statusText || 'Request failed',
    code: data?.code || data?.error_code || String(res.status), details: data?.details || null, status: res.status,
  });

  // ---------------- Auth ----------------
  const auth = {
    get session() { return session; },
    get user() { return session?.user || null; },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signUp(email, password, displayName) {
      const { res, data } = await http('/auth/v1/signup', { method: 'POST', body: { email, password, data: { display_name: displayName } } });
      if (!res.ok) return { error: fail(res, data) };
      if (data?.access_token) { save(toSession(data)); emit('SIGNED_IN'); return { session, needsConfirmation: false }; }
      return { session: null, needsConfirmation: true };
    },
    async signIn(email, password) {
      const { res, data } = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      if (!res.ok) return { error: fail(res, data) };
      save(toSession(data)); emit('SIGNED_IN'); return { session };
    },
    async signOut() {
      if (session) await http('/auth/v1/logout', { method: 'POST' }).catch(() => {});
      save(null); emit('SIGNED_OUT');
    },
    async resetPassword(email, redirectTo) {
      const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      const { res, data } = await http('/auth/v1/recover' + q, { method: 'POST', body: { email } });
      return res.ok ? {} : { error: fail(res, data) };
    },
    async updateUser(attrs) {
      const { res, data } = await http('/auth/v1/user', { method: 'PUT', body: attrs });
      if (!res.ok) return { error: fail(res, data) };
      if (session) { save({ ...session, user: data }); emit('USER_UPDATED'); }
      return { user: data };
    },
    // Email-confirmation and password-recovery links arrive as  #access_token=...&type=recovery
    async consumeUrlSession() {
      const h = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (h.get('error_description')) { history.replaceState(null, '', location.pathname + location.search); return { error: { message: h.get('error_description').replace(/\+/g, ' ') } }; }
      if (!h.get('access_token')) return null;
      const type = h.get('type') || 'signup';
      save({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: Math.floor(Date.now() / 1000) + Number(h.get('expires_in') || 3600), user: null });
      history.replaceState(null, '', location.pathname + location.search);
      const { res, data } = await http('/auth/v1/user');
      if (!res.ok) { save(null); return { error: fail(res, data) }; }
      save({ ...session, user: data }); emit(type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN');
      return { type };
    },
    async restore() {
      if (!session) return null;
      try {
        if (session.expires_at * 1000 - Date.now() < 30000) await refresh();
        const { res, data } = await http('/auth/v1/user');
        if (res.ok) { save({ ...session, user: data }); return session; }
        if (res.status === 401 || res.status === 403) { save(null); }
      } catch { /* offline: keep session */ }
      return session;
    },
  };

  // ---------------- Database ----------------
  const quote = v => { const s = String(v); return /[,()"\\ ]/.test(s) ? `"${s.replace(/["\\]/g, '\\$&')}"` : s; };
  class Query {
    constructor(table) { this.table = table; this.params = []; this.method = 'GET'; this.body = undefined; this.prefer = []; this.hdr = {}; this.mode = 'many'; }
    select(cols = '*', opts = {}) { this.params.push(['select', cols]); if (opts.count) this.prefer.push(`count=${opts.count}`); if (this.method !== 'GET') this.prefer.push('return=representation'); return this; }
    insert(rows) { this.method = 'POST'; this.body = rows; return this; }
    update(vals) { this.method = 'PATCH'; this.body = vals; return this; }
    delete() { this.method = 'DELETE'; return this; }
    upsert(rows, onConflict) { this.method = 'POST'; this.body = rows; this.prefer.push('resolution=merge-duplicates'); if (onConflict) this.params.push(['on_conflict', onConflict]); return this; }
    f(col, op, v) { this.params.push([col, `${op}.${v}`]); return this; }
    eq(c, v) { return this.f(c, 'eq', v); } neq(c, v) { return this.f(c, 'neq', v); }
    gt(c, v) { return this.f(c, 'gt', v); } gte(c, v) { return this.f(c, 'gte', v); } lt(c, v) { return this.f(c, 'lt', v); } lte(c, v) { return this.f(c, 'lte', v); }
    ilike(c, p) { return this.f(c, 'ilike', p); }
    is(c, v) { return this.f(c, 'is', v === null ? 'null' : v); }
    in(c, arr) { return this.f(c, 'in', `(${arr.map(quote).join(',')})`); }
    or(expr) { this.params.push(['or', `(${expr})`]); return this; }
    order(c, { ascending = true } = {}) { const o = this.params.find(p => p[0] === 'order'); const part = `${c}.${ascending ? 'asc' : 'desc'}`; if (o) o[1] += ',' + part; else this.params.push(['order', part]); return this; }
    limit(n) { this.params.push(['limit', n]); return this; }
    range(a, b) { this.params.push(['offset', a]); this.params.push(['limit', b - a + 1]); return this; }
    single() { this.mode = 'single'; return this; } maybeSingle() { this.mode = 'maybe'; return this; }
    async run() {
      const qs = new URLSearchParams(); this.params.forEach(([k, v]) => qs.append(k, v));
      const headers = { ...this.hdr };
      const prefer = [...this.prefer]; if (this.mode !== 'many') headers.Accept = 'application/vnd.pgrst.object+json';
      if (prefer.length) headers.Prefer = prefer.join(',');
      const { res, data } = await http(`/rest/v1/${this.table}${qs.toString() ? '?' + qs : ''}`, { method: this.method, headers, body: this.body });
      if (!res.ok) { if (this.mode === 'maybe' && res.status === 406) return { data: null, error: null }; return { data: null, error: fail(res, data) }; }
      const cr = res.headers.get('content-range'); const count = cr && cr.includes('/') && cr.split('/')[1] !== '*' ? Number(cr.split('/')[1]) : null;
      return { data, error: null, count };
    }
    then(a, b) { return this.run().then(a, b); }
  }
  const from = table => new Query(table);
  async function rpc(fn, args = {}) {
    const { res, data } = await http(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
    return res.ok ? { data, error: null } : { data: null, error: fail(res, data) };
  }

  // ---------------- Storage ----------------
  const storage = {
    async upload(bucket, path, file) {
      const { res, data } = await http(`/storage/v1/object/${bucket}/${path}`, { method: 'POST', body: file, json: false, headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': 'max-age=3600' } });
      return res.ok ? { path, error: null } : { path: null, error: fail(res, data) };
    },
    async signedUrl(bucket, path, expiresIn = 300) {
      const { res, data } = await http(`/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', body: { expiresIn } });
      if (!res.ok) return { url: null, error: fail(res, data) };
      const p = data.signedURL || data.signedUrl; return { url: p.startsWith('http') ? p : `${url}/storage/v1${p.startsWith('/') ? '' : '/'}${p}`, error: null };
    },
    async remove(bucket, paths) {
      const { res, data } = await http(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: paths } });
      return res.ok ? { error: null } : { error: fail(res, data) };
    },
  };

  schedule();
  return { auth, from, rpc, storage, url, anonKey, getToken: () => session?.access_token || null };
}
