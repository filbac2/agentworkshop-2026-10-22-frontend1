// Captures raw live responses for the walk-mode tests: the gateway walk call and mareri /walk per band.
// node tests/fixtures/walk/capture.mjs [base]   (default https://frontend1.torget.bjarby.com)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
export const CASES = [
  { name: 'center-30x5', lat: 59.3326, lon: 18.0649, maxMinutes: 30, stepMinutes: 5 },
  { name: 'center-45x15', lat: 59.3326, lon: 18.0649, maxMinutes: 45, stepMinutes: 15 },
  { name: 'seam-29', lat: 59.3326, lon: 18.0649, maxMinutes: 29, stepMinutes: 10 },
  { name: 'seam-31', lat: 59.3326, lon: 18.0649, maxMinutes: 31, stepMinutes: 10 },
  { name: 'sodertalje-20x10', lat: 59.1955, lon: 17.6253, maxMinutes: 20, stepMinutes: 10 },
  { name: 'bbox-edge-10x5', lat: 60.45, lon: 19.45, maxMinutes: 10, stepMinutes: 5 },
];

function edges(c) {
  const step = Math.max(c.stepMinutes, Math.ceil(c.maxMinutes / 24));
  const e = [];
  for (let m = step; m < c.maxMinutes; m += step) e.push(m);
  e.push(c.maxMinutes);
  return e;
}

async function grab(url, init) {
  const t0 = Date.now();
  const r = await fetch(url, init);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { url: url.replace(BASE, ''), status: r.status, engine: r.headers.get('x-gateway-engine'), ms: Date.now() - t0, body };
}

const out = { capturedAt: new Date().toISOString(), base: BASE, gateway: {}, mareri: {} };
for (const c of CASES) {
  const body = { origin: { lat: c.lat, lon: c.lon }, modes: [], maxTravelMinutes: c.maxMinutes, bandMinutes: c.stepMinutes, walking: { speedKmh: 4.8 } };
  out.gateway[c.name] = await grab(BASE + '/t/filbac/api/isochrone', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const m of edges(c).filter((m) => m <= 30)) {
    const path = '/t/mareri/walk?lat=' + c.lat + '&lon=' + c.lon + '&minutes=' + m + '&speedKmh=4.8';
    if (!out.mareri[path]) out.mareri[path] = await grab(BASE + path);
  }
}
out.gateway['bad-origin'] = await grab(BASE + '/t/filbac/api/isochrone', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ origin: { lat: 10, lon: 10 }, modes: [], maxTravelMinutes: 30, bandMinutes: 5 }),
});
writeFileSync(join(dir, 'live-capture.json'), JSON.stringify(out));
for (const [k, v] of Object.entries(out.gateway)) console.log('gateway', k, v.status, v.engine || '-', v.ms + 'ms');
for (const [k, v] of Object.entries(out.mareri)) console.log('mareri', k, v.status, v.ms + 'ms');
