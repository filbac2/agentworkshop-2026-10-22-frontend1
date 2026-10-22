#!/usr/bin/env node
// Usage: node projects/vijay-team/check.js   (from the repo root). Validates the generated artifacts against CONTRACT.md.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, '..', '..', 'board', 'plugins', 'vijay-team', 'artifacts');
const MODES = new Set(['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat']);
const read = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, n + '.json.gz'))));
let failures = 0;
const fail = (m) => { failures++; if (failures <= 30) console.log('FAIL', m); };

for (const d of ['weekday', 'saturday', 'sunday']) {
  const n = read('network-' + d);
  const c = read('connections-' + d);
  const N = n.stops.length;
  const L = c.from.length;
  for (const k of ['to', 'dep', 'arr', 'route', 'trip']) if (c[k].length !== L) fail(`${d}: column ${k} length`);
  if (c.stopCount !== N || c.offsets.length !== N + 1 || c.offsets[N] !== L) fail(`${d}: offsets`);
  for (let s = 0; s < N; s++) {
    for (let i = c.offsets[s]; i < c.offsets[s + 1]; i++) {
      if (c.from[i] !== s) fail(`${d}: from at ${i}`);
      if (i > c.offsets[s] && c.dep[i] < c.dep[i - 1]) fail(`${d}: unsorted at ${i}`);
      if (c.arr[i] < c.dep[i]) fail(`${d}: arr < dep at ${i}`);
      if (!(c.to[i] >= 0 && c.to[i] < N)) fail(`${d}: to out of range at ${i}`);
      if (!(c.route[i] >= 0 && c.route[i] < c.routes.length)) fail(`${d}: route out of range at ${i}`);
    }
  }
  for (const r of c.routes) if (!MODES.has(r.mode)) fail(`${d}: mode ${r.mode}`);
  for (const t of n.transfers) if (!(t.from < N && t.to < N && t.walkSec > 0)) fail(`${d}: transfer ${t.from}->${t.to}`);
  for (const t of n.trips) {
    if (!MODES.has(t.mode)) fail(`${d}: trip mode ${t.mode}`);
    if (t.stops.length !== t.times.length) fail(`${d}: trip stops/times length`);
    for (let i = 1; i < t.times.length; i++) if (t.times[i] < t.times[i - 1]) { fail(`${d}: times decrease on ${t.route}`); break; }
  }
  const has = (name, mode) => n.stops.some((s) => s.name === name && s.modes.includes(mode));
  if (!has('T-Centralen', 'metro')) fail(`${d}: T-Centralen has no metro`);
  if (!has('Stockholm City', 'commuter_rail')) fail(`${d}: Stockholm City has no commuter_rail`);
  console.log(`${d}: ${N} stops, ${n.trips.length} trips, ${L} connections checked`);
}
const shapes = read('shapes');
if (!shapes.routes.length) fail('shapes: no routes');
for (const r of shapes.routes) {
  if (!MODES.has(r.mode)) fail(`shapes: mode ${r.mode}`);
  for (const l of r.lines) {
    if (l.length < 2) fail(`shapes: short line on ${r.name}`);
    for (const [lon, lat] of l) if (!(lon > 16 && lon < 20 && lat > 58 && lat < 60.5)) { fail(`shapes: point outside Stockholm on ${r.name}`); break; }
  }
}
// Every line end must be within 1 km of a stop of the same mode (union of all days), via a ~0.01 degree grid.
const G = 0.01, KM_LAT = 111.32, KM_LON = 111.32 * Math.cos(59.3 * Math.PI / 180);
const grid = {};
for (const d of ['weekday', 'saturday', 'sunday']) {
  for (const s of read('network-' + d).stops) {
    for (const m of s.modes) ((grid[m + '|' + Math.floor(s.lat / G) + '|' + Math.floor(s.lon / G)] ||= []).push(s));
  }
}
const near = (mode, lon, lat) => {
  const gy = Math.floor(lat / G), gx = Math.floor(lon / G);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    for (const s of grid[mode + '|' + (gy + dy) + '|' + (gx + dx)] || []) {
      const dyk = (s.lat - lat) * KM_LAT, dxk = (s.lon - lon) * KM_LON;
      if (dyk * dyk + dxk * dxk <= 1) return true;
    }
  }
  return false;
};
for (const r of shapes.routes) {
  for (const l of r.lines) {
    for (const [lon, lat] of [l[0], l[l.length - 1]]) if (!near(r.mode, lon, lat)) fail(`shapes: ${r.mode} ${r.name} line end ${lat},${lon} >1 km from any same-mode stop`);
  }
}
console.log(`shapes: ${shapes.routes.length} routes checked`);
console.log(failures ? `FAILED (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
