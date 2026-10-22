// filbac gateway: ONE backend address for every frontend of the Stockholm isochrone map.
// It owns no data and no algorithm. It forwards to the teams that do, over loopback:
//   /t/filbac/api/isochrone   POST -> marlin     /t/marlin/isochrone   (cached briefly, gzipped)
//                                   modes [] or ["walk"] -> walk-only bands via mareri /t/mareri/walk
//   /t/filbac/api/modes       GET  -> marlin     /t/marlin/modes
//   /t/filbac/api/walk        GET  -> mareri     /t/mareri/walk
//   /t/filbac/api/stops       GET  -> vijay-team /t/vijay-team/stops
//   /t/filbac/api/nearby      GET  -> vijay-team /t/vijay-team/nearby
//   /t/filbac/api/routes      GET  -> vijay-team /t/vijay-team/routes
//   /t/filbac/api/shape/...   GET  -> vijay-team /t/vijay-team/shape/...
//   /t/filbac/api/meta        GET  -> vijay-team /t/vijay-team/meta
//   /t/filbac/api/health      GET  aggregated health of every upstream
//   /t/filbac/api             GET  this route table as JSON
//   /t/filbac/tasks           group task board (see tasks.js), page at /colony/filbac/
// Owners keep their contracts; the gateway passes status, body and errors through unchanged.
'use strict';

const zlib = require('zlib');
const tasks = require('./tasks');

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

// Walk-only mode: modes [] or ["walk"] gives walking areas in marlin's band format.
// Bands up to 30 min use mareri's street network (/t/mareri/walk); longer bands, or any band
// when mareri is down, use a straight-line estimate, marked with properties.source.
const WALK_STREET_MAX = 30;
const WALK_DETOUR = 1.3;
const WALK_MAX_BANDS = 24;

function first(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}

function parseWalkRequest(json) {
  const o = json.origin || json.from || json.start || {};
  const lat = Number(first(o.lat, o.latitude));
  const lon = Number(first(o.lon, o.lng, o.longitude));
  const w = json.walking || json.walk || {};
  const speed = Number(first(w.speedKmh, w.speed_kmh, 4.8));
  const max = Number(first(json.maxTravelMinutes, json.max_travel_min, json.maxTravelMin, json.minutes, 30));
  let band = Number(first(json.bandMinutes, json.band_min, json.bandMin, json.step, 5));
  if (!(lat >= 58.5 && lat <= 60.5 && lon >= 17 && lon <= 19.5)) {
    return { error: ['origin must be a point in the Stockholm region.', 'origin måste vara en punkt i Stockholmsregionen.'] };
  }
  if (!Number.isInteger(max) || max < 5 || max > 120) {
    return { error: ['maxTravelMinutes must be a whole number from 5 to 120.', 'maxTravelMinutes måste vara ett heltal från 5 till 120.'] };
  }
  if (!Number.isInteger(band) || band < 1 || band > 30) {
    return { error: ['bandMinutes must be a whole number from 1 to 30.', 'bandMinutes måste vara ett heltal från 1 till 30.'] };
  }
  if (!(speed >= 1 && speed <= 10)) {
    return { error: ['walking.speedKmh must be between 1 and 10.', 'walking.speedKmh måste vara mellan 1 och 10.'] };
  }
  band = Math.max(band, Math.ceil(max / WALK_MAX_BANDS));
  return { lat, lon, speed, max, band };
}

function estimateKm(minutes, speedKmh) {
  return (speedKmh * minutes) / 60 / WALK_DETOUR;
}

function circle(lat, lon, km) {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    ring.push([+(lon + dLon * Math.cos(a)).toFixed(5), +(lat + dLat * Math.sin(a)).toFixed(5)]);
  }
  return { type: 'MultiPolygon', coordinates: [[ring]] };
}

// Largest distance (km) from the origin to any vertex of a GeoJSON geometry.
function extentKm(lat, lon, geometry) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  let max = 0;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      const d = Math.hypot((c[0] - lon) * kx, (c[1] - lat) * 111.32);
      if (d > max) max = d;
    } else {
      for (const x of c) walk(x);
    }
  };
  walk((geometry && geometry.coordinates) || []);
  return max;
}

async function streetBand(q, minutes) {
  const search = '?lat=' + q.lat + '&lon=' + q.lon + '&minutes=' + minutes + '&speedKmh=' + q.speed;
  const up = await upstream('GET', 'mareri', 'walk', search, null);
  if (!up.error && up.status === 200) {
    try {
      const f = JSON.parse(up.body.toString('utf8'));
      if (f && f.geometry) return f.geometry;
    } catch (e) { /* treated as unavailable */ }
  }
  return null;
}

// Bands must nest: every band holds all nearer bands. Street bands come from mareri (<= 30 min).
// Estimate discs are centred on the origin; a disc whose radius reaches the farthest vertex of the
// street area holds that whole area, so the estimate radius is never below the street extent
// (scaled by t / t_street) nor below the previous band. If any street band is missing, every band
// is an estimate, so a gap can never put a smaller street band outside a larger one.
async function walkOnly(q) {
  const t0 = Date.now();
  const edges = [];
  for (let m = q.band; m < q.max; m += q.band) edges.push(m);
  edges.push(q.max);
  const streetEdges = edges.filter((m) => m <= WALK_STREET_MAX);
  const street = await Promise.all(streetEdges.map((m) => streetBand(q, m)));
  const allStreet = street.every(Boolean);
  let ref = null;
  if (allStreet && street.length) {
    const last = street[street.length - 1];
    ref = { minutes: streetEdges[streetEdges.length - 1], km: extentKm(q.lat, q.lon, last) };
  }
  let prevKm = 0;
  const parts = edges.map((m, i) => {
    if (allStreet && i < street.length) return { geometry: street[i], source: 'street' };
    let km = Math.max(estimateKm(m, q.speed), prevKm);
    if (ref) km = Math.max(km, ref.km * 1.01 * (m / ref.minutes));
    prevKm = km;
    return { geometry: circle(q.lat, q.lon, km), source: 'estimate' };
  });
  const features = edges.map((to, i) => ({
    type: 'Feature',
    properties: {
      fromMinutes: i ? edges[i - 1] : 0, toMinutes: to,
      from_min: i ? edges[i - 1] : 0, to_min: to,
      bandIndex: i + 1, stops: 0, mode: 'walk', source: parts[i].source,
    },
    geometry: parts[i].geometry,
  })).reverse();
  const sources = new Set(parts.map((p) => p.source));
  return {
    type: 'FeatureCollection',
    meta: {
      origin: { lat: q.lat, lon: q.lon },
      bandMinutes: q.band, maxTravelMinutes: q.max, walkOnly: true, modes: ['walk'],
      speedKmh: q.speed, stopsReached: 0, computedMs: Date.now() - t0,
      source: sources.size > 1 ? 'mixed' : [...sources][0],
      algorithm: 'walk-only (mareri street network, straight-line estimate beyond ' + WALK_STREET_MAX + ' min)',
      cumulativeBands: true,
    },
    features,
  };
}

// Decide what an isochrone body means: walk-only, transit with "walk" stripped, or untouched.
function classify(body) {
  let json;
  try { json = JSON.parse(body.toString('utf8')); } catch (e) { return { kind: 'pass' }; }
  if (!json || typeof json !== 'object' || !Array.isArray(json.modes)) return { kind: 'pass' };
  const transit = json.modes.filter((m) => m !== 'walk');
  if (transit.length === 0) return { kind: 'walk', json };
  if (transit.length !== json.modes.length) {
    return { kind: 'pass', body: Buffer.from(JSON.stringify(Object.assign({}, json, { modes: transit }))) };
  }
  return { kind: 'pass' };
}

async function isochrone(req, res, url, body) {
  const key = body.toString('utf8');
  const gz = wantsGzip(req);
  let entry = cacheGet(key);
  let state = 'hit';
  let engine = 'marlin';
  if (entry) {
    stats.cacheHits++;
    engine = entry.engine || 'marlin';
  } else {
    state = 'miss';
    const c = classify(body);
    if (c.kind === 'walk') {
      engine = 'walk';
      const q = parseWalkRequest(c.json);
      if (q.error) {
        gatewayError(res, 400, 'bad_request', q.error[0], q.error[1]);
        return true;
      }
      const out = Buffer.from(JSON.stringify(await walkOnly(q)));
      entry = { at: Date.now(), engine, gz: null,
        up: { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: out } };
    } else {
      const up = await upstream('POST', 'marlin', 'isochrone', url.search, c.body || body);
      if (up.error) return false;
      entry = { at: Date.now(), engine, up, gz: null };
    }
    cachePut(key, entry);
  }
  let gzBody = null;
  if (gz && entry.up.body.length > 1024) {
    if (!entry.gz) entry.gz = await gzip(entry.up.body);
    gzBody = entry.gz;
  }
  relay(res, entry.up, { 'x-gateway-cache': state, 'x-gateway-engine': engine }, gzBody);
  return true;
}

module.exports = {
  init(ctx) {
    try { tasks.load(ctx.dataDir); } catch (e) { console.error('[filbac] tasks load', e && e.message); }
  },

  onMessage(m, ctx) {
    tasks.onMessage(m, ctx.board);
  },

  async handle(req, res, ctx) {
    const url = new URL(req.url, 'http://x');
    const p = String((ctx && ctx.path) || '').replace(/^\/+|\/+$/g, '');

    if (p === 'tasks' || p.startsWith('tasks/')) {
      return tasks.handle(req, res, p.slice(6), ctx.board, readBody);
    }

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
