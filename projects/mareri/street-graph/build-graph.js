'use strict';

// Builds the compact pedestrian street graph used by board/plugins/mareri.
// Run: node build-graph.js /tmp/osm ../../board/plugins/mareri/artifacts/street-graph.bin.gz
// Data (c) OpenStreetMap contributors, ODbL.
//
// Binary layout (before gzip), little endian:
//   char[4] "SG01", uint32 N nodes, uint32 M directed edges,
//   float32 lat[N], float32 lon[N], int32 offset[N+1], int32 to[M], uint16 len[M] (metres)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = process.argv[2] || '/tmp/osm';
const out = process.argv[3] || path.join(__dirname, '..', '..', '..', 'board', 'plugins', 'mareri', 'artifacts', 'street-graph.bin.gz');
const MIN_COMPONENT = 300;

const R = 6371008.8;
function metres(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p, dLon = (lon2 - lon1) * p;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const index = new Map();
const lat = [];
const lon = [];
const ways = [];

for (const file of fs.readdirSync(dir).filter((f) => /^tile-.*\.json$/.test(f)).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  for (const el of data.elements) {
    if (el.type === 'node') {
      if (!index.has(el.id)) { index.set(el.id, lat.length); lat.push(el.lat); lon.push(el.lon); }
    } else if (el.type === 'way' && el.nodes && el.nodes.length > 1) {
      ways.push(el.nodes);
    }
  }
  console.log(file, 'nodes', lat.length, 'ways', ways.length);
}

// Undirected adjacency through two passes: count, then fill.
const N0 = lat.length;
const degree = new Int32Array(N0);
let edgeCount = 0;
for (const w of ways) {
  for (let i = 1; i < w.length; i++) {
    const a = index.get(w[i - 1]), b = index.get(w[i]);
    if (a === undefined || b === undefined || a === b) continue;
    degree[a]++; degree[b]++; edgeCount += 2;
  }
}
const off0 = new Int32Array(N0 + 1);
for (let i = 0; i < N0; i++) off0[i + 1] = off0[i] + degree[i];
const to0 = new Int32Array(edgeCount);
const cur = Int32Array.from(off0.subarray(0, N0));
for (const w of ways) {
  for (let i = 1; i < w.length; i++) {
    const a = index.get(w[i - 1]), b = index.get(w[i]);
    if (a === undefined || b === undefined || a === b) continue;
    to0[cur[a]++] = b; to0[cur[b]++] = a;
  }
}

// Keep only big connected components: a tiny island would trap a stop snapped onto it.
const comp = new Int32Array(N0).fill(-1);
const sizes = [];
const stack = new Int32Array(N0);
for (let s = 0; s < N0; s++) {
  if (comp[s] >= 0 || degree[s] === 0) continue;
  const id = sizes.length;
  let top = 0, size = 0;
  stack[top++] = s; comp[s] = id;
  while (top) {
    const v = stack[--top]; size++;
    for (let k = off0[v]; k < off0[v + 1]; k++) {
      const u = to0[k];
      if (comp[u] < 0) { comp[u] = id; stack[top++] = u; }
    }
  }
  sizes.push(size);
}
const remap = new Int32Array(N0).fill(-1);
let N = 0;
for (let i = 0; i < N0; i++) if (comp[i] >= 0 && sizes[comp[i]] >= MIN_COMPONENT) remap[i] = N++;

const fLat = new Float32Array(N), fLon = new Float32Array(N);
const off = new Int32Array(N + 1);
for (let i = 0; i < N0; i++) {
  const j = remap[i];
  if (j < 0) continue;
  fLat[j] = lat[i]; fLon[j] = lon[i];
  let d = 0;
  for (let k = off0[i]; k < off0[i + 1]; k++) if (remap[to0[k]] >= 0) d++;
  off[j + 1] = d;
}
for (let j = 0; j < N; j++) off[j + 1] += off[j];
const M = off[N];
const to = new Int32Array(M);
const len = new Uint16Array(M);
for (let i = 0; i < N0; i++) {
  const j = remap[i];
  if (j < 0) continue;
  let at = off[j];
  for (let k = off0[i]; k < off0[i + 1]; k++) {
    const u = remap[to0[k]];
    if (u < 0) continue;
    to[at] = u;
    len[at] = Math.min(65535, Math.round(metres(lat[i], lon[i], lat[to0[k]], lon[to0[k]])));
    at++;
  }
}

const header = Buffer.alloc(12);
header.write('SG01', 0, 'ascii');
header.writeUInt32LE(N, 4);
header.writeUInt32LE(M, 8);
const parts = [header, fLat, fLon, off, to, len].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const raw = Buffer.concat(parts);
fs.mkdirSync(path.dirname(out), { recursive: true });
const gz = zlib.gzipSync(raw, { level: 9 });
fs.writeFileSync(out, gz);
console.log('nodes', N, 'edges', M, 'raw', (raw.length / 1e6).toFixed(1) + ' MB', 'gz', (gz.length / 1e6).toFixed(1) + ' MB');
