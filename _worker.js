// Cloudflare Worker — static assets + visitor/click tracking + stats API
//
// Tracking is written to Workers Analytics Engine (binding EVENTS → dataset "site_events").
// Reading stats back uses the Analytics Engine SQL API, which needs two settings
// (Cloudflare dashboard → this project → Settings → Variables and Secrets):
//   CF_ACCOUNT_ID  your Cloudflare account ID
//   CF_API_TOKEN   (secret) an API token with "Account Analytics: Read"
// Optional:
//   STATS_KEY      (secret) if set, the control-room stats ask for this key
//   HASH_SALT      (secret) salt for the anonymous daily visitor ID
//
// Data point layout (site_events):
//   blob1 type ('view' | 'click')   blob2 name (button / page)   blob3 page path
//   blob4 referrer host             blob5 country                blob6 city
//   blob7 device                    blob8 anonymous daily visitor id
//   double1 = 1                     index1 = type

const DATASET = 'site_events';
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|facebookexternalhit|embedly|whatsapp/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // POST /api/track  (and legacy /api/click)
    if ((url.pathname === '/api/track' || url.pathname === '/api/click') && request.method === 'POST') {
      try { await record(request, env, url); } catch { /* never break the page over analytics */ }
      return new Response('ok', { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }

    // GET /api/stats?days=7
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      return stats(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function record(request, env, url) {
  if (!env.EVENTS) return;
  const ua = request.headers.get('User-Agent') || '';
  if (BOT_RE.test(ua)) return;

  const body = JSON.parse(await request.text() || '{}');
  // legacy payload: { button }
  const type = body.type === 'view' ? 'view' : 'click';
  const name = clip(body.name || body.button || '', 96);
  if (type === 'click' && !name) return;

  const path = clip(body.path || '/', 96);
  let refHost = '(direct)';
  if (body.ref) {
    try {
      const r = new URL(body.ref);
      refHost = r.host === url.host ? '(internal)' : r.host.replace(/^www\./, '');
    } catch { refHost = '(unknown)'; }
  }

  const cf = request.cf || {};
  const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const day = new Date().toISOString().slice(0, 10);
  const visitor = await hash(`${env.HASH_SALT || 'flippingdave'}|${day}|${ip}|${ua}`);

  env.EVENTS.writeDataPoint({
    blobs: [type, type === 'view' ? path : name, path, refHost, cf.country || '', clip(cf.city || '', 48), device, visitor],
    doubles: [1],
    indexes: [type],
  });
}

async function stats(request, env, url) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (env.STATS_KEY && request.headers.get('X-Stats-Key') !== env.STATS_KEY) {
    return json({ error: 'Stats key required.' }, 401);
  }
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return json({ error: 'Tracking is recording, but stats can’t be read yet: add CF_ACCOUNT_ID and the CF_API_TOKEN secret (Account Analytics: Read) in the Cloudflare project settings.' });
  }

  const days = [1, 7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 7;
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  const n = 'SUM(_sample_interval)';
  const top = (blob, type, limit = 15) =>
    `SELECT ${blob} AS k, ${n} AS n FROM ${DATASET} WHERE blob1 = '${type}' AND ${since} GROUP BY k ORDER BY n DESC LIMIT ${limit}`;

  const queries = {
    views:     `SELECT ${n} AS n FROM ${DATASET} WHERE blob1 = 'view' AND ${since}`,
    clicks:    `SELECT ${n} AS n FROM ${DATASET} WHERE blob1 = 'click' AND ${since}`,
    visitors:  `SELECT COUNT(DISTINCT blob8) AS n FROM ${DATASET} WHERE blob1 = 'view' AND ${since}`,
    daily:     `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ${n} AS n FROM ${DATASET} WHERE blob1 = 'view' AND ${since} GROUP BY day ORDER BY day`,
    buttons:   top('blob2', 'click', 40),
    pages:     top('blob3', 'view'),
    countries: top('blob5', 'view'),
    referrers: top('blob4', 'view'),
    devices:   top('blob7', 'view'),
    recent:    `SELECT timestamp AS t, blob1 AS type, blob2 AS name, blob3 AS path, blob5 AS country, blob6 AS city, blob7 AS device FROM ${DATASET} WHERE ${since} ORDER BY timestamp DESC LIMIT 25`,
  };

  const run = async sql => {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
      body: sql,
    });
    if (!r.ok) throw new Error(`SQL API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).data || [];
  };

  const keys = Object.keys(queries);
  const results = await Promise.allSettled(keys.map(k => run(queries[k])));
  const out = {}; const errors = [];
  keys.forEach((k, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') out[k] = r.value;
    else { out[k] = []; errors.push(`${k}: ${r.reason && r.reason.message}`); }
  });
  if (errors.length === keys.length) return json({ error: `Could not query Analytics Engine — ${errors[0]}` });

  const one = rows => Number(rows[0] && rows[0].n) || 0;
  return json({
    days,
    totals: { views: one(out.views), clicks: one(out.clicks), visitors: one(out.visitors) },
    daily: out.daily.map(r => ({ day: String(r.day).slice(0, 10), n: Number(r.n) || 0 })),
    buttons: out.buttons, pages: out.pages, countries: out.countries,
    referrers: out.referrers, devices: out.devices, recent: out.recent,
    errors: errors.length ? errors : undefined,
  });
}

function clip(s, max) { return String(s).replace(/[\u0000-\u001f]/g, '').slice(0, max); }

async function hash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
