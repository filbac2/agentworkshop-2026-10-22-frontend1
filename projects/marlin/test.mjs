import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const plugin = require('../../board/plugins/marlin/index.js');
const network = require('../../board/plugins/marlin/network.js');
const engine = require('../../board/plugins/marlin/isochrone.js');
const fixture = require('../../board/plugins/marlin/fixture.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

plugin.init({ dataDir: '/nonexistent-on-purpose' });
const { parseRequest, computeIsochrone, state, formatHHMM } = plugin._internals;
const net = state.store.get('weekday');
const onRealData = net.source === 'gtfs';

const ORIGIN = { lat: 59.3313, lon: 18.0622 }; // T-Centralen
const q = (over = {}) => parseRequest(JSON.stringify({
  origin: ORIGIN, startTime: '09:00', ...over,
}));

console.log('  data source: ' + net.source + ' (' + net.label + '), ' +
  net.stops.length + ' stops, ' + net.connectionCount + ' connections\n');

/* ---- loading ----------------------------------------------------------- */

test('a network loads and has the shape the engine needs', () => {
  assert.ok(net.stops.length > 20);
  assert.ok(net.connectionCount > 1000);
  assert.equal(net.from.length, net.connectionCount);
  assert.equal(net.to.length, net.connectionCount);
  assert.equal(net.dep.length, net.connectionCount);
  assert.ok(net.modes.includes('metro'));
});

test('connections are sorted by departure', () => {
  for (let i = 1; i < net.connectionCount; i++) {
    assert.ok(net.dep[i - 1] <= net.dep[i], 'unsorted at ' + i);
  }
});

test('every connection references a real stop and goes forward in time', () => {
  for (let i = 0; i < net.connectionCount; i++) {
    assert.ok(net.from[i] >= 0 && net.from[i] < net.stops.length);
    assert.ok(net.to[i] >= 0 && net.to[i] < net.stops.length);
    assert.ok(net.arr[i] >= net.dep[i]);
  }
});

test('transfers in CSR form are consistent', () => {
  assert.equal(net.transferOffset.length, net.stops.length + 1);
  assert.equal(net.transferOffset[net.stops.length], net.transferTo.length);
  for (let s = 0; s < net.stops.length; s++) {
    assert.ok(net.transferOffset[s] <= net.transferOffset[s + 1]);
  }
});

test("vijay-team's documented format is parsed exactly as specified", () => {
  // Their contract: trips[].stops are indices, times[i] is the departure at
  // stops[i], transfers carry walkSec.
  const built = network.build({
    version: 1, dayType: 'weekday', date: '20261103',
    stops: [
      { id: 'A', name: 'A', lat: 59.33, lon: 18.06, modes: ['metro'] },
      { id: 'B', name: 'B', lat: 59.34, lon: 18.07, modes: ['metro'] },
      { id: 'C', name: 'C', lat: 59.35, lon: 18.08, modes: ['metro'] },
    ],
    trips: [{ route: '10', mode: 'metro', stops: [0, 1, 2], times: [30000, 30120, 30300] }],
    transfers: [{ from: 1, to: 2, walkSec: 180 }],
  }, 'gtfs', 'unit');

  assert.equal(built.connectionCount, 2);
  assert.equal(built.from[0], 0);
  assert.equal(built.to[0], 1);
  assert.equal(built.dep[0], 30000);
  assert.equal(built.arr[0], 30120);
  assert.equal(built.trip[0], built.trip[1], 'both hops belong to one trip');
  assert.equal(built.dataVersion, 'sl-gtfs-20261103');
  assert.equal(built.transferSec[built.transferOffset[1]], 180);
});

test('the fixture is in the same format as the real artifact', () => {
  const raw = fixture.raw();
  assert.ok(Array.isArray(raw.stops) && Array.isArray(raw.trips));
  for (const t of raw.trips.slice(0, 50)) {
    assert.equal(t.stops.length, t.times.length);
    for (const i of t.stops) assert.ok(Number.isInteger(i) && raw.stops[i]);
  }
  for (const tr of raw.transfers.slice(0, 50)) {
    assert.ok(Number.isInteger(tr.from) && Number.isInteger(tr.to));
    assert.ok(Number.isFinite(tr.walkSec));
  }
});

/* ---- the search --------------------------------------------------------- */

test('lowerBound finds the first departure at or after a time', () => {
  const i = engine.lowerBound(net.dep, 9 * 3600, net.connectionCount);
  assert.ok(net.dep[i] >= 9 * 3600);
  if (i > 0) assert.ok(net.dep[i - 1] < 9 * 3600);
});

test('a 30 minute search from T-Centralen reaches a useful part of the net', () => {
  const r = engine.search(net, q());
  assert.ok(r.originStops >= 1, 'origin should find stops');
  assert.ok(r.reached >= 15, 'expected a decent catchment, got ' + r.reached);
});

test('arrival times stay inside the budget', () => {
  const query = q();
  const r = engine.search(net, query);
  for (let i = 0; i < r.arrival.length; i++) {
    if (r.arrival[i] === engine.INF) continue;
    assert.ok(r.arrival[i] >= query.startSec);
    assert.ok(r.arrival[i] <= query.startSec + query.maxTravelSeconds);
  }
});

test('more travel time never reaches fewer stops', () => {
  let prev = -1;
  for (const minutes of [10, 20, 30, 45, 60]) {
    const r = engine.search(net, q({ maxTravelMinutes: minutes }));
    assert.ok(r.reached >= prev, minutes + ' min reached ' + r.reached + ' < ' + prev);
    prev = r.reached;
  }
});

test('more transfers never reaches fewer stops', () => {
  let prev = -1;
  for (const transfers of [0, 1, 2, 3]) {
    const r = engine.search(net, q({ maxTransfers: transfers, maxTravelMinutes: 60 }));
    assert.ok(r.reached >= prev, transfers + ' transfers reached ' + r.reached + ' < ' + prev);
    prev = r.reached;
  }
});

test('zero transfers means one leg only', () => {
  const r = engine.search(net, q({ maxTransfers: 0, maxTravelMinutes: 60 }));
  assert.equal(r.rounds, 1);
  assert.ok(r.reached > r.originStops, 'one leg should still get somewhere');
});

test('mode filtering actually restricts the result', () => {
  const all = engine.search(net, q({ maxTravelMinutes: 60 }));
  const metroOnly = engine.search(net, q({ maxTravelMinutes: 60, modes: ['metro'] }));
  assert.ok(metroOnly.reached < all.reached, 'metro only should reach fewer stops');
  assert.ok(metroOnly.reached > 1, 'metro only should still reach something');
});

test('a known journey has a plausible arrival time', () => {
  const r = engine.search(net, q({ maxTravelMinutes: 60, modes: ['metro'] }));
  const slussen = net.indexByName.get('Slussen');
  assert.ok(slussen !== undefined, 'Slussen should exist in the network');
  const travelMin = (r.arrival[slussen] - q().startSec) / 60;
  assert.ok(travelMin > 2 && travelMin < 20,
    'T-Centralen to Slussen took ' + travelMin.toFixed(1) + ' min');
});

test('walking transfers are bounded by the walking setting', () => {
  const generous = engine.search(net, q({ maxTravelMinutes: 60, walking: { transferMinutes: 15 } }));
  const none = engine.search(net, q({ maxTravelMinutes: 60, walking: { transferMinutes: 0 } }));
  assert.ok(generous.reached >= none.reached);
});

test('a tighter wait limit never reaches more stops', () => {
  const loose = engine.search(net, q({ maxTravelMinutes: 60, maxWaitMinutes: 30 }));
  const tight = engine.search(net, q({ maxTravelMinutes: 60, maxWaitMinutes: 1 }));
  assert.ok(tight.reached <= loose.reached);
});

test('a pin in the middle of the Baltic finds no stops', () => {
  assert.throws(() => computeIsochrone(q({ origin: { lat: 58.0, lon: 20.5 } })),
    (err) => err.code === 'no_stops_near_origin');
});

/* ---- the bands ---------------------------------------------------------- */

test('bands come back outermost first and cover the whole budget', () => {
  const out = computeIsochrone(q({ maxTravelMinutes: 30 }));
  assert.equal(out.type, 'FeatureCollection');
  assert.equal(out.features.length, 6);
  assert.equal(out.features[0].properties.toMinutes, 30);
  assert.equal(out.features[5].properties.toMinutes, 5);
  for (const f of out.features) {
    assert.equal(f.geometry.type, 'MultiPolygon');
    assert.ok(/^#[0-9a-f]{6}$/.test(f.properties.color));
  }
});

test('band properties carry both spellings', () => {
  const f = computeIsochrone(q()).features[0];
  assert.equal(f.properties.from_min, f.properties.fromMinutes);
  assert.equal(f.properties.to_min, f.properties.toMinutes);
});

test('band geometry is valid GeoJSON with lon,lat order and closed rings', () => {
  const out = computeIsochrone(q());
  const ring = out.features[0].geometry.coordinates[0][0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'ring must be closed');
  for (const [lon, lat] of ring) {
    assert.ok(lon > 16 && lon < 20, 'longitude out of range: ' + lon);
    assert.ok(lat > 58.5 && lat < 60.5, 'latitude out of range: ' + lat);
  }
});

test('an outer band never contains fewer stops than an inner one', () => {
  const out = computeIsochrone(q());
  for (let i = 1; i < out.features.length; i++) {
    assert.ok(out.features[i - 1].properties.stops >= out.features[i].properties.stops);
  }
});

test('every band is present even when empty', () => {
  const out = computeIsochrone(q({ maxTravelMinutes: 120, maxTransfers: 0 }));
  assert.equal(out.features.length, 24);
  for (const f of out.features) assert.ok(Array.isArray(f.geometry.coordinates));
});

/* ---- the edges: three teams, three spellings ---------------------------- */

test("mareri's snake_case body is understood", () => {
  const parsed = parseRequest(JSON.stringify({
    origin: { lat: 59.33, lon: 18.06 },
    start_time: '08:15',
    max_travel_min: 45,
    max_wait_min: 10,
    max_transfers: 2,
    walk: { to_destination_min: 8, between_stations_min: 4 },
    modes: ['metro', 'bus'],
  }));
  assert.equal(parsed.startSec, 8 * 3600 + 15 * 60);
  assert.equal(parsed.maxTravelSeconds, 45 * 60);
  assert.equal(parsed.maxWaitSeconds, 10 * 60);
  assert.equal(parsed.maxTransfers, 2);
  assert.equal(parsed.egressSeconds, 8 * 60);
  assert.equal(parsed.transferSeconds, 4 * 60);
});

test("filbac's camelCase body is understood", () => {
  const parsed = parseRequest(JSON.stringify({
    origin: { lat: 59.33, lon: 18.06 },
    startTime: '2026-10-24T09:30:00+02:00',
    day: 'saturday',
    maxTravelMin: 20,
    maxWaitMin: 5,
    maxTransfers: 1,
    walk: { toDestinationMin: 6, betweenStationsMin: 3 },
    bandMin: 10,
  }));
  assert.equal(parsed.dayType, 'saturday');
  assert.equal(parsed.maxTravelSeconds, 20 * 60);
  assert.equal(parsed.bandSeconds, 10 * 60);
  assert.equal(parsed.egressSeconds, 6 * 60);
  assert.equal(parsed.transferSeconds, 3 * 60);
  assert.equal(formatHHMM(parsed.startSec), '09:30');
});

test('our own spelling still wins when both are present', () => {
  const parsed = parseRequest(JSON.stringify({
    origin: ORIGIN, maxTravelMinutes: 15, max_travel_min: 90,
  }));
  assert.equal(parsed.maxTravelSeconds, 15 * 60);
});

test('lng and latitude spellings of the origin work', () => {
  const parsed = parseRequest(JSON.stringify({ origin: { latitude: 59.33, lng: 18.06 } }));
  assert.equal(parsed.origin.lat, 59.33);
  assert.equal(parsed.origin.lon, 18.06);
});

test('the day type is derived from the date when not given', () => {
  const sat = parseRequest(JSON.stringify({
    origin: ORIGIN, startTime: '2026-10-24T10:00:00+02:00' }));
  const sun = parseRequest(JSON.stringify({
    origin: ORIGIN, startTime: '2026-10-25T10:00:00+02:00' }));
  const wed = parseRequest(JSON.stringify({
    origin: ORIGIN, startTime: '2026-10-21T10:00:00+02:00' }));
  assert.equal(sat.dayType, 'saturday');
  assert.equal(sun.dayType, 'sunday');
  assert.equal(wed.dayType, 'weekday');
});

test('defaults match the contract', () => {
  const parsed = parseRequest(JSON.stringify({ origin: ORIGIN }));
  assert.equal(parsed.maxTravelSeconds, 30 * 60);
  assert.equal(parsed.maxWaitSeconds, 7 * 60);
  assert.equal(parsed.maxTransfers, 3);
  assert.equal(parsed.bandSeconds, 5 * 60);
  assert.deepEqual(parsed.allowedModes, network.MODES);
});

test('bad input is rejected with the documented codes', () => {
  const bad = (body, code) => {
    assert.throws(() => parseRequest(JSON.stringify(body)),
      (err) => err.code === code, code + ' expected for ' + JSON.stringify(body));
  };
  bad({}, 'bad_request');
  bad({ origin: { lat: 59.3 } }, 'bad_request');
  bad({ origin: ORIGIN, maxTravelMinutes: 500 }, 'bad_request');
  bad({ origin: ORIGIN, maxTransfers: -1 }, 'bad_request');
  bad({ origin: ORIGIN, modes: ['helicopter'] }, 'unknown_mode');
  bad({ origin: ORIGIN, modes: [] }, 'bad_request');
  bad({ origin: ORIGIN, startTime: 'half past nine' }, 'bad_request');
  bad({ origin: ORIGIN, day: 'thursday' }, 'bad_request');
  assert.throws(() => parseRequest('{not json'), (err) => err.code === 'bad_request');
});

/* ---- cache and HTTP ----------------------------------------------------- */

test('an identical request is served from cache, a different one is not', () => {
  state.cache.clear();
  computeIsochrone(q({ maxTravelMinutes: 25 }));
  assert.equal(computeIsochrone(q({ maxTravelMinutes: 25 })).cached, true);
  assert.notEqual(computeIsochrone(q({ maxTravelMinutes: 25, maxTransfers: 1 })).cached, true);
});

test('the HTTP surface answers health, modes and isochrone', async () => {
  const call = (method, path, body) => new Promise((resolve) => {
    const req = {
      method,
      on(ev, fn) {
        if (ev === 'data' && body) fn(Buffer.from(body));
        if (ev === 'end') fn();
        return req;
      },
      destroy() {},
    };
    const res = {
      statusCode: 0,
      writeHead(s) { res.statusCode = s; return res; },
      end(text) { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); },
    };
    plugin.handle(req, res, { path }).then((handled) => {
      if (!handled) resolve({ status: 404, body: null });
    });
  });

  const health = await call('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.networkLoaded, true);
  assert.ok(health.body.connections > 0);

  const modes = await call('GET', '/modes');
  assert.ok(modes.body.modes.includes('metro'));

  const iso = await call('POST', '/isochrone',
    JSON.stringify({ origin: ORIGIN, startTime: '09:00', maxTravelMinutes: 20 }));
  assert.equal(iso.status, 200);
  assert.equal(iso.body.features.length, 4);

  assert.equal((await call('GET', '/isochrone')).status, 405);

  const badBody = await call('POST', '/isochrone', '{"origin":{}}');
  assert.equal(badBody.status, 400);
  assert.equal(badBody.body.error, 'bad_request');
  assert.equal(badBody.body.kind, 'bad_request');
  assert.ok(badBody.body.message_sv, 'Swedish message required by the contract');

  const far = await call('POST', '/isochrone', '{"origin":{"lat":58.0,"lon":20.5}}');
  assert.equal(far.status, 422);
  assert.equal(far.body.kind, 'no_routes', 'mareri asked for this vocabulary');

  assert.equal((await call('GET', '/nope')).status, 404);
});

test('a 120 minute query stays within the performance requirement', () => {
  state.cache.clear();
  const started = Date.now();
  const out = computeIsochrone(q({ maxTravelMinutes: 120 }));
  const ms = Date.now() - started;
  const budget = onRealData ? 2000 : 1000;
  assert.ok(ms < budget, 'took ' + ms + ' ms, budget ' + budget);
  console.log('    (120 min: ' + ms + ' ms, ' + out.meta.stopsReached + ' stops, ' +
    out.meta.rounds + ' rounds)');
});

test('a 120 minute answer stays small enough to send to a phone', () => {
  state.cache.clear();
  const out = computeIsochrone(q({ maxTravelMinutes: 120 }));
  const raw = Buffer.byteLength(JSON.stringify(out), 'utf8');
  const packed = gzipSync(Buffer.from(JSON.stringify(out), 'utf8'), { level: 6 }).length;
  const rawCeiling = onRealData ? 6 * 1024 * 1024 : 2 * 1024 * 1024;
  const wireCeiling = onRealData ? 1.6 * 1024 * 1024 : 512 * 1024;
  console.log('    (120 min payload: ' + (raw / 1048576).toFixed(2) + ' MB raw, ' +
    (packed / 1048576).toFixed(2) + ' MB gzipped)');
  assert.ok(raw < rawCeiling, 'raw payload ' + raw + ' over ceiling ' + rawCeiling);
  assert.ok(packed < wireCeiling, 'gzipped payload ' + packed + ' over ceiling ' + wireCeiling);
});

test('the start time is echoed as a full ISO string with the Stockholm offset', () => {
  const iso = computeIsochrone(parseRequest(JSON.stringify({
    origin: ORIGIN, startTime: '2026-10-22T09:00:00+02:00', maxTravelMinutes: 15,
  })));
  assert.equal(iso.meta.startTime, '2026-10-22T09:00:00+02:00',
    'tomfor sent ISO and got HH:MM back; it must round-trip');
  assert.equal(iso.meta.startTimeLocal, '09:00');

  // Same instant written in UTC must resolve to the same Stockholm wall clock.
  const utc = computeIsochrone(parseRequest(JSON.stringify({
    origin: ORIGIN, startTime: '2026-10-22T07:00:00Z', maxTravelMinutes: 15,
  })));
  assert.equal(utc.meta.startTime, '2026-10-22T09:00:00+02:00');

  // tomfor sent seconds+ms (2026-10-22T08:54:37.123Z) and got +01:59 instead
  // of +02:00: the offset was derived from a minute-truncated UTC instant
  // compared against the untruncated original, losing up to 59.999 s.
  const withSeconds = computeIsochrone(parseRequest(JSON.stringify({
    origin: ORIGIN, startTime: '2026-10-22T08:54:37.123Z', maxTravelMinutes: 15,
  })));
  assert.equal(withSeconds.meta.startTime.slice(-6), '+02:00',
    'seconds/ms in the input must not corrupt the derived Stockholm offset');
});

test('any whole minute from 5 to 120 is accepted, outside that is rejected', () => {
  // tomfor sent 33 and the contract claimed multiple-of-5. We dropped the rule
  // rather than start rejecting a value we compute correctly.
  assert.equal(parseRequest(JSON.stringify({ origin: ORIGIN, maxTravelMinutes: 33 }))
    .maxTravelMinutes, 33);
  for (const bad of [4, 0, 121, -5]) {
    assert.throws(
      () => parseRequest(JSON.stringify({ origin: ORIGIN, maxTravelMinutes: bad })),
      (err) => err.code === 'bad_request',
      'maxTravelMinutes ' + bad + ' must be rejected');
  }
});

test('a wider access walk never reaches fewer stops', () => {
  const reached = (accessMinutes) => computeIsochrone(parseRequest(JSON.stringify({
    origin: ORIGIN, startTime: '09:00', maxTravelMinutes: 30, walking: { accessMinutes },
  }))).meta.stopsReached;
  let last = 0;
  for (const m of [5, 10, 15, 25]) {
    const now = reached(m);
    assert.ok(now >= last, 'access ' + m + ' min reached ' + now + ', was ' + last);
    last = now;
  }
});

test('fit() never drops a disc whose centre ends up uncovered (vijay-team hole bug)', () => {
  const bands = require('../../board/plugins/marlin/bands.js');
  const { haversine } = require('../../board/plugins/marlin/isochrone.js');

  // Three discs on a line: O covers B at a higher slack than B needs to
  // cover C. At the band's base slack only C is covered (by B; B itself
  // survives), which is fine - B still stands in for C's position. The old
  // bug: forcing a SECOND refinement pass (by exceeding the polygon budget)
  // re-decimated the already-reduced set instead of the original discs, so
  // once that second pass raised the slack enough to cover B by O, C's
  // position was gone for good even though O never covers C directly.
  const lat = 59.33;
  const metresToLat = (m) => m / 111320;
  const O = { lat, lon: 18.06, r: 1000 };
  const B = { lat: lat + metresToLat(900), lon: 18.06, r: 500 };
  const C = { lat: lat + metresToLat(1300), lon: 18.06, r: 200 };
  // Far-away, mutually non-overlapping filler discs whose only job is to
  // exceed the 50-minute band's polygon budget (550) and force the
  // multi-pass refinement loop that the bug lived in.
  const filler = [];
  for (let i = 0; i < 560; i++) {
    filler.push({ lat: lat + 10 + i * 0.001, lon: 18.06, r: 1 });
  }
  const discs = [O, B, C, ...filler].map((d) => ({ ...d })); // fit()/decimate() sort in place

  const edgeSeconds = 50 * 60; // budgetFor(): max 550, slack 0.7 - needs a second pass here
  const kept = bands.fit(discs, edgeSeconds);
  assert.ok(kept.length >= 1, 'must keep at least one disc');

  for (const original of [O, B, C]) {
    const covered = kept.some((k) => haversine(original.lat, original.lon, k.lat, k.lon) <= k.r + 1e-6);
    assert.ok(covered, 'disc at ' + original.lat + ',' + original.lon + ' (r=' + original.r +
      ') has no coverage in the final band - this is the hole bug');
  }
});

test('forced discs carry a frozen checkR so independent per-band decimation stays nested (fc2a-eps1 gen-002)', () => {
  // Two adjacent cumulative bands can decimate the same cluster independently
  // and keep a different representative disc, even at identical slack - a
  // second, smaller disc's radius grows between bands by just enough to flip
  // which disc the greedy grid pass meets first. Without carrying proven
  // coverage forward, the inner band's winner can vanish in the outer band
  // before the new winner's radius has grown enough to cover what it proved.
  const bands = require('../../board/plugins/marlin/bands.js');
  const lat = 59.33;
  const dLat = (m) => m / 111320;
  const slack = 0.5;

  // X was already proven (checkR = 500) in a narrower band. In this wider
  // band X's true radius has grown to 650, and a bigger neighbour O (radius
  // 1000) sits 680 m away - close enough to absorb X using its frozen
  // checkR (680 + 500*(1-slack) = 930 <= 1000), but NOT close enough to
  // absorb X at its full new radius (680 + 650*(1-slack) = 1005 > 1000).
  const O = { lat, lon: 18.06, r: 1000 };
  const X = { lat: lat + dLat(680), lon: 18.06, r: 650 };

  const keptNoForce = bands.decimate([O, X], slack);
  assert.ok(keptNoForce.some((d) => d.lat === X.lat),
    'without checkR, X survives at its own full radius (not yet absorbed)');

  const keptForced = bands.decimate([O], slack, [{ ...X, checkR: 500 }]);
  assert.ok(!keptForced.some((d) => d.lat === X.lat),
    'forced X with a frozen checkR must be absorbed into O, freeing budget');
  const keptO = keptForced.find((d) => d.lat === O.lat);
  assert.ok(keptO && keptO.r === 1000, 'the surviving neighbour must keep its own full radius');
});

/* ---- arrive-by (reverse search) ----------------------------------------- */

test('arrive-by finds a comparable catchment to the forward search', () => {
  // Not the same stops (the reverse scan depends on which trips happen to
  // arrive by the deadline, not which ones depart after a start time) but a
  // walk-only trip is reachable both ways, and both directions should find a
  // meaningful, non-trivial catchment for the same budget.
  const fwd = engine.search(net, q({ maxTravelMinutes: 30 }));
  const rev = engine.searchReverse(net, Object.assign({}, q({ maxTravelMinutes: 30 }),
    { deadlineSec: 8 * 3600 + 30 * 60 }));
  assert.ok(rev.originStops >= 1, 'egress from the pin should find stops');
  assert.ok(rev.reached >= 15, 'expected a decent catchment, got ' + rev.reached);
  assert.ok(Math.abs(rev.reached - fwd.reached) < fwd.reached,
    'reverse catchment should be the same order of magnitude as forward');
});

test('arrive-by latest-departure times stay inside the budget and before the deadline', () => {
  const deadlineSec = 9 * 3600;
  const query = Object.assign({}, q({ maxTravelMinutes: 45 }), { deadlineSec });
  const r = engine.searchReverse(net, query);
  for (let i = 0; i < r.arrival.length; i++) {
    if (r.arrival[i] === -1) continue;
    assert.ok(r.arrival[i] <= deadlineSec, 'latest time must not be after the deadline');
    assert.ok(deadlineSec - r.arrival[i] <= query.maxTravelSeconds, 'must stay inside the budget');
  }
});

test('a tighter arrive-by travel budget never reaches more stops', () => {
  let prevReached = Infinity;
  for (const minutes of [60, 45, 30, 15]) {
    const r = engine.searchReverse(net, Object.assign({}, q({ maxTravelMinutes: minutes }),
      { deadlineSec: 9 * 3600 }));
    assert.ok(r.reached <= prevReached, minutes + ' min reached ' + r.reached + ' > ' + prevReached);
    prevReached = r.reached;
  }
});

test('the API accepts arriveBy and echoes a deadline, not a startTime', () => {
  const r = computeIsochrone(parseRequest(JSON.stringify({
    origin: ORIGIN, arriveBy: true, startTime: '09:00', maxTravelMinutes: 30,
  })));
  assert.equal(r.meta.arriveBy, true);
  assert.ok(r.meta.deadline, 'deadline must be echoed back');
  assert.equal(r.meta.startTime, undefined, 'startTime must not be echoed for an arrive-by request');
  assert.ok(r.meta.stopsReached > 0);
  assert.ok(r.features.length > 0);
});

test('arrive-by bands are still cumulative, outermost first, and cover the budget', () => {
  const r = computeIsochrone(parseRequest(JSON.stringify({
    origin: ORIGIN, arriveBy: true, startTime: '08:45', maxTravelMinutes: 30, bandMinutes: 10,
  })));
  const mins = r.features.map((f) => f.properties.toMinutes);
  for (let i = 1; i < mins.length; i++) {
    assert.ok(mins[i] <= mins[i - 1], 'bands must come back outermost first, like the forward contract');
  }
  assert.equal(mins[0], 30);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + (err && err.message));
  }
}
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
