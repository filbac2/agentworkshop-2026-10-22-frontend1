// Experiment: simplify marlin's isochrone polygons on a COPY of the response and measure the effect.
// Usage: node projects/vijay-team/trim-test.js [tolMeters ...]   (default 60 120)
const zlib = require('zlib');
const A = process.env.BASE || 'https://frontend1.torget.bjarby.com';
const tols = process.argv.slice(2).map(Number);
if (!tols.length) tols.push(60, 120);

function dp(p, tol) {
  if (p.length < 4) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const st = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = p[a], [bx, by] = p[b];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = p[i];
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
function inRing(x, y, r) {
  let c = false;
  for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
    const [xi, yi] = r[i], [xk, yk] = r[k];
    if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) c = !c;
  }
  return c;
}
const inPoly = (x, y, p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h));
const inGeom = (x, y, g) => polysOf(g).some((p) => inPoly(x, y, p));

function simplify(fc, tolM) {
  const tol = tolM / 111320;
  const c = JSON.parse(JSON.stringify(fc));
  for (const f of c.features) {
    for (const poly of polysOf(f.geometry)) {
      for (let r = 0; r < poly.length; r++) {
        const s = dp(poly[r], tol);
        if (s.length >= 4) poly[r] = s.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
      }
    }
  }
  return c;
}

// Stations covered per band, and nesting violations: stations inside band k but outside band k+1.
function evaluate(fc, stops) {
  const bands = [...fc.features].sort((a, b) => a.properties.bandIndex - b.properties.bandIndex);
  const covered = bands.map((b) => stops.filter((s) => inGeom(s.lon, s.lat, b.geometry)));
  let nesting = 0;
  for (let k = 0; k < bands.length - 1; k++) {
    const outer = bands[k + 1].geometry;
    nesting += covered[k].filter((s) => !inGeom(s.lon, s.lat, outer)).length;
  }
  return { outerStations: covered[covered.length - 1].length, nesting, points: bands.reduce((n, b) => n + polysOf(b.geometry).flat(1).reduce((m, r) => m + r.length, 0), 0) };
}

(async () => {
  const stops = await (await fetch(A + '/t/vijay-team/stops?day=weekday')).json();
  const body = {
    origin: { lat: 59.3317, lon: 18.0617 }, startTime: '2026-11-03T09:00:00+01:00', maxTravelMinutes: 120, maxWaitMinutes: 7,
    maxTransfers: 3, modes: ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'],
    walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }, bandMinutes: 5,
  };
  const fc = await (await fetch(A + '/t/marlin/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const row = (name, c) => {
    const s = JSON.stringify(c);
    const e = evaluate(c, stops);
    console.log(`${name.padEnd(10)} points ${String(e.points).padStart(7)}  gzip ${String(Math.round(zlib.gzipSync(s).length / 1024)).padStart(5)} KB  stations in outer band ${e.outerStations}  nesting violations ${e.nesting}`);
  };
  row('original', fc);
  for (const t of tols) row(t + ' m', simplify(fc, t));
})();
