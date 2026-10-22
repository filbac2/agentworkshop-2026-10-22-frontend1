// Live contract checks for vijay-team, marlin and mareri. Run: node tests/live.test.js [baseUrl]
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
const MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];
let fails = 0;

function check(name, cond, detail) {
  if (cond) console.log('PASS', name);
  else { fails++; console.log('FAIL', name, detail === undefined ? '' : '-> ' + detail); }
}
const short = (v) => JSON.stringify(v)?.slice(0, 200);

async function call(method, path, body) {
  const t = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - t };
}

function checkError(name, r, status, code) {
  check(`${name}: status ${status}`, r.status === status, `got ${r.status} ${short(r.json ?? r.text)}`);
  check(`${name}: error=${code}`, r.json?.error === code, `got ${short(r.json ?? r.text)}`);
  check(`${name}: message + message_sv`, !!r.json?.message && !!r.json?.message_sv, short(r.json));
}

async function vijay() {
  const meta = await call('GET', '/t/vijay-team/meta');
  check('vijay /meta 200', meta.status === 200, `${meta.status} ${meta.text.slice(0, 100)}`);
  for (const d of ['weekday', 'saturday', 'sunday']) {
    const m = meta.json?.[d];
    check(`vijay /meta ${d} shape`, m && m.date && m.generated && m.stopCount > 0 && m.tripCount > 0, short(m));
  }

  const net = await call('GET', '/t/vijay-team/network?day=weekday');
  check('vijay /network 200', net.status === 200, `${net.status} ${net.text.slice(0, 100)}`);
  const n = net.json;
  if (n) {
    check('network version/dayType/date', n.version === 1 && n.dayType === 'weekday' && !!n.date && !!n.generated, short({ v: n.version, d: n.dayType, date: n.date }));
    check('network has stops/trips/transfers', n.stops?.length > 0 && n.trips?.length > 0 && Array.isArray(n.transfers), `${n.stops?.length}/${n.trips?.length}/${n.transfers?.length}`);
    const s = n.stops?.[0];
    check('stop shape', s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.lat === 'number' && typeof s.lon === 'number' && Array.isArray(s.modes), short(s));
    const badMode = new Set();
    for (const st of n.stops || []) for (const m of st.modes || []) if (!MODES.includes(m)) badMode.add(m);
    check('stop modes are contract modes', badMode.size === 0, [...badMode].join(','));
    const bad = (n.trips || []).filter((t) => !MODES.includes(t.mode) || t.stops.length !== t.times.length || t.stops.some((i) => !(i >= 0 && i < n.stops.length)));
    check('trips: mode valid, stops/times same length, indices in range', bad.length === 0, `${bad.length} bad, e.g. ${short(bad[0])}`);
    const tr = n.transfers?.[0];
    check('transfer shape', !tr || (Number.isInteger(tr.from) && Number.isInteger(tr.to) && typeof tr.walkSec === 'number'), short(tr));
    const lat = (n.stops || []).filter((x) => x.lat < 58.5 || x.lat > 60.5 || x.lon < 17 || x.lon > 19.5);
    check('stops inside Stockholm region', lat.length === 0, `${lat.length} outside, e.g. ${short(lat[0])}`);
  }

  const bbox = '17.9,59.25,18.2,59.4';
  const st = await call('GET', `/t/vijay-team/stops?day=weekday&bbox=${bbox}&modes=metro,bus`);
  check('vijay /stops 200', st.status === 200, `${st.status} ${st.text.slice(0, 100)}`);
  check('stops is non-empty array', Array.isArray(st.json) && st.json.length > 0, short(st.json));
  if (Array.isArray(st.json) && st.json.length) {
    const x = st.json[0];
    check('stops items have index', Number.isInteger(x.index) && x.id && x.name, short(x));
    const outside = st.json.filter((s) => s.lon < 17.9 || s.lon > 18.2 || s.lat < 59.25 || s.lat > 59.4);
    check('stops respect bbox', outside.length === 0, `${outside.length} outside`);
    const wrong = st.json.filter((s) => !s.modes.some((m) => m === 'metro' || m === 'bus'));
    check('stops respect modes filter', wrong.length === 0, `${wrong.length} wrong, e.g. ${short(wrong[0])}`);
  }
}

async function marlin() {
  const h = await call('GET', '/t/marlin/health');
  check('marlin /health 200', h.status === 200, h.status);
  check('health shape', h.json?.ok === true && typeof h.json.networkLoaded === 'boolean' && 'source' in h.json, short(h.json));
  console.log('INFO health', short(h.json));

  const ok = await call('POST', '/t/marlin/isochrone', { origin: { lat: 59.3326, lon: 18.0649 }, startTime: '2026-10-22T09:00:00+02:00', maxTravelMinutes: 30 });
  check('isochrone 200', ok.status === 200, `${ok.status} ${short(ok.json ?? ok.text)}`);
  console.log('INFO isochrone latency ms:', ok.ms);
  check('isochrone latency < 5000ms', ok.ms < 5000, ok.ms);
  const j = ok.json;
  if (ok.status === 200 && j) {
    check('FeatureCollection', j.type === 'FeatureCollection' && Array.isArray(j.features), short(j.type));
    check('meta fields', j.meta && j.meta.bandMinutes === 5 && j.meta.maxTravelMinutes === 30 && j.meta.cumulativeBands === true && 'stopsReached' in j.meta && 'computedMs' in j.meta && 'dataVersion' in j.meta && 'source' in j.meta, short(j.meta));
    check('6 bands', j.features.length === 6, j.features.length);
    const f = j.features;
    check('bands 5-min wide, outermost first', f.every((x, i) => x.properties.toMinutes === 30 - i * 5 && x.properties.fromMinutes === 25 - i * 5), short(f.map((x) => [x.properties.fromMinutes, x.properties.toMinutes])));
    check('bandIndex 6..1 and color', f.every((x, i) => x.properties.bandIndex === 6 - i && /^#/.test(x.properties.color || '') && 'stops' in x.properties), short(f[0]?.properties));
    check('geometry MultiPolygon', f.every((x) => x.type === 'Feature' && x.geometry?.type === 'MultiPolygon' && Array.isArray(x.geometry.coordinates)), short(f[0]?.geometry?.type));
    const area = (g) => g.coordinates.reduce((a, p) => a + p.length, 0);
    check('outermost band has area at Stockholm centre', area(f[0].geometry) > 0, 'empty');
    const c = f.find((x) => x.geometry.coordinates.length)?.geometry.coordinates[0]?.[0]?.[0];
    check('coordinates are [lon,lat]', !c || (c[0] > 17 && c[0] < 19.5 && c[1] > 58.5 && c[1] < 60.5), short(c));
  }

  // marlin PR 29: echoed startTime must carry the real Stockholm offset (was +01:59), weekend data preloaded.
  check('startTime echo +02:00', j?.meta?.startTime === '2026-10-22T09:00:00+02:00', short(j?.meta?.startTime));
  const echo = async (startTime) => (await call('POST', '/t/marlin/isochrone', { origin: { lat: 59.3326, lon: 18.0649 }, startTime, maxTravelMinutes: 30 }));
  const z = await echo('2026-10-22T07:00:00Z');
  check('startTime Z normalised to +02:00', z.json?.meta?.startTime === '2026-10-22T09:00:00+02:00', short(z.json?.meta?.startTime));
  const sat = await echo('2026-10-24T10:00:00+02:00');
  check('saturday day + offset', sat.json?.meta?.day === 'saturday' && sat.json.meta.startTime === '2026-10-24T10:00:00+02:00', short(sat.json?.meta));
  check('saturday latency < 2000ms (no cold start)', sat.ms < 2000, sat.ms);
  const sun = await echo('2026-10-25T10:00:00+01:00');
  check('sunday after DST end: day + offset +01:00', sun.json?.meta?.day === 'sunday' && sun.json.meta.startTime === '2026-10-25T10:00:00+01:00', short(sun.json?.meta));
  check('sunday latency < 2000ms (no cold start)', sun.ms < 2000, sun.ms);
  console.log('INFO weekend latency ms: sat', sat.ms, 'sun', sun.ms);

  const bad = (o, extra = {}) => ({ origin: { lat: 59.3326, lon: 18.0649 }, ...o, ...extra });
  checkError('malformed JSON', await call('POST', '/t/marlin/isochrone', '{nope'), 400, 'bad_request');
  checkError('missing origin', await call('POST', '/t/marlin/isochrone', {}), 400, 'bad_request');
  checkError('maxTravelMinutes 500', await call('POST', '/t/marlin/isochrone', bad({ maxTravelMinutes: 500 })), 400, 'bad_request');
  // Contract v1.2 (gen-004): any whole minute 5..120 is valid; <5 and >120 are 400.
  checkError('maxTravelMinutes 4 (below 5)', await call('POST', '/t/marlin/isochrone', bad({ maxTravelMinutes: 4 })), 400, 'bad_request');
  checkError('maxTravelMinutes 121 (above 120)', await call('POST', '/t/marlin/isochrone', bad({ maxTravelMinutes: 121 })), 400, 'bad_request');
  for (const m of [5, 33, 120]) {
    const r = await call('POST', '/t/marlin/isochrone', bad({ maxTravelMinutes: m }));
    check(`maxTravelMinutes ${m} accepted`, r.status === 200 && r.json?.meta?.maxTravelMinutes === m, `${r.status} ${short(r.json?.meta ?? r.json ?? r.text)}`);
  }
  checkError('unknown mode', await call('POST', '/t/marlin/isochrone', bad({ modes: ['hovercraft'] })), 400, 'unknown_mode');
  checkError('no stops near origin (open sea)', await call('POST', '/t/marlin/isochrone', { origin: { lat: 0, lon: 0 } }), 422, 'no_stops_near_origin');
  const nr = await call('POST', '/t/marlin/isochrone', bad({ startTime: '2026-10-22T03:00:00+02:00', maxTravelMinutes: 5, maxTransfers: 0, walking: { accessMinutes: 1 } }));
  console.log('INFO nothing_reachable probe:', nr.status, short(nr.json));

  const md = await call('GET', '/t/marlin/modes');
  check('marlin /modes', md.status === 200 && Array.isArray(md.json?.modes) && md.json.modes.every((m) => MODES.includes(m)), short(md.json ?? md.text));
}

// mareri PR 26: POST /t/mareri/isochrone, same request/response as marlin plus street-walking meta.
async function mareri() {
  const P = '/t/mareri/isochrone';
  const body = (lat, lon, extra = {}) => ({ origin: { lat, lon }, startTime: '2026-10-22T09:00:00+02:00', maxTravelMinutes: 30, ...extra });
  const ok = await call('POST', P, body(59.3313, 18.0593));
  if (ok.status === 404) { console.log('INFO mareri /isochrone not live yet (404), skipped'); return; }
  check('mareri central 200', ok.status === 200, `${ok.status} ${short(ok.json ?? ok.text)}`);
  console.log('INFO mareri central latency ms:', ok.ms);
  check('mareri latency < 5000ms', ok.ms < 5000, ok.ms);
  const j = ok.json;
  if (ok.status === 200 && j) {
    const f = j.features || [];
    check('mareri FeatureCollection, 6 bands', j.type === 'FeatureCollection' && f.length === 6, `${j.type} ${f.length}`);
    check('mareri marlin meta fields', j.meta?.bandMinutes === 5 && j.meta.maxTravelMinutes === 30 && j.meta.cumulativeBands === true && 'stopsReached' in j.meta, short(j.meta));
    check('mareri bands outermost first', f.every((x, i) => x.properties.toMinutes === 30 - i * 5 && x.properties.fromMinutes === 25 - i * 5 && x.properties.bandIndex === 6 - i), short(f.map((x) => [x.properties.fromMinutes, x.properties.toMinutes])));
    check('mareri geometry MultiPolygon [lon,lat]', f.every((x) => x.geometry?.type === 'MultiPolygon') && (() => { const c = f[0]?.geometry.coordinates[0]?.[0]?.[0]; return !c || (c[0] > 17 && c[0] < 19.5 && c[1] > 58.5 && c[1] < 60.5); })(), short(f[0]?.geometry?.type));
    check('mareri meta.walkingModel street', j.meta?.walkingModel === 'street', short(j.meta?.walkingModel));
    const w = j.meta?.walking;
    check('mareri meta.walking shape', w && typeof w.streetStops === 'number' && typeof w.straightLineStops === 'number' && typeof w.pinOnStreet === 'boolean' && 'cellMetres' in w, short(w));
    check('mareri central pin on street', w?.pinOnStreet === true, short(w));
    check('mareri attribution', /OpenStreetMap/i.test(JSON.stringify(j.meta?.attribution ?? '')), short(j.meta?.attribution));
  }
  // Södertälje: outside the street bbox (lat 59.22-59.44, lon 17.90-18.22), should fall back to straight-line walking.
  const out = await call('POST', P, body(59.1955, 17.6253));
  check('mareri outside bbox 200', out.status === 200, `${out.status} ${short(out.json ?? out.text)}`);
  if (out.status === 200) {
    check('mareri outside bbox: pin not on street (fallback)', out.json?.meta?.walking?.pinOnStreet === false, short(out.json?.meta?.walking));
    check('mareri outside bbox: has bands', out.json?.features?.length === 6, out.json?.features?.length);
  }
  checkError('mareri unknown mode', await call('POST', P, body(59.3313, 18.0593, { modes: ['hovercraft'] })), 400, 'unknown_mode');
  checkError('mareri open sea', await call('POST', P, { origin: { lat: 59.2, lon: 19.2 } }), 422, 'no_stops_near_origin');
}

(async () => {
  for (const [name, fn] of [['vijay-team', vijay], ['marlin', marlin], ['mareri', mareri]]) {
    console.log(`\n== ${name} ==`);
    try { await fn(); } catch (e) { fails++; console.log('FAIL', name, 'threw', e.message); }
  }
  console.log(`\n${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
})();
