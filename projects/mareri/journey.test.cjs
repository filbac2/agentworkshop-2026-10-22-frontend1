const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const street = require('../../board/plugins/mareri/street');
const { _internals: { search } } = require('../../board/plugins/mareri/iso');
const { plan } = require('../../board/plugins/mareri/journey');
const network = require('../../board/plugins/marlin/network');
const marlin = require('../../board/plugins/marlin');
const plugin = require('../../board/plugins/mareri');

test('street routes respect edge costs, walking limits and disconnected components', () => {
  const graph = {
    off: [0, 2, 4, 5, 5], to: [1, 2, 0, 2, 1], len: [10, 100, 10, 10, 10],
    lat: [59.3, 59.31, 59.32, 59.33], lon: [18, 18.01, 18.02, 18.03]
  };
  const route = street.route(graph, 0, 2, 2, 10);
  assert.equal(route.seconds, 10);
  assert.equal(route.metres, 20);
  assert.equal(route.coords.length, 3);
  assert.equal(street.route(graph, 0, 2, 2, 9), null);
  assert.equal(street.route(graph, 0, 3, 2, 1000), null);
});

test('trace retains the actual boarding parent when later rounds improve the same stop', () => {
  const net = network.build({
    stops: ['A', 'B', 'C', 'D', 'E'].map((name) => ({ id: name, name, lat: 59.3, lon: 18 })),
    trips: [
      { mode: 'bus', stops: [0, 1, 2], times: [100, 200, 300] },
      { mode: 'metro', stops: [3, 4], times: [240, 280] },
      { mode: 'bus', stops: [0, 3], times: [110, 230] }
    ],
    transfers: [{ from: 1, to: 3, walkSec: 20 }]
  }, 'fixture', 'journey-test');
  const q = {
    startSec: 0, maxTravelSeconds: 400, maxWaitSeconds: 100, maxTransfers: 1,
    allowedModes: ['bus', 'metro'], transferSeconds: 30
  };
  const result = search(net, q, [[0, 0]], net, true);
  const plain = search(net, q, [[0, 0]], net);
  assert.deepEqual(result.arrival, plain.arrival);
  const chain = [];
  for (let id = result.bestLab[4]; id >= 0; id = result.recs[id].p) chain.unshift(result.recs[id]);
  assert.deepEqual(chain.map((r) => r.k), ['access', 'ride', 'walk', 'ride']);
  assert.deepEqual(chain.map((r) => r.t), [0, 200, 220, 280]);
  assert.equal(net.from[chain[1].bc], 0);
  assert.equal(net.to[chain[1].ac], 1);
  assert.equal(net.from[chain[3].bc], 3);
});

const helpers = marlin._internals;
const store = network.createStore(__dirname);
helpers.state.store = store;
const request = {
  origin: { lat: 59.3293, lon: 18.0686 }, startTime: '2026-10-22T09:00:00+02:00',
  maxTravelMinutes: 45, maxWaitMinutes: 7, maxTransfers: 3,
  walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }
};

test('real network journey includes street walks, line names and valid timed rides', () => {
  const q = helpers.parseRequest(JSON.stringify(request));
  const journey = plan(store.get(q.dayType), q, { lat: 59.3, lon: 18.075 }, helpers);
  assert.ok(journey.totalMinutes <= 45);
  assert.equal(journey.walkingModel, 'street');
  const rides = journey.legs.filter((l) => l.type === 'ride');
  assert.ok(rides.length > 0);
  assert.ok(rides.every((l) => l.line && l.from.name && l.to.name && l.stops > 0));
  assert.ok(journey.legs.every((l) => l.path.length >= 2));
  assert.ok(journey.legs.filter((l) => l.type === 'walk').every((l) => l.street && l.minutes <= 10));
  assert.equal(journey.transfers, rides.length - 1);
  const parseTime = (s) => s.split(':').reduce((h, m) => h * 60 + Number(m), 0);
  for (let i = 0; i < rides.length; i++) {
    assert.ok(parseTime(rides[i].arrive) >= parseTime(rides[i].depart));
    if (i) assert.ok(parseTime(rides[i].depart) >= parseTime(rides[i - 1].arrive));
  }
});

test('direct walks and destinations beyond the travel limit are distinguished', () => {
  const q = helpers.parseRequest(JSON.stringify(request));
  const net = store.get(q.dayType);
  const direct = plan(net, q, { lat: 59.33, lon: 18.07 }, helpers);
  assert.equal(direct.legs.length, 1);
  assert.equal(direct.legs[0].type, 'walk');
  const shortQ = { ...q, maxTravelSeconds: 300 };
  assert.deepEqual(plan(net, shortQ, { lat: 59.3, lon: 18.075 }, helpers), { unreachable: true });
});

async function handle(body, method = 'POST') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = {};
  req.url = '/t/mareri/journey';
  const response = {};
  const res = {
    writeHead(status) { response.status = status; },
    end(data) { response.body = data ? JSON.parse(data.toString()) : null; }
  };
  assert.equal(await plugin.handle(req, res, { path: '/journey' }), true);
  return response;
}

test('journey endpoint validates targets and reports unreachable destinations', async () => {
  for (const target of [undefined, {}, { lat: 91, lon: 18 }, { lat: null, lon: 18 }]) {
    const r = await handle({ ...request, target });
    assert.equal(r.status, 400);
    assert.ok(r.body.message && r.body.message_sv);
  }
  assert.equal((await handle(request, 'GET')).status, 405);
  const r = await handle({ ...request, target: { lat: 0, lon: 0 } });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'not_reachable');
});
