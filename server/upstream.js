// Thin clients for the two outside services the server talks to. Secrets live only in this process.
const TIMEOUT = 9000;

async function call(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method, headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

export function supabaseClient(cfg) {
  const base = cfg.supabaseUrl;
  const svc = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` };
  const anon = { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` };
  return {
    // Who is this access token really? Asked to Supabase Auth, never decoded locally.
    async authUser(token) {
      const r = await call(`${base}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` } });
      return r.ok && r.data?.id ? r.data : null;
    },
    rpc: (fn, args) => call(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: svc, body: args }),     // service role
    selectService: path => call(`${base}/rest/v1/${path}`, { headers: svc }),                                 // service role
    selectPublic: path => call(`${base}/rest/v1/${path}`, { headers: anon }),                                 // anon: only what RLS/views expose
  };
}

export function razorpayClient(cfg) {
  const { keyId, keySecret, apiBase } = cfg.razorpay;
  const auth = { Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') };
  return {
    createOrder: body => call(`${apiBase}/v1/orders`, { method: 'POST', headers: auth, body }),
    getPayment: id => call(`${apiBase}/v1/payments/${encodeURIComponent(id)}`, { headers: auth }),
  };
}
