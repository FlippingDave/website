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
// GoatCounter (goatcounter.com):
//   GOATCOUNTER_CODE   your site code, e.g. "flippingdave" for flippingdave.goatcounter.com
//                      → the counting script is added to every page automatically
//   GOATCOUNTER_TOKEN  (secret) GoatCounter API key with "Read statistics" → stats in control room
//
// Cloudflare Web Analytics (real-user monitoring):
//   Turn it on in the dashboard (Workers & Pages → project → Metrics → Web Analytics → Enable);
//   Cloudflare injects its beacon itself. Only if you add the site manually instead:
//   CF_BEACON_TOKEN    the token from the JS snippet → beacon added to every page
//   CF_WA_SITE_TAG     the site tag (from the Web Analytics site URL/settings) → stats in control
//                      room, read with the same CF_ACCOUNT_ID / CF_API_TOKEN as above
//
// Housekeeping (optional, plain text variables in the dashboard):
//   STATS_SINCE    reset: only count data from this date/time onwards, e.g. 2026-11-18 or 2026-11-18T09:30
//                  (applies to all three sources in the control room; remove it to see everything again)
//   IGNORE_IPS     comma-separated IP addresses this site's tracker should ignore
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

    const res = await env.ASSETS.fetch(request);
    return injectAnalytics(res, env);
  },
};

// Add the GoatCounter / Cloudflare beacon scripts to HTML pages when configured
function injectAnalytics(res, env) {
  const type = res.headers.get('Content-Type') || '';
  if (!type.includes('text/html')) return res;
  const tags = [];
  const gc = goatCode(env);
  if (gc) tags.push(`<script data-goatcounter="https://${gc}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`);
  const beacon = String(env.CF_BEACON_TOKEN || '').trim();
  if (/^[a-f0-9]{16,64}$/i.test(beacon)) {
    tags.push(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${beacon}"}'></script>`);
  }
  if (!tags.length) return res;
  return new HTMLRewriter()
    .on('head', { element(el) { el.append(tags.join('\n'), { html: true }); } })
    .transform(res);
}

function goatCode(env) {
  const c = String(env.GOATCOUNTER_CODE || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\.goatcounter\.com.*$/, '');
  return /^[a-z0-9-]{2,50}$/.test(c) ? c : '';
}

async function record(request, env, url) {
  if (!env.EVENTS) return;
  const ua = request.headers.get('User-Agent') || '';
  if (BOT_RE.test(ua)) return;
  // Owner opt-out: "Don't track this device" in the control room sets this cookie
  if (/(?:^|;\s*)fd_notrack=1/.test(request.headers.get('Cookie') || '')) return;
  const ipAddr = request.headers.get('CF-Connecting-IP') || '';
  if (ipAddr && String(env.IGNORE_IPS || '').split(/[\s,]+/).includes(ipAddr)) return;

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
  const days = [1, 7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 7;
  // Window = last N days, but never earlier than STATS_SINCE (the "reset" point)
  const end = new Date();
  let start = new Date(end.getTime() - days * 864e5);
  const since = parseSince(env.STATS_SINCE);
  if (since && since > start) start = since;
  if (start > end) start = end;

  const [own, goat, wa] = await Promise.all([
    ownStats(env, start).catch(e => ({ error: e.message })),
    goatStats(env, start, end).catch(e => ({ configured: true, error: e.message })),
    webAnalyticsStats(env, start, end).catch(e => ({ configured: true, error: e.message })),
  ]);
  return json({ days, since: since ? since.toISOString() : undefined, ...own, goatcounter: goat, webAnalytics: wa });
}

function parseSince(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s);
  return isNaN(d) ? null : d;
}

/* ── Our own tracking (Analytics Engine) ── */
async function ownStats(env, start) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return { error: 'Tracking is recording, but stats can’t be read yet: add CF_ACCOUNT_ID and the CF_API_TOKEN secret (Account Analytics: Read) in the Cloudflare project settings.' };
  }
  const since = `timestamp >= toDateTime('${start.toISOString().slice(0, 19).replace('T', ' ')}')`;
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
  if (errors.length === keys.length) return { error: `Could not query Analytics Engine — ${errors[0]}` };

  const one = rows => Number(rows[0] && rows[0].n) || 0;
  return {
    totals: { views: one(out.views), clicks: one(out.clicks), visitors: one(out.visitors) },
    daily: out.daily.map(r => ({ day: String(r.day).slice(0, 10), n: Number(r.n) || 0 })),
    buttons: out.buttons, pages: out.pages, countries: out.countries,
    referrers: out.referrers, devices: out.devices, recent: out.recent,
    errors: errors.length ? errors : undefined,
  };
}

/* ── GoatCounter API ── */
async function goatStats(env, start, end) {
  const code = goatCode(env);
  if (!code) return { configured: false };
  const dashboard = `https://${code}.goatcounter.com`;
  if (!env.GOATCOUNTER_TOKEN) return { configured: true, dashboard, error: 'Counting is on. Add the GOATCOUNTER_TOKEN secret to see the numbers here.' };

  const q = `start=${start.toISOString().slice(0, 19)}Z&end=${end.toISOString().slice(0, 19)}Z`;
  const get = async path => {
    const r = await fetch(`${dashboard}/api/v0${path}`, {
      headers: { Authorization: `Bearer ${env.GOATCOUNTER_TOKEN}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`GoatCounter API ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  };
  const [total, hits] = await Promise.all([
    get(`/stats/total?${q}`),
    get(`/stats/hits?${q}&limit=30`),
  ]);
  const rows = (hits.hits || []).map(h => ({ k: h.event ? h.title || h.path : h.path, n: h.count, event: !!h.event }));
  return {
    configured: true, dashboard,
    visitors: Number(total.total) || 0,
    events: Number(total.total_events) || 0,
    pages: rows.filter(r => !r.event).slice(0, 15),
    clicks: rows.filter(r => r.event).slice(0, 15),
  };
}

/* ── Cloudflare Web Analytics (RUM) via GraphQL ── */
async function webAnalyticsStats(env, start, end) {
  const siteTag = String(env.CF_WA_SITE_TAG || '').trim();
  const dashboard = env.CF_ACCOUNT_ID ? `https://dash.cloudflare.com/${env.CF_ACCOUNT_ID}/web-analytics` : 'https://dash.cloudflare.com/?to=/:account/web-analytics';
  if (!siteTag) return { configured: false, dashboard };
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return { configured: true, dashboard, error: 'Add CF_ACCOUNT_ID and CF_API_TOKEN to read Web Analytics here.' };

  const query = `query($account: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
    viewer { accounts(filter: { accountTag: $account }) {
      total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) { count sum { visits } }
      paths: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10, orderBy: [count_DESC]) { count dimensions { k: requestPath } }
      countries: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10, orderBy: [count_DESC]) { count dimensions { k: countryName } }
      referrers: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10, orderBy: [count_DESC]) { count dimensions { k: refererHost } }
    } }
  }`;
  const variables = {
    account: env.CF_ACCOUNT_ID,
    filter: { AND: [
      { datetime_geq: start.toISOString(), datetime_leq: end.toISOString() },
      { siteTag },
    ] },
  };
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || (body.errors && body.errors.length)) {
    throw new Error(`Web Analytics API: ${(body.errors && body.errors[0] && body.errors[0].message) || r.status}`);
  }
  const a = (body.data && body.data.viewer && body.data.viewer.accounts && body.data.viewer.accounts[0]) || {};
  const t = (a.total && a.total[0]) || {};
  const list = rows => (rows || []).map(x => ({ k: x.dimensions.k || '(direct)', n: x.count }));
  return {
    configured: true, dashboard,
    pageViews: Number(t.count) || 0,
    visits: Number(t.sum && t.sum.visits) || 0,
    pages: list(a.paths), countries: list(a.countries), referrers: list(a.referrers),
  };
}

function clip(s, max) { return String(s).replace(/[\u0000-\u001f]/g, '').slice(0, max); }

async function hash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
