// filbac gateway: ONE backend address for every frontend of the Stockholm isochrone map.
// It owns no data and no algorithm. It forwards to the teams that do, over loopback:
//   /t/filbac/api/isochrone   POST -> marlin     /t/marlin/isochrone   (cached briefly, gzipped)
//   /t/filbac/api/modes       GET  -> marlin     /t/marlin/modes
//   /t/filbac/api/walk        GET  -> mareri     /t/mareri/walk
//   /t/filbac/api/stops       GET  -> vijay-team /t/vijay-team/stops
//   /t/filbac/api/nearby      GET  -> vijay-team /t/vijay-team/nearby
//   /t/filbac/api/routes      GET  -> vijay-team /t/vijay-team/routes
//   /t/filbac/api/shape/...   GET  -> vijay-team /t/vijay-team/shape/...
//   /t/filbac/api/meta        GET  -> vijay-team /t/vijay-team/meta
//   /t/filbac/api/health      GET  aggregated health of every upstream
//   /t/filbac/api             GET  this route table as JSON
// Owners keep their contracts; the gateway passes status, body and errors through unchanged.
'use strict';

const zlib = require('zlib');

const PORT = Number(process.env.PORT || 8180);
const BASE = 'http://127.0.0.1:' + PORT;
const TIMEOUT_MS = 25000;
const MAX_BODY = 64 * 1024;

const ROUTES = {
  isochrone: { team: 'marlin', path: 'isochrone', methods: ['POST'] },
  modes: { team: 'marlin', path: 'modes', methods: ['GET'] },
  walk: { team: 'mareri', path: 'walk', methods: ['GET'] },
  stops: { team: 'vijay-team', path: 'stops', methods: ['GET'] },
  nearby: { team: 'vijay-team', path: 'nearby', methods: ['GET'] },
  routes: { team: 'vijay-team', path: 'routes', methods: ['GET'] },
  meta: { team: 'vijay-team', path: 'meta', methods: ['GET'] },
  shape: { team: 'vijay-team', path: 'shape', methods: ['GET'], prefix: true },
};

const HEALTH = [
  { name: 'engine', team: 'marlin', path: 'health' },
  { name: 'data', team: 'vijay-team', path: 'meta' },
];

// Identical isochrone requests are answered from memory for a short while:
// vijay-team's load test showed 60+ min queries get slow with many phones at once.
const CACHE_TTL_MS = 120000;
const CACHE_MAX = 40;
const CACHE_MAX_BYTES = 6 * 1024 * 1024;
const cache = new Map();
const stats = { requests: 0, cacheHits: 0, upstreamErrors: 0 };

// fetch() decodes gzip, so content-encoding is never passed on; the gateway gzips again itself.
const PASS_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];
const SAFE_SEGMENT = /^[\p{L}\p{N}_\- ]+$/u;

function sendJson(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function gatewayError(res, status, code, en, sv, extra) {
  sendJson(res, status, Object.assign({ error: code, message: en, message_sv: sv }, extra || {}));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// One upstream call. Always resolves: {status, headers, body} or {error}.
// Loopback fetch to the owner's plugin, never via the Host header (spores backend-4, backend-8).
async function upstream(method, team, subpath, search, body) {
  const target = '/t/' + encodeURIComponent(team) + '/' + subpath;
  // No traversal out of the owner's prefix (spore platforms-6).
  if (new URL(target, BASE).pathname !== target) return { error: 'bad path' };
  try {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    const r = await fetch(BASE + target + (search || ''), {
      method, headers, body: body || undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const h = {};
    r.headers.forEach((v, k) => { h[k] = v; });
    return { status: r.status, headers: h, body: buf };
  } catch (e) {
    return { error: (e && e.message) || 'upstream failed' };
  }
}

function gzip(buf) {
  return new Promise((resolve) => {
    zlib.gzip(buf, (err, out) => resolve(err ? null : out));
  });
}

function relay(res, up, extraHeaders, gzBody) {
  if (res.headersSent) return;
  const h = { 'x-served-by': 'filbac-gateway' };
  for (const k of PASS_HEADERS) if (up.headers[k]) h[k] = up.headers[k];
  Object.assign(h, extraHeaders || {});
  if (gzBody) {
    h['content-encoding'] = 'gzip';
    h.vary = 'accept-encoding';
  }
  res.writeHead(up.status, h);
  res.end(gzBody || up.body);
}

function wantsGzip(req) {
  return /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key, entry) {
  if (entry.up.status !== 200 || entry.up.body.length > CACHE_MAX_BYTES) return;
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function routeTable() {
  const api = {};
  for (const [name, r] of Object.entries(ROUTES)) {
    api[name] = {
      methods: r.methods,
      url: '/t/filbac/api/' + name + (r.prefix ? '/...' : ''),
      owner: r.team,
      upstream: '/t/' + r.team + '/' + r.path + (r.prefix ? '/...' : ''),
    };
  }
  api.health = { methods: ['GET'], url: '/t/filbac/api/health', owner: 'filbac' };
  return {
    service: 'filbac gateway: one backend for the Stockholm isochrone map',
    contract: 'projects/filbac/GATEWAY.md',
    api,
    stats: Object.assign({ cached: cache.size }, stats),
  };
}

async function health(res) {
  const checks = await Promise.all(HEALTH.map(async (h) => {
    const t0 = Date.now();
    const up = await upstream('GET', h.team, h.path, '', null);
    const ok = !up.error && up.status >= 200 && up.status < 300;
    return { name: h.name, owner: h.team, ok, status: up.status || null, ms: Date.now() - t0, error: up.error || undefined };
  }));
  const ok = checks.every((c) => c.ok);
  sendJson(res, ok ? 200 : 503, { ok, upstreams: checks, gateway: Object.assign({ cached: cache.size }, stats) });
}

async function isochrone(req, res, url, body) {
  const key = body.toString('utf8');
  const gz = wantsGzip(req);
  let entry = cacheGet(key);
  let state = 'hit';
  if (entry) {
    stats.cacheHits++;
  } else {
    state = 'miss';
    const up = await upstream('POST', 'marlin', 'isochrone', url.search, body);
    if (up.error) return false;
    entry = { at: Date.now(), up, gz: null };
    cachePut(key, entry);
  }
  let gzBody = null;
  if (gz && entry.up.body.length > 1024) {
    if (!entry.gz) entry.gz = await gzip(entry.up.body);
    gzBody = entry.gz;
  }
  relay(res, entry.up, { 'x-gateway-cache': state }, gzBody);
  return true;
}

module.exports = {
  async handle(req, res, ctx) {
    const url = new URL(req.url, 'http://x');
    const p = String((ctx && ctx.path) || '').replace(/^\/+|\/+$/g, '');

    if (p === '' || p === 'api') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      sendJson(res, 200, routeTable());
      return true;
    }
    if (!p.startsWith('api/')) return false;

    const rest = p.slice(4);
    if (rest === 'health') { await health(res); return true; }

    const [name, ...tail] = rest.split('/');
    const route = ROUTES[name];
    if (!route || (tail.length && !route.prefix) || (route.prefix && !tail.length)) return false;
    if (!tail.every((s) => SAFE_SEGMENT.test(s))) {
      gatewayError(res, 400, 'bad_request', 'Invalid path.', 'Ogiltig sökväg.');
      return true;
    }

    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (!route.methods.includes(method)) {
      res.writeHead(405, { allow: route.methods.join(', ') });
      res.end();
      return true;
    }

    stats.requests++;
    let body = null;
    if (method === 'POST') {
      try {
        body = await readBody(req);
      } catch (e) {
        gatewayError(res, e.status || 400, 'bad_request', 'Could not read the request body.', 'Kunde inte läsa förfrågan.');
        return true;
      }
    }

    let ok;
    if (name === 'isochrone') {
      ok = await isochrone(req, res, url, body);
    } else {
      const subpath = route.path + (tail.length ? '/' + tail.map(encodeURIComponent).join('/') : '');
      const up = await upstream(method, route.team, subpath, url.search, body);
      ok = !up.error;
      if (ok) {
        const gzBody = wantsGzip(req) && up.body.length > 1024 ? await gzip(up.body) : null;
        relay(res, up, null, gzBody);
      }
    }
    if (!ok) {
      stats.upstreamErrors++;
      gatewayError(res, 502, 'upstream_unavailable',
        'The ' + route.team + ' service did not answer. Try again in a moment.',
        'Tjänsten ' + route.team + ' svarade inte. Försök igen om en stund.',
        { owner: route.team });
    }
    return true;
  },
};
