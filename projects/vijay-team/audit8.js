// Nesting audit: 8 origins x 30/60/120 min against marlin's live engine.
const A = process.env.BASE || 'https://frontend1.torget.bjarby.com';
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
function inRing(x, y, r) { let c = false; for (let i = 0, k = r.length - 1; i < r.length; k = i++) { const [xi, yi] = r[i], [xk, yk] = r[k]; if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) c = !c; } return c; }
const inGeom = (x, y, g) => polysOf(g).some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
const O = { Centre: [59.3317, 18.0617], Kista: [59.4033, 17.9444], Nacka: [59.3105, 18.1637], Sodertalje: [59.1955, 17.6253], Solna: [59.3605, 18.0100], Taby: [59.4439, 18.0687], Huddinge: [59.2360, 17.9830], Lidingo: [59.3665, 18.1330] };
(async () => {
  const stops = await (await fetch(A + '/t/vijay-team/stops?day=weekday')).json();
  console.log('stops', stops.length);
  for (const [n, [lat, lon]] of Object.entries(O)) for (const m of [30, 60, 120]) {
    const body = { origin: { lat, lon }, startTime: '2026-11-03T09:00:00+01:00', maxTravelMinutes: m, maxWaitMinutes: 7, maxTransfers: 3, modes: ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'], walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }, bandMinutes: 5 };
    const r = await fetch(A + '/t/marlin/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 200) { console.log(n, m, 'status', r.status); continue; }
    const fc = await r.json();
    const b = [...fc.features].sort((a, b) => a.properties.bandIndex - b.properties.bandIndex);
    let v = 0; const per = [];
    for (let k = 0; k < b.length - 1; k++) { const c = stops.filter((s) => inGeom(s.lon, s.lat, b[k].geometry) && !inGeom(s.lon, s.lat, b[k + 1].geometry)).length; v += c; if (c) per.push(k + ':' + c); }
    console.log(n, m, 'bands', b.length, 'violations', v, per.join(' '));
  }
})();
