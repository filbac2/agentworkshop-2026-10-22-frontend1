'use strict';

/**
 * "How do I get there?" for any point on the map: rebuilds the fastest journey the isochrone search
 * found (walk to a stop, rides and walking transfers, walk to the destination) with street geometry.
 * Uses exactly the same search, transfers and walking limits as /isochrone, so what is shown
 * matches the coloured area. Map data (c) OpenStreetMap contributors, ODbL.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const street = require('./street');
const iso = require('./iso.js');

const { metres } = street;
const { search, snapStops, transfersFor, accessSeeds } = iso._internals;
const INF = street.INF;
const SESSION_LIMIT = 8;

const sessions = new Map();
const lineCache = new WeakMap();
const tripCache = new WeakMap();

const VIJAY_DIRS = [
  path.join(__dirname, '..', 'vijay-team', 'artifacts'),
  path.join(__dirname, '..', 'vijay-team', 'data'),
];

/** Line names per connection, aligned with marlin's sorted connection arrays (null if they do not line up). */
function lineInfo(net) {
  if (lineCache.has(net)) return lineCache.get(net);
  let info = null;
  try {
    for (const dir of VIJAY_DIRS) {
      const file = path.join(dir, 'connections-' + net.dayType + '.json.gz');
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
      if (!raw.route || !raw.routes || raw.stopCount !== net.stops.length) continue;
      const stopCount = net.stops.length;
      const order = [];
      for (let i = 0; i < raw.from.length; i++) {
        const f = raw.from[i], t = raw.to[i], d = raw.dep[i], a = raw.arr[i];
        if (!(f >= 0 && f < stopCount && t >= 0 && t < stopCount)) continue;
        if (!Number.isFinite(d) || !Number.isFinite(a) || a < d) continue;
        order.push(i);
      }
      order.sort((x, y) => raw.dep[x] - raw.dep[y] || raw.arr[x] - raw.arr[y]);
      if (order.length !== net.connectionCount) continue;
      const route = new Int16Array(order.length);
      let ok = true;
      for (let c = 0; c < order.length && ok; c++) {
        const j = order[c];
        ok = raw.from[j] === net.from[c] && raw.to[j] === net.to[c] && raw.dep[j] === net.dep[c] &&
          raw.arr[j] === net.arr[c] && raw.trip[j] === net.trip[c];
        route[c] = raw.route[j];
      }
      if (ok) info = { route, names: raw.routes.map((r) => String((r && r.name) || '')) };
      break;
    }
  } catch (err) {
    console.error('[mareri] line names unavailable:', err && err.message);
  }
  lineCache.set(net, info);
  return info;
}

/** Connection indices per trip, in time order (CSR). */
function tripIndex(net) {
  let idx = tripCache.get(net);
  if (idx) return idx;
  const start = new Int32Array(net.tripCount + 1);
  for (let c = 0; c < net.connectionCount; c++) start[net.trip[c] + 1]++;
  for (let i = 0; i < net.tripCount; i++) start[i + 1] += start[i];
  const fill = Int32Array.from(start.subarray(0, net.tripCount));
  const conns = new Int32Array(net.connectionCount);
  for (let c = 0; c < net.connectionCount; c++) conns[fill[net.trip[c]]++] = c;
  idx = { start, conns };
  tripCache.set(net, idx);
  return idx;
}

function sessionKey(q) {
  return [q.origin.lat.toFixed(5), q.origin.lon.toFixed(5), q.dayType, q.startSec, q.maxTravelSeconds,
    q.maxWaitSeconds, q.maxTransfers, q.allowedModes.slice().sort().join(','), q.walkSpeedMs.toFixed(3),
    q.accessSeconds, q.egressSeconds, q.transferSeconds].join('|');
}

/** The traced search for one isochrone request, kept so that hovering many points costs one search. */
function session(net, q, g) {
  const key = sessionKey(q);
  let s = sessions.get(key);
  if (s && s.net === net) { sessions.delete(key); sessions.set(key, s); return s; }
  const sn = snapStops(net, g);
  const access = accessSeeds(net, g, sn, q);
  const table = transfersFor(net, g, sn, q.transferSeconds, q.walkSpeedMs);
  const result = search(net, q, Array.from(access.seeds), table, true);
  s = { net, q, g, sn, access, result };
  sessions.set(key, s);
  while (sessions.size > SESSION_LIMIT) sessions.delete(sessions.keys().next().value);
  return s;
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;
const point = (lat, lon) => [r5(lat), r5(lon)];

/** A walking leg between two points: along streets when both ends snap, else a straight line. */
function walkPath(s, a, b, limitSec) {
  const { g, q } = s;
  const v = q.walkSpeedMs;
  const na = street.nearest(g, a.lat, a.lon);
  const nb = street.nearest(g, b.lat, b.lon);
  if (na && nb) {
    // Allow a second for the rounded stop labels, not a shortcut across disconnected streets.
    const r = street.route(g, na.node, nb.node, v, limitSec + 1 - (na.metres + nb.metres) / v);
    if (!r) return null;
    return {
      coords: [point(a.lat, a.lon), ...r.coords, point(b.lat, b.lon)],
      metres: na.metres + r.metres + nb.metres,
      seconds: (na.metres + nb.metres) / v + r.seconds,
      street: true,
    };
  }
  const distance = metres(a.lat, a.lon, b.lat, b.lon);
  return { coords: [point(a.lat, a.lon), point(b.lat, b.lon)], metres: distance, seconds: distance / v, street: false };
}

/**
 * Fastest way to `target`: min over (stop arrival + walk from that stop), and over walking the
 * whole way from the pin. Returns {stop, total} or {direct: true, total} or null.
 */
function bestArrival(s, target) {
  const { net, q, g, sn, result } = s;
  const v = q.walkSpeedMs;
  const egressM = q.egressSeconds * v;
  const limit = q.egressSeconds;
  const stops = net.stops;
  let best = null;
  const offer = (c) => { if (!best || c.total < best.total) best = c; };

  const tn = street.nearest(g, target.lat, target.lon);
  if (tn) {
    street.dijkstra(g, [{ node: tn.node, t: tn.metres / v, o: 0 }], v, limit, 1e9, (u, t) => {
      for (let i = sn.head[u]; i >= 0; i = sn.next[i]) {
        if (result.arrival[i] === INF) continue;
        const w = t + sn.dist[i] / v;
        if (w <= limit) offer({ stop: i, total: result.arrival[i] + w });
      }
    });
  }
  for (let i = 0; i < stops.length; i++) {
    if (result.arrival[i] === INF || (tn && sn.node[i] >= 0)) continue;
    const d = metres(target.lat, target.lon, stops[i].lat, stops[i].lon);
    if (d <= egressM) offer({ stop: i, total: result.arrival[i] + d / v });
  }

  const pinLimit = q.accessSeconds;
  const direct = metres(q.origin.lat, q.origin.lon, target.lat, target.lon);
  if (direct / v <= pinLimit) {
    const w = walkPath(s, q.origin, target, pinLimit);
    if (w && w.seconds <= pinLimit) offer({ direct: true, total: q.startSec + w.seconds });
  }
  return best;
}

function walkLeg(s, a, b, minutes, limitSec) {
  const w = walkPath(s, a, b, limitSec);
  if (!w) throw new Error('Journey walking geometry does not match the street search');
  return { type: 'walk', from: a, to: b, minutes, meters: Math.round(w.metres), path: w.coords, street: w.street };
}

function stopPoint(net, i) {
  const st = net.stops[i];
  return { lat: st.lat, lon: st.lon, name: st.name };
}

/** Merge neighbouring walking legs (e.g. a chain of transfers) into one. */
function mergeWalks(legs) {
  const out = [];
  for (const leg of legs) {
    const last = out[out.length - 1];
    if (last && last.type === 'walk' && leg.type === 'walk') {
      last.to = leg.to;
      last.minutes += leg.minutes;
      last.meters += leg.meters;
      last.path = last.path.concat(leg.path.slice(1));
      last.street = last.street && leg.street;
    } else {
      out.push(leg);
    }
  }
  return out;
}

function plan(net, q, target, helpers) {
  const g = street.load();
  if (!g) return null;
  const s = session(net, q, g);
  if (s.result.originStops === 0) throw new helpers.ApiError('no_stops_near_origin');
  const pick = bestArrival(s, target);
  const cutoff = q.startSec + q.maxTravelSeconds;
  if (!pick || pick.total > cutoff) return { unreachable: true };

  const names = lineInfo(net);
  const trips = tripIndex(net);
  const origin = { lat: q.origin.lat, lon: q.origin.lon };
  const dest = { lat: target.lat, lon: target.lon };
  const m = (sec) => Math.max(1, Math.round(sec / 60));
  let legs = [];

  if (pick.direct) {
    legs.push(walkLeg(s, origin, dest, m(pick.total - q.startSec), q.accessSeconds));
  } else {
    const chain = [];
    for (let id = s.result.bestLab[pick.stop]; id >= 0; id = s.result.recs[id].p) chain.push(s.result.recs[id]);
    chain.reverse();
    let from = origin;
    let clock = q.startSec;
    for (const rec of chain) {
      if (rec.k === 'access') {
        const to = stopPoint(net, rec.stop);
        legs.push(walkLeg(s, from, to, m(rec.t - clock), q.accessSeconds));
        from = to; clock = rec.t;
      } else if (rec.k === 'walk') {
        const a = stopPoint(net, rec.from);
        const b = stopPoint(net, rec.stop);
        legs.push(walkLeg(s, a, b, m(rec.t - clock), q.transferSeconds));
        from = b; clock = rec.t;
      } else {
        const bc = rec.bc, ac = rec.ac;
        const idx = trips.conns.subarray(trips.start[net.trip[bc]], trips.start[net.trip[bc] + 1]);
        const pts = [];
        let on = false;
        for (const c of idx) {
          if (c === bc) on = true;
          if (on) pts.push(point(net.stops[net.from[c]].lat, net.stops[net.from[c]].lon));
          if (c === ac) break;
        }
        pts.push(point(net.stops[net.to[ac]].lat, net.stops[net.to[ac]].lon));
        const a = stopPoint(net, net.from[bc]);
        const b = stopPoint(net, net.to[ac]);
        legs.push({
          type: 'ride',
          mode: net.modeNames[net.mode[bc]],
          line: names ? names.names[names.route[bc]] : '',
          from: a, to: b,
          depart: helpers.formatHHMM(net.dep[bc]),
          arrive: helpers.formatHHMM(net.arr[ac]),
          minutes: m(net.arr[ac] - net.dep[bc]),
          waitMinutes: Math.max(0, Math.round((net.dep[bc] - clock) / 60)),
          stops: pts.length - 1,
          path: pts,
        });
        from = b; clock = rec.t;
      }
    }
    legs.push(walkLeg(s, from, dest, m(pick.total - clock), q.egressSeconds));
    // A pin or destination right at the stop leaves a zero-length walk: drop it.
    legs = legs.filter((l) => l.type !== 'walk' || l.meters >= 20);
  }
  legs = mergeWalks(legs);

  const rides = legs.filter((l) => l.type === 'ride');
  return {
    origin, target: dest,
    startTime: helpers.formatHHMM(q.startSec),
    arriveTime: helpers.formatHHMM(Math.round(pick.total)),
    totalMinutes: Math.max(1, Math.ceil((pick.total - q.startSec) / 60)),
    transfers: Math.max(0, rides.length - 1),
    walkMinutes: legs.filter((l) => l.type === 'walk').reduce((a, l) => a + l.minutes, 0),
    walkingModel: legs.some((l) => l.type === 'walk' && !l.street) ? 'mixed' : 'street',
    transitGeometry: 'stop-to-stop',
    legs,
  };
}

module.exports = { plan };
