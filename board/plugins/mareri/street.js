'use strict';

/**
 * Street graph: loading, snapping and bounded Dijkstra over the OSM pedestrian network.
 * The artifact is built by projects/mareri/street-graph/build-graph.js.
 * Data (c) OpenStreetMap contributors, ODbL.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.join(__dirname, 'artifacts', 'street-graph.bin.gz');
const SNAP_METRES = 150;
const INF = 1e9;

let graph; // undefined = not tried, null = unavailable

function load() {
  if (graph !== undefined) return graph;
  graph = null;
  try {
    const buf = zlib.gunzipSync(fs.readFileSync(FILE));
    if (buf.toString('ascii', 0, 4) !== 'SG01') throw new Error('bad magic');
    const N = buf.readUInt32LE(4);
    const M = buf.readUInt32LE(8);
    // Copy into aligned buffers: typed arrays need byte offsets that are multiples of their element size.
    let at = 12;
    const take = (Type, count) => {
      const bytes = count * Type.BYTES_PER_ELEMENT;
      const copy = new Uint8Array(buf.subarray(at, at + bytes));
      at += bytes;
      return new Type(copy.buffer);
    };
    const lat = take(Float32Array, N);
    const lon = take(Float32Array, N);
    const off = take(Int32Array, N + 1);
    const to = take(Int32Array, M);
    const len = take(Uint16Array, M);
    graph = { N, M, lat, lon, off, to, len };
    buildSpatialIndex(graph);
    graph.dist = new Float64Array(N);
    graph.orig = new Float64Array(N);
    graph.stamp = new Int32Array(N);
    graph.done = new Int32Array(N);
    graph.run = 0;
  } catch (err) {
    console.error('[mareri] street graph unavailable:', err && err.message);
    graph = null;
  }
  return graph;
}

const CELL_LAT = 0.001;
const CELL_LON = 0.002;

function buildSpatialIndex(g) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (let i = 0; i < g.N; i++) {
    if (g.lat[i] < minLat) minLat = g.lat[i];
    if (g.lat[i] > maxLat) maxLat = g.lat[i];
    if (g.lon[i] < minLon) minLon = g.lon[i];
    if (g.lon[i] > maxLon) maxLon = g.lon[i];
  }
  g.bbox = { minLat, maxLat, minLon, maxLon };
  g.rows = Math.floor((maxLat - minLat) / CELL_LAT) + 1;
  g.cols = Math.floor((maxLon - minLon) / CELL_LON) + 1;
  const count = new Int32Array(g.rows * g.cols + 1);
  const cellOf = new Int32Array(g.N);
  for (let i = 0; i < g.N; i++) {
    const c = Math.floor((g.lat[i] - minLat) / CELL_LAT) * g.cols + Math.floor((g.lon[i] - minLon) / CELL_LON);
    cellOf[i] = c;
    count[c + 1]++;
  }
  for (let c = 0; c < g.rows * g.cols; c++) count[c + 1] += count[c];
  const fill = Int32Array.from(count.subarray(0, g.rows * g.cols));
  g.cellStart = count;
  g.cellNodes = new Int32Array(g.N);
  for (let i = 0; i < g.N; i++) g.cellNodes[fill[cellOf[i]]++] = i;
}

function metres(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111320;
  const dx = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Nearest graph node within SNAP_METRES, or null. */
function nearest(g, lat, lon) {
  const r0 = Math.floor((lat - g.bbox.minLat) / CELL_LAT);
  const c0 = Math.floor((lon - g.bbox.minLon) / CELL_LON);
  let best = -1, bestD = Infinity;
  for (let ring = 0; ring <= 2 && best < 0; ring++) {
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      if (r < 0 || r >= g.rows) continue;
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (c < 0 || c >= g.cols) continue;
        const k = r * g.cols + c;
        for (let j = g.cellStart[k]; j < g.cellStart[k + 1]; j++) {
          const n = g.cellNodes[j];
          const d = metres(lat, lon, g.lat[n], g.lon[n]);
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
  }
  if (best < 0 || bestD > SNAP_METRES) return null;
  return { node: best, metres: bestD };
}

// Binary min-heap on (key, node), lazy deletion.
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    this.popKey = topK;
    return topV;
  }
}

/**
 * Multi-source Dijkstra. seeds: [{node, t, o}] with t = arrival (seconds) and o = the time the walk
 * began. A path is dropped once it has walked more than maxWalk seconds since o, or passes cutoff.
 * onSettle(node, t, o) is called once per settled node.
 */
function dijkstra(g, seeds, speedMs, maxWalk, cutoff, onSettle) {
  const run = ++g.run;
  const { off, to, len, dist, orig, stamp } = g;
  const heap = new Heap();
  for (const s of seeds) {
    if (s.t > cutoff || s.t - s.o > maxWalk) continue;
    if (stamp[s.node] !== run || s.t < dist[s.node]) {
      stamp[s.node] = run; dist[s.node] = s.t; orig[s.node] = s.o;
      heap.push(s.t, s.node);
    }
  }
  const done = g.done;
  while (heap.size) {
    const u = heap.pop();
    const t = heap.popKey;
    if (t > dist[u] || done[u] === run) continue;
    done[u] = run;
    const o = orig[u];
    onSettle(u, t, o);
    for (let e = off[u]; e < off[u + 1]; e++) {
      const v = to[e];
      const nt = t + len[e] / speedMs;
      if (nt > cutoff || nt - o > maxWalk) continue;
      if (stamp[v] !== run || nt < dist[v]) {
        stamp[v] = run; dist[v] = nt; orig[v] = o;
        heap.push(nt, v);
      }
    }
  }
}

/**
 * Shortest street route between two graph nodes. Returns {coords: [[lat, lon]], metres, seconds}
 * or null when there is none within maxSec. Meant for single, short routes (journey display).
 */
function route(g, from, to, speedMs, maxSec) {
  const { off, to: dst, len, lat, lon } = g;
  const dist = new Map([[from, 0]]);
  const parent = new Map();
  const done = new Set();
  const heap = new Heap();
  heap.push(0, from);
  while (heap.size) {
    const u = heap.pop();
    const t = heap.popKey;
    if (done.has(u) || t > dist.get(u)) continue;
    done.add(u);
    if (u === to) break;
    for (let e = off[u]; e < off[u + 1]; e++) {
      const v = dst[e];
      const nt = t + len[e] / speedMs;
      if (nt > maxSec) continue;
      const d = dist.get(v);
      if (d === undefined || nt < d) { dist.set(v, nt); parent.set(v, u); heap.push(nt, v); }
    }
  }
  if (!done.has(to)) return null;
  const nodes = [];
  for (let n = to; n !== undefined; n = parent.get(n)) nodes.push(n);
  nodes.reverse();
  const coords = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    coords.push([Math.round(lat[n] * 1e5) / 1e5, Math.round(lon[n] * 1e5) / 1e5]);
  }
  return { coords, metres: dist.get(to) * speedMs, seconds: dist.get(to) };
}

module.exports = { load, nearest, dijkstra, route, metres, SNAP_METRES, INF };
