'use strict';

/**
 * Street-based isochrones.
 *
 * Same transit search as marlin's engine, but every walk follows the OpenStreetMap pedestrian
 * network instead of a straight line:
 *   - access: pin -> stop along streets,
 *   - transfers: stop -> stop along streets,
 *   - egress: stop -> destination, expanded over the street graph and rasterised into bands.
 * Stops or pins that are further than SNAP_METRES from the graph keep the straight-line model.
 * Map data (c) OpenStreetMap contributors, ODbL.
 */

const street = require('./street');
const engine = require('../marlin/isochrone.js');

const { metres } = street;
const INF = engine.INF;
const DEG = Math.PI / 180;
const MAX_STREET_TRANSFER_SEC = 600;
const CELL_CAP = 1500000;

const snapCache = new WeakMap();      // net -> { node, dist, head, next }
const transferCache = new WeakMap();  // net -> Map(key -> { transferOffset, transferTo, transferSec })

/** Snap every stop to the nearest graph node (within SNAP_METRES), once per network. */
function snapStops(net, g) {
  let s = snapCache.get(net);
  if (s && s.g === g) return s;
  const n = net.stops.length;
  const node = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n);
  const head = new Int32Array(g.N).fill(-1);
  const next = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const hit = street.nearest(g, net.stops[i].lat, net.stops[i].lon);
    if (!hit) continue;
    node[i] = hit.node;
    dist[i] = hit.metres;
    next[i] = head[hit.node];
    head[hit.node] = i;
  }
  s = { g, node, dist, head, next };
  snapCache.set(net, s);
  return s;
}

/**
 * Walking transfers over streets. Pairs where both stops snap are replaced by street times (and
 * dropped when the street route is longer than the limit, e.g. across water). Pairs that involve an
 * unsnapped stop keep marlin's straight-line value.
 */
function transfersFor(net, g, sn, transferSeconds, speedMs) {
  const limit = Math.min(transferSeconds, MAX_STREET_TRANSFER_SEC);
  const key = limit + '|' + speedMs.toFixed(3);
  let byKey = transferCache.get(net);
  if (!byKey) { byKey = new Map(); transferCache.set(net, byKey); }
  const hit = byKey.get(key);
  if (hit) return hit;

  const n = net.stops.length;
  const lists = new Array(n);
  for (let s = 0; s < n; s++) {
    const out = new Map();
    if (sn.node[s] >= 0) {
      street.dijkstra(g, [{ node: sn.node[s], t: sn.dist[s] / speedMs, o: 0 }], speedMs, limit, limit,
        (u, t) => {
          for (let s2 = sn.head[u]; s2 >= 0; s2 = sn.next[s2]) {
            if (s2 === s) continue;
            const total = t + sn.dist[s2] / speedMs;
            if (total > limit) continue;
            const prev = out.get(s2);
            if (prev === undefined || total < prev) out.set(s2, total);
          }
        });
    }
    for (let k = net.transferOffset[s]; k < net.transferOffset[s + 1]; k++) {
      const s2 = net.transferTo[k];
      if (sn.node[s] >= 0 && sn.node[s2] >= 0) continue;
      if (!out.has(s2)) out.set(s2, net.transferSec[k]);
    }
    lists[s] = out;
  }

  const transferOffset = new Int32Array(n + 1);
  for (let s = 0; s < n; s++) transferOffset[s + 1] = transferOffset[s] + lists[s].size;
  const transferTo = new Int32Array(transferOffset[n]);
  const transferSec = new Int32Array(transferOffset[n]);
  for (let s = 0; s < n; s++) {
    let at = transferOffset[s];
    for (const [s2, sec] of lists[s]) { transferTo[at] = s2; transferSec[at++] = Math.round(sec); }
  }
  const table = { transferOffset, transferTo, transferSec };
  byKey.set(key, table);
  while (byKey.size > 8) byKey.delete(byKey.keys().next().value);
  return table;
}

/**
 * Round-based connection scan, identical to marlin's but with explicit seeds and transfer table.
 * With trace = true it also records how every improvement was reached (an immutable label tree:
 * recs[id] = {k, t, p, ...}, p = parent label), so a journey can be rebuilt for any stop.
 */
function search(net, q, seeds, table, trace) {
  const { startSec, maxTravelSeconds, maxWaitSeconds, maxTransfers, allowedModes, transferSeconds } = q;
  const stopCount = net.stops.length;
  const cutoff = startSec + maxTravelSeconds;
  const best = new Int32Array(stopCount).fill(INF);
  const prev = new Int32Array(stopCount).fill(INF);
  const recs = trace ? [] : null;
  const bestLab = trace ? new Int32Array(stopCount).fill(-1) : null;
  let prevLab = trace ? new Int32Array(stopCount).fill(-1) : null;

  let originStops = 0;
  for (const [i, t] of seeds) {
    if (t > cutoff) continue;
    if (best[i] === INF) originStops++;
    if (t < best[i]) {
      best[i] = t; prev[i] = t;
      if (trace) { recs.push({ k: 'access', t, p: -1, stop: i }); prevLab[i] = bestLab[i] = recs.length - 1; }
    }
  }
  if (originStops === 0) return { arrival: best, reached: 0, originStops: 0, rounds: 0 };

  const modeAllowed = new Uint8Array(net.modeNames.length);
  for (let i = 0; i < net.modeNames.length; i++) {
    modeAllowed[i] = allowedModes.indexOf(net.modeNames[i]) >= 0 ? 1 : 0;
  }

  const { from, to, dep, arr, trip, mode, connectionCount } = net;
  const { transferOffset, transferTo, transferSec } = table;
  const startIndex = engine.lowerBound(dep, startSec, connectionCount);
  const boarded = new Uint8Array(net.tripCount);
  const boardConn = trace ? new Int32Array(net.tripCount) : null;
  const boardParent = trace ? new Int32Array(net.tripCount) : null;
  let rounds = 0;

  for (let leg = 1; leg <= maxTransfers + 1; leg++) {
    const cur = prev.slice();
    const curLab = trace ? prevLab.slice() : null;
    boarded.fill(0);
    let improved = false;
    rounds++;

    for (let c = startIndex; c < connectionCount; c++) {
      if (dep[c] > cutoff) break;
      if (!modeAllowed[mode[c]]) continue;
      const t = trip[c];
      if (!boarded[t]) {
        const ready = prev[from[c]];
        if (ready === INF || ready > dep[c]) continue;
        if (leg > 1 && dep[c] - ready > maxWaitSeconds) continue;
        boarded[t] = 1;
        if (trace) { boardConn[t] = c; boardParent[t] = prevLab[from[c]]; }
      }
      const a = arr[c];
      if (a <= cutoff && a < cur[to[c]]) {
        cur[to[c]] = a; improved = true;
        if (trace) {
          recs.push({ k: 'ride', t: a, p: boardParent[t], bc: boardConn[t], ac: c, stop: to[c] });
          curLab[to[c]] = recs.length - 1;
        }
      }
    }
    if (!improved) break;

    if (transferSeconds > 0) {
      for (let pass = 0; pass < 3; pass++) {
        let walked = false;
        for (let s = 0; s < stopCount; s++) {
          const t = cur[s];
          if (t === INF) continue;
          for (let k = transferOffset[s]; k < transferOffset[s + 1]; k++) {
            if (transferSec[k] > transferSeconds) continue;
            const t2 = t + transferSec[k];
            if (t2 <= cutoff && t2 < cur[transferTo[k]]) {
              cur[transferTo[k]] = t2; walked = true;
              if (trace) {
                recs.push({ k: 'walk', t: t2, p: curLab[s], from: s, stop: transferTo[k] });
                curLab[transferTo[k]] = recs.length - 1;
              }
            }
          }
        }
        if (!walked) break;
      }
    }
    for (let i = 0; i < stopCount; i++) {
      if (cur[i] < best[i]) { best[i] = cur[i]; if (trace) bestLab[i] = curLab[i]; }
      prev[i] = cur[i];
    }
    if (trace) prevLab = curLab;
  }

  let reached = 0;
  for (let i = 0; i < stopCount; i++) if (best[i] !== INF) reached++;
  return { arrival: best, reached, originStops, rounds, recs, bestLab };
}

/** Pin -> stops: along streets where the pin and the stop snap, straight line otherwise. */
function accessSeeds(net, g, sn, q) {
  const seeds = new Map();
  const put = (i, t) => { if (!seeds.has(i) || t < seeds.get(i)) seeds.set(i, t); };
  const { origin, startSec, accessSeconds, walkSpeedMs: v } = q;
  const pin = street.nearest(g, origin.lat, origin.lon);

  if (!pin) {
    for (const [i, d] of engine.accessStops(net, origin, accessSeconds * v)) put(i, startSec + Math.round(d / v));
    return { seeds, pin: null };
  }

  const t0 = startSec + pin.metres / v;
  street.dijkstra(g, [{ node: pin.node, t: t0, o: startSec }], v, accessSeconds, startSec + accessSeconds,
    (u, t) => {
      for (let i = sn.head[u]; i >= 0; i = sn.next[i]) {
        const total = t + sn.dist[i] / v;
        if (total - startSec <= accessSeconds) put(i, Math.round(total));
      }
    });
  for (const [i, d] of engine.accessStops(net, origin, accessSeconds * v)) {
    if (sn.node[i] < 0) put(i, startSec + Math.round(d / v));
  }
  return { seeds, pin };
}

// ---------------------------------------------------------------------------------------------
// Raster

function makeGrid(box, cellM) {
  const midLat = (box.minLat + box.maxLat) / 2;
  let size = cellM;
  for (;;) {
    const latC = size / 111320;
    const lonC = size / (111320 * Math.cos(midLat * DEG));
    const rows = Math.ceil((box.maxLat - box.minLat) / latC) + 1;
    const cols = Math.ceil((box.maxLon - box.minLon) / lonC) + 1;
    if (rows * cols <= CELL_CAP) {
      return { minLat: box.minLat, minLon: box.minLon, latC, lonC, rows, cols, size, t: new Float32Array(rows * cols).fill(INF) };
    }
    size *= 1.25;
  }
}

function mark(grid, lat, lon, t) {
  const r = Math.floor((lat - grid.minLat) / grid.latC);
  const c = Math.floor((lon - grid.minLon) / grid.lonC);
  if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) return;
  const k = r * grid.cols + c;
  if (t < grid.t[k]) grid.t[k] = t;
}

/** Min over the 3x3 neighbourhood, adding the walking time across one cell. */
function dilate(grid, speedMs) {
  const { rows, cols, t } = grid;
  const step = grid.size / speedMs;
  const out = Float32Array.from(t);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let b = out[r * cols + c];
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const v = t[rr * cols + cc];
          if (v >= INF) continue;
          const w = v + (dr && dc ? 1.41 * step : step);
          if (w < b) b = w;
        }
      }
      out[r * cols + c] = b;
    }
  }
  grid.t = out;
}

function disc(grid, lat, lon, t0, radiusM, speedMs, cutoff) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(lat * DEG));
  const r0 = Math.max(0, Math.floor((lat - dLat - grid.minLat) / grid.latC));
  const r1 = Math.min(grid.rows - 1, Math.floor((lat + dLat - grid.minLat) / grid.latC));
  const c0 = Math.max(0, Math.floor((lon - dLon - grid.minLon) / grid.lonC));
  const c1 = Math.min(grid.cols - 1, Math.floor((lon + dLon - grid.minLon) / grid.lonC));
  for (let r = r0; r <= r1; r++) {
    const cl = grid.minLat + (r + 0.5) * grid.latC;
    for (let c = c0; c <= c1; c++) {
      const d = metres(lat, lon, cl, grid.minLon + (c + 0.5) * grid.lonC);
      if (d > radiusM) continue;
      const t = t0 + d / speedMs;
      if (t > cutoff) continue;
      const k = r * grid.cols + c;
      if (t < grid.t[k]) grid.t[k] = t;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Contours: boundary tracing of a cell mask, giving polygons with holes.

function trace(mask, rows, cols) {
  const W = cols + 1;
  const outs = new Map(); // vertex -> [end vertices]
  const add = (a, b) => {
    const l = outs.get(a);
    if (l) l.push(b); else outs.set(a, [b]);
  };
  const on = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && mask[r * cols + c] === 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c]) continue;
      const bl = r * W + c, br = r * W + c + 1, tl = (r + 1) * W + c, tr = (r + 1) * W + c + 1;
      if (!on(r - 1, c)) add(bl, br);
      if (!on(r, c + 1)) add(br, tr);
      if (!on(r + 1, c)) add(tr, tl);
      if (!on(r, c - 1)) add(tl, bl);
    }
  }

  const rings = [];
  for (const [startV, startList] of outs) {
    while (startList.length) {
      const ring = [];
      let a = startV;
      let b = startList.pop();
      ring.push(a);
      for (;;) {
        if (b === startV) break;
        ring.push(b);
        const list = outs.get(b);
        let pick = 0;
        if (list.length > 1) {
          // At a saddle take the left turn: diagonal cells stay separate regions.
          const dx = (b % W) - (a % W), dy = Math.floor(b / W) - Math.floor(a / W);
          for (let i = 0; i < list.length; i++) {
            const ex = (list[i] % W) - (b % W), ey = Math.floor(list[i] / W) - Math.floor(b / W);
            if (dx * ey - dy * ex > 0) { pick = i; break; }
          }
        }
        const next = list.splice(pick, 1)[0];
        a = b; b = next;
      }
      rings.push(ring.map((v) => [v % W, Math.floor(v / W)]));
    }
  }
  return rings;
}

function simplify(ring) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], q = ring[i], r = ring[(i + 1) % n];
    if ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) !== 0) out.push(q);
  }
  return out;
}

function area(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function inside(pt, ring) {
  let in_ = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) in_ = !in_;
  }
  return in_;
}

/** Cut the corners of the staircase once so the outline reads as a shape, not as pixels. */
function chaikin(ring) {
  const out = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
    out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
  }
  return out;
}

/** MultiPolygon coordinates ([lon, lat]) for the cells set in `mask`. */
function polygons(grid, mask) {
  const rings = trace(mask, grid.rows, grid.cols).map(simplify).filter((r) => r.length >= 4);
  const outers = [];
  const holes = [];
  for (const ring of rings) {
    const a = area(ring);
    if (a > 0) { if (a >= 2) outers.push({ ring, a }); } else if (-a >= 6) holes.push({ ring, a: -a });
  }
  for (const o of outers) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of o.ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    o.box = [x0, y0, x1, y1];
    o.holes = [];
  }
  for (const h of holes) {
    // A point just to the right of the first edge lies inside the hole.
    const [p, q] = h.ring;
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    const pt = [(p[0] + q[0]) / 2 + (dy / len) * 0.25, (p[1] + q[1]) / 2 - (dx / len) * 0.25];
    let owner = null;
    for (const o of outers) {
      if (pt[0] < o.box[0] || pt[0] > o.box[2] || pt[1] < o.box[1] || pt[1] > o.box[3]) continue;
      if (o.a > h.a && inside(pt, o.ring) && (!owner || o.a < owner.a)) owner = o;
    }
    if (owner) owner.holes.push(h.ring);
  }

  const lon = (x) => Math.round((grid.minLon + x * grid.lonC) * 1e5) / 1e5;
  const lat = (y) => Math.round((grid.minLat + y * grid.latC) * 1e5) / 1e5;
  const emit = (ring) => {
    const pts = chaikin(ring).map(([x, y]) => [lon(x), lat(y)]);
    pts.push(pts[0]);
    return pts;
  };
  return outers.map((o) => [emit(o.ring), ...o.holes.map(emit)]);
}

// ---------------------------------------------------------------------------------------------

function compute(net, q, helpers) {
  const g = street.load();
  if (!g) return null;
  const started = Date.now();
  const v = q.walkSpeedMs;
  const cutoff = q.startSec + q.maxTravelSeconds;
  const sn = snapStops(net, g);

  const access = accessSeeds(net, g, sn, q);
  const table = transfersFor(net, g, sn, q.transferSeconds, v);
  const result = search(net, q, Array.from(access.seeds), table);
  if (result.originStops === 0) throw new helpers.ApiError('no_stops_near_origin');
  if (result.reached === 0) throw new helpers.ApiError('nothing_reachable');

  const stops = net.stops;
  const egressM = q.egressSeconds * v;
  const cellM = q.maxTravelSeconds <= 2700 ? 80 : q.maxTravelSeconds <= 5400 ? 120 : 160;

  // Extent: every reached stop plus the egress radius, and the pin.
  const box = { minLat: q.origin.lat, maxLat: q.origin.lat, minLon: q.origin.lon, maxLon: q.origin.lon };
  const padLat = (egressM + 200) / 111320;
  const padLon = (egressM + 200) / (111320 * Math.cos(q.origin.lat * DEG));
  for (let i = 0; i < stops.length; i++) {
    if (result.arrival[i] === INF) continue;
    const s = stops[i];
    if (s.lat < box.minLat) box.minLat = s.lat;
    if (s.lat > box.maxLat) box.maxLat = s.lat;
    if (s.lon < box.minLon) box.minLon = s.lon;
    if (s.lon > box.maxLon) box.maxLon = s.lon;
  }
  box.minLat -= padLat; box.maxLat += padLat; box.minLon -= padLon; box.maxLon += padLon;

  const walkGrid = makeGrid(box, cellM);
  const discGrid = makeGrid(box, cellM);
  const half = walkGrid.size / 2;

  const seeds = [];
  let streetStops = 0;
  let discStops = 0;
  for (let i = 0; i < stops.length; i++) {
    const a = result.arrival[i];
    if (a === INF) continue;
    if (sn.node[i] >= 0) {
      seeds.push({ node: sn.node[i], t: a + sn.dist[i] / v, o: a });
      streetStops++;
    } else {
      disc(discGrid, stops[i].lat, stops[i].lon, a, egressM, v, cutoff);
      discStops++;
    }
  }
  if (access.pin) {
    seeds.push({ node: access.pin.node, t: q.startSec + access.pin.metres / v, o: q.startSec + q.accessSeconds - q.egressSeconds });
  } else {
    disc(discGrid, q.origin.lat, q.origin.lon, q.startSec, q.accessSeconds * v, v, cutoff);
  }

  const { off, to, len, lat, lon } = g;
  street.dijkstra(g, seeds, v, q.egressSeconds, cutoff, (u, t, o) => {
    mark(walkGrid, lat[u], lon[u], t);
    for (let e = off[u]; e < off[u + 1]; e++) {
      const L = len[e];
      if (L <= half) continue;
      const w = to[e];
      for (let s = half; s < L; s += half) {
        const tt = t + s / v;
        if (tt > cutoff || tt - o > q.egressSeconds) break;
        const f = s / L;
        mark(walkGrid, lat[u] + (lat[w] - lat[u]) * f, lon[u] + (lon[w] - lon[u]) * f, tt);
      }
    }
  });
  dilate(walkGrid, v);

  const times = walkGrid.t;
  for (let k = 0; k < times.length; k++) if (discGrid.t[k] < times[k]) times[k] = discGrid.t[k];

  const bandCount = Math.max(1, Math.ceil(q.maxTravelSeconds / q.bandSeconds));
  const reachedAt = [];
  for (let i = 0; i < stops.length; i++) if (result.arrival[i] !== INF) reachedAt.push(result.arrival[i] - q.startSec);
  reachedAt.sort((a, b) => a - b);

  const features = [];
  const mask = new Uint8Array(times.length);
  for (let b = bandCount; b >= 1; b--) {
    const edge = q.startSec + b * q.bandSeconds;
    for (let k = 0; k < times.length; k++) mask[k] = times[k] <= edge ? 1 : 0;
    const fromMinutes = Math.round((b - 1) * q.bandSeconds / 60);
    const toMinutes = Math.round(b * q.bandSeconds / 60);
    let stopsInBand = 0;
    while (stopsInBand < reachedAt.length && reachedAt[stopsInBand] <= b * q.bandSeconds) stopsInBand++;
    features.push({
      type: 'Feature',
      properties: {
        fromMinutes, toMinutes, from_min: fromMinutes, to_min: toMinutes, bandIndex: b, cumulative: true,
        color: helpers.colorFor(b - 1, bandCount), stops: stopsInBand,
      },
      geometry: { type: 'MultiPolygon', coordinates: polygons(walkGrid, mask) },
    });
  }

  return {
    features,
    reached: result.reached,
    rounds: result.rounds,
    walking: { streetStops, straightLineStops: discStops, pinOnStreet: !!access.pin, cellMetres: Math.round(walkGrid.size) },
    computedMs: Date.now() - started,
  };
}

module.exports = { compute, available: () => !!street.load(), _internals: { search, snapStops, transfersFor, accessSeeds } };
