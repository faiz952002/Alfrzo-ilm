// Server-side SEO for a single-page app: per-question <title>/description tags and a sitemap.
// Only data from the public `question_feed` view is used (published questions, never who asked).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();

class TtlCache {
  constructor(max, ttl) { this.max = max; this.ttl = ttl; this.m = new Map(); }
  get(k) { const e = this.m.get(k); if (!e) return undefined; if (e.t < Date.now()) { this.m.delete(k); return undefined; } return e.v; }
  set(k, v) { if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value); this.m.set(k, { v, t: Date.now() + this.ttl }); }
}

export function seo(cfg, sb) {
  const qCache = new TtlCache(500, 5 * 60_000), mapCache = new TtlCache(1, 10 * 60_000);

  async function question(id) {
    if (!cfg.supabaseReady || !UUID.test(id)) return null;
    const hit = qCache.get(id); if (hit !== undefined) return hit;
    let v = null;
    try { const r = await sb.selectPublic(`question_feed?id=eq.${id}&select=title,body&limit=1`); v = r.ok ? r.data?.[0] || null : null; } catch { return null; }   // do not cache failures
    qCache.set(id, v); return v;
  }

  // Replaces the <!--seo:start-->…<!--seo:end--> block of index.html for /q/:id
  async function injectQuestion(html, id, origin) {
    const q = await question(id); if (!q) return html;
    const title = oneLine(q.title).slice(0, 70) + ' · Alfrzo Ilm';
    const desc = oneLine(q.body || q.title).slice(0, 155);
    const url = `${origin}/q/${id}`;
    const block = `<!--seo:start-->
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Alfrzo Ilm">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<!--seo:end-->`;
    return html.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, () => block);
  }

  async function sitemap(origin) {
    let ids = mapCache.get('ids');
    if (!ids) {
      ids = [];
      if (cfg.supabaseReady) { try { const r = await sb.selectPublic('question_feed?select=id,created_at&order=created_at.desc&limit=2000'); if (r.ok && Array.isArray(r.data)) ids = r.data; } catch { /* serve static pages only */ } }
      mapCache.set('ids', ids);
    }
    const stat = ['/', '/qa', '/scholars', '/categories', '/privacy', '/premium'];
    const u = (loc, last) => `<url><loc>${esc(origin + loc)}</loc>${last ? `<lastmod>${esc(String(last).slice(0, 10))}</lastmod>` : ''}</url>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${stat.map(p => u(p)).join('\n')}\n${ids.map(q => u('/q/' + q.id, q.created_at)).join('\n')}\n</urlset>\n`;
  }

  return { injectQuestion, sitemap };
}
