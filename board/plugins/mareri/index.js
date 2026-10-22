'use strict';

/**
 * mareri - street-network walking areas for the isochrone tile.
 *
 * Mounted on /t/mareri/.
 *
 *   GET /t/mareri/walk?lat=59.33&lon=18.06&minutes=10[&speedKmh=4.8]
 *     -> GeoJSON Feature (Polygon/MultiPolygon): where you really can walk to in
 *        that time along streets and paths (OSM data, Valhalla pedestrian
 *        routing), not a straight-line circle.
 *
 * Errors: {error, message, message_sv} with status 400 / 502 / 504.
 */

const zlib = require('zlib');
const iso = require('./iso.js');
const street = require('./street.js');
const journey = require('./journey.js');

const VALHALLA = 'https://valhalla1.openstreetmap.de/isochrone';
const USER_AGENT = 'agentworkshop-mareri-isochrone-tile/1.0 (workshop demo)';
const TIMEOUT_MS = 12000;
const CACHE_LIMIT = 200;
const MIN_INTERVAL_MS = 250;

const cache = new Map();
let nextSlot = 0;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function fail(res, status, error, message, messageSv) {
  send(res, status, { error, message, message_sv: messageSv });
}

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

function upstreamError(msg) {
  const e = new Error(msg);
  e.upstream = true;
  return e;
}

function noNetworkError() {
  const e = new Error('no walkable network at this point');
  e.noNetwork = true;
  return e;
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Off-road origins make the router answer with a speck at the origin or with an area elsewhere;
// neither nests with the other durations, so they are refused instead of returned.
function usableArea(geom, lat, lon, minutes, speedKmh) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const wantMetres = (speedKmh * 1000 / 60) * minutes * 0.3;
  const kLon = Math.cos(lat * Math.PI / 180) * 111320;
  const nearRing = (r) => r.some(([x, y]) => Math.hypot((x - lon) * kLon, (y - lat) * 111320) < 150);
  if (!polys.some((p) => inRing(lon, lat, p[0]) || nearRing(p[0]))) return false;
  let reach = 0;
  for (const p of polys) {
    for (const [x, y] of p[0]) reach = Math.max(reach, Math.hypot((x - lon) * kLon, (y - lat) * 111320));
  }
  return reach >= Math.min(wantMetres, 150);
}

async function walkArea(lat, lon, minutes, speedKmh) {
  const key = [lat.toFixed(4), lon.toFixed(4), minutes, speedKmh].join('|');
  if (cache.has(key)) return cache.get(key);

  // Be polite to the public router: at most one call per MIN_INTERVAL_MS.
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));

  const query = {
    locations: [{ lat, lon }],
    costing: 'pedestrian',
    costing_options: { pedestrian: { walking_speed: speedKmh } },
    contours: [{ time: minutes }],
    polygons: true,
    denoise: 0.3,
    generalize: 20,
  };
  const url = VALHALLA + '?json=' + encodeURIComponent(JSON.stringify(query));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw upstreamError('router HTTP ' + r.status);
  const data = await r.json();
  const feat = data && data.features && data.features[0];
  if (!feat || !feat.geometry) throw upstreamError('router returned no area');

  if (!usableArea(feat.geometry, lat, lon, minutes, speedKmh)) throw noNetworkError();

  const out = {
    type: 'Feature',
    properties: { minutes, speedKmh, source: 'osm-valhalla-pedestrian' },
    geometry: feat.geometry,
  };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

// ---- POST /isochrone: marlin's transit search with street-based walking ----------------------

const ISO_CACHE_LIMIT = 20;
const MAX_BODY_BYTES = 16 * 1024;
const GZIP_THRESHOLD_BYTES = 8 * 1024;
const isoCache = new Map();

/** marlin's parser, error table and network store. Loaded lazily: plugins load alphabetically. */
function marlin() {
  try {
    const m = require('../marlin/index.js');
    const i = m && m._internals;
    return i && i.state && i.parseRequest && i.ApiError ? i : null;
  } catch {
    return null;
  }
}

function sendJson(req, res, status, body) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'accept-encoding' };
  if (raw.length >= GZIP_THRESHOLD_BYTES && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    const packed = zlib.gzipSync(raw, { level: 6 });
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': packed.length });
    res.end(packed);
    return;
  }
  res.writeHead(status, { ...headers, 'Content-Length': raw.length });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isoKey(q) {
  return [q.origin.lat.toFixed(5), q.origin.lon.toFixed(5), q.dayType, q.startSec, q.maxTravelSeconds,
    q.maxWaitSeconds, q.maxTransfers, q.allowedModes.slice().sort().join(','), q.walkSpeedMs.toFixed(3),
    q.accessSeconds, q.egressSeconds, q.transferSeconds, q.bandSeconds].join('|');
}

const ORIGIN_SNAP_METRES = 80;

/** False when the pin lies inside the street graph's area but not near any street (water, forest, ...). */
function walkableOrigin(lat, lon) {
  const g = street.load();
  if (!g || !g.bbox) return true;
  const b = g.bbox;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return true;
  const hit = street.nearest(g, lat, lon);
  return !!hit && hit.metres <= ORIGIN_SNAP_METRES;
}

function notWalkable(res) {
  fail(res, 422, 'origin_not_walkable', 'This point is not on land you can walk from (water or no street nearby). Move the pin.',
    'Den här punkten går inte att utgå från (vatten eller ingen gata i närheten). Flytta nålen.');
}

async function isochrone(req, res) {
  const m = marlin();
  if (!m || !m.state.store || !iso.available()) {
    fail(res, 503, 'street_engine_unavailable', 'Street-based walking is not available right now.',
      'Gångvägar via gatunätet är inte tillgängliga just nu.');
    return;
  }
  try {
    const q = m.parseRequest(await readBody(req));
    if (!walkableOrigin(q.origin.lat, q.origin.lon)) { notWalkable(res); return; }
    const key = isoKey(q);
    const hit = isoCache.get(key);
    if (hit) {
      isoCache.delete(key);
      isoCache.set(key, hit);
      sendJson(req, res, 200, { ...hit, cached: true });
      return;
    }

    const net = m.state.store.get(q.dayType);
    const out = iso.compute(net, q, { ApiError: m.ApiError, colorFor: colors });
    const payload = {
      type: 'FeatureCollection',
      meta: {
        origin: q.origin,
        startTime: q.startISO,
        startTimeLocal: m.formatHHMM(q.startSec),
        day: q.dayType,
        bandMinutes: q.bandMinutes,
        maxTravelMinutes: q.maxTravelMinutes,
        stopsReached: out.reached,
        rounds: out.rounds,
        computedMs: out.computedMs,
        dataVersion: net.dataVersion,
        source: net.source,
        algorithm: 'rounds+scan+street-walk',
        cumulativeBands: true,
        walkingModel: 'street',
        walking: out.walking,
        attribution: 'Walking network (c) OpenStreetMap contributors (ODbL)',
      },
      features: out.features,
    };
    isoCache.set(key, payload);
    while (isoCache.size > ISO_CACHE_LIMIT) isoCache.delete(isoCache.keys().next().value);
    sendJson(req, res, 200, payload);
  } catch (err) {
    if (err instanceof m.ApiError) {
      const [status, kind, message, messageSv] = m.ERRORS[err.code];
      sendJson(req, res, status, {
        error: err.code, code: err.code, kind,
        message: err.detail ? message + ' ' + err.detail : message, message_sv: messageSv,
      });
      return;
    }
    console.error('[mareri] isochrone failed:', err && err.stack);
    fail(res, 500, 'internal', 'Something went wrong in the street-based engine.', 'Något gick fel i gatumotorn.');
  }
}

// ---- POST /journey: how you get to one point (hover on the map) ------------------------------

function parseTarget(body) {
  let input;
  try { input = JSON.parse(body); } catch { return null; }
  const t = input && input.target;
  const lat = num(t && t.lat);
  const lon = num(t && (t.lon !== undefined ? t.lon : t.lng));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}

async function journeyRoute(req, res) {
  const m = marlin();
  if (!m || !m.state.store || !iso.available()) {
    fail(res, 503, 'street_engine_unavailable', 'Street-based walking is not available right now.',
      'Gångvägar via gatunätet är inte tillgängliga just nu.');
    return;
  }
  try {
    const body = await readBody(req);
    const target = parseTarget(body);
    if (!target) {
      fail(res, 400, 'bad_request', 'target.lat and target.lon are required.', 'target.lat och target.lon krävs.');
      return;
    }
    const q = m.parseRequest(body);
    const out = journey.plan(m.state.store.get(q.dayType), q, target, { ApiError: m.ApiError, formatHHMM: m.formatHHMM });
    if (!out || out.unreachable) {
      fail(res, 404, 'not_reachable', 'No journey to this point within the time limit.', 'Ingen resa hit inom tidsgränsen.');
      return;
    }
    sendJson(req, res, 200, out);
  } catch (err) {
    if (err instanceof m.ApiError) {
      const [status, kind, message, messageSv] = m.ERRORS[err.code];
      sendJson(req, res, status, { error: err.code, code: err.code, kind, message, message_sv: messageSv });
      return;
    }
    console.error('[mareri] journey failed:', err && err.stack);
    fail(res, 500, 'internal', 'Something went wrong while finding the journey.', 'Något gick fel när resan söktes.');
  }
}

function colors(index, count) {
  try { return require('../marlin/bands.js').colorFor(index, count); } catch { return '#2b83ba'; }
}

module.exports = {
  async handle(req, res, ctx) {
    const route = String(ctx.path || '').replace(/\/+$/, '');
    if (route === '/isochrone') {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return true; }
      await isochrone(req, res);
      return true;
    }
    if (route === '/journey') {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return true; }
      await journeyRoute(req, res);
      return true;
    }
    if (route === '/walkable' && req.method === 'GET') {
      const w = new URL(req.url, 'http://x').searchParams;
      const lat = Number(w.get('lat')), lon = Number(w.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { fail(res, 400, 'bad_request', 'lat and lon are required.', 'lat och lon krävs.'); return true; }
      if (!walkableOrigin(lat, lon)) notWalkable(res); else sendJson(req, res, 200, { walkable: true });
      return true;
    }
    if (req.method !== 'GET' || route !== '/walk') return false;
    const q = new URL(req.url, 'http://x').searchParams;

    const lat = num(q.get('lat'));
    const lon = num(q.get('lon'));
    const minutes = num(q.get('minutes'));
    const speedKmh = q.get('speedKmh') === null ? 4.8 : num(q.get('speedKmh'));

    if (!(lat >= 58.5 && lat <= 60.5 && lon >= 17 && lon <= 19.5)) {
      fail(res, 400, 'bad_request', 'lat/lon must be a point in the Stockholm region.', 'lat/lon måste vara en punkt i Stockholmsregionen.');
      return true;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      fail(res, 400, 'bad_request', 'minutes must be a whole number from 1 to 30.', 'minutes måste vara ett heltal från 1 till 30.');
      return true;
    }
    if (!(speedKmh >= 1 && speedKmh <= 10)) {
      fail(res, 400, 'bad_request', 'speedKmh must be between 1 and 10.', 'speedKmh måste vara mellan 1 och 10.');
      return true;
    }

    try {
      send(res, 200, await walkArea(lat, lon, minutes, speedKmh));
    } catch (err) {
      if (err.noNetwork) {
        fail(res, 422, 'no_walkable_network', 'No walkable street network at this point.', 'Inget gångbart gatunät vid den här punkten.');
      } else if (err.name === 'AbortError') {
        fail(res, 504, 'timeout', 'The street router took too long.', 'Ruttjänsten svarade för långsamt.');
      } else {
        console.error('[mareri]', err && err.message);
        fail(res, 502, 'router_unavailable', 'The street router is unavailable.', 'Ruttjänsten är inte tillgänglig.');
      }
    }
    return true;
  },
};
