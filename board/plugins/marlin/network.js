'use strict';

/**
 * Network loading for the marlin isochrone engine.
 *
 * Reads vijay-team's preprocessed SL network and flattens it into columnar
 * typed arrays. No request ever calls Trafiklab, and no request ever calls
 * vijay-team either: the file is read once, from disk, at startup.
 *
 * Their format (projects/vijay-team/CONTRACT.md):
 *   { stops: [{id,name,lat,lon,modes}],
 *     trips: [{route, mode, stops: [stopIndex], times: [secondsAfterMidnight]}],
 *     transfers: [{from, to, walkSec}] }
 *
 * Ours is one connection per consecutive pair of a trip, because the engine
 * scans connections in departure order. Columnar Int32Arrays rather than
 * objects: a weekday is around 700k connections, and 700k small objects is
 * hundreds of megabytes we do not need to spend.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];
const DAY_TYPES = ['weekday', 'saturday', 'sunday'];

// vijay-team's committed artifacts. Read-only: their folder, their data.
// They have used both folder names, so we try both rather than break on a rename.
const VIJAY_DIRS = [
  path.join(__dirname, '..', 'vijay-team', 'artifacts'),
  path.join(__dirname, '..', 'vijay-team', 'data'),
];

function dayTypeFor(date) {
  const day = date.getDay();
  if (day === 0) return 'sunday';
  if (day === 6) return 'saturday';
  return 'weekday';
}

function readGzJson(file) {
  const buf = fs.readFileSync(file);
  const text = file.endsWith('.gz')
    ? zlib.gunzipSync(buf).toString('utf8')
    : buf.toString('utf8');
  return JSON.parse(text);
}

function readConnectionsFile(dir, dayType) {
  const candidates = [
    path.join(dir, 'connections-' + dayType + '.json.gz'),
    path.join(dir, 'connections-' + dayType + '.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = readGzJson(file);
      if (raw && raw.from && raw.to && raw.dep && raw.arr) {
        return { raw, file };
      }
    } catch (err) {
      console.error('[marlin] could not read', path.basename(file), err && err.message);
    }
  }
  return null;
}

function readNetworkFile(dir, dayType) {
  const candidates = [
    path.join(dir, 'network-' + dayType + '.json.gz'),
    path.join(dir, 'network-' + dayType + '.json'),
    path.join(dir, 'network.json.gz'),
    path.join(dir, 'network.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const buf = fs.readFileSync(file);
      const text = file.endsWith('.gz')
        ? zlib.gunzipSync(buf).toString('utf8')
        : buf.toString('utf8');
      return { raw: JSON.parse(text), file };
    } catch (err) {
      console.error('[marlin] could not read', path.basename(file), err && err.message);
    }
  }
  return null;
}

/**
 * @param {object} raw     vijay-team's network document
 * @param {string} source  'gtfs' or 'fixture'
 */
function build(raw, source, label) {
  const stops = (raw.stops || []).map((s) => ({
    id: String(s.id),
    name: s.name || String(s.id),
    lat: Number(s.lat),
    lon: Number(s.lon),
    modes: Array.isArray(s.modes) ? s.modes : [],
  }));

  const stopCount = stops.length;
  const indexById = new Map();
  const indexByName = new Map();
  for (let i = 0; i < stopCount; i++) {
    indexById.set(stops[i].id, i);
    if (!indexByName.has(stops[i].name)) indexByName.set(stops[i].name, i);
  }

  // Count first, so each typed array is allocated exactly once.
  const trips = raw.trips || [];
  let upperBound = 0;
  for (const t of trips) {
    const n = Math.min(t.stops.length, t.times.length);
    if (n > 1) upperBound += n - 1;
  }

  const tFrom = new Int32Array(upperBound);
  const tTo = new Int32Array(upperBound);
  const tDep = new Int32Array(upperBound);
  const tArr = new Int32Array(upperBound);
  const tTrip = new Int32Array(upperBound);
  const tMode = new Uint8Array(upperBound);

  const modeIds = new Map();
  const modeNames = [];
  const modeIdOf = (name) => {
    let id = modeIds.get(name);
    if (id === undefined) {
      id = modeNames.length;
      modeIds.set(name, id);
      modeNames.push(name);
    }
    return id;
  };

  let w = 0;
  let tripId = 0;
  for (const t of trips) {
    const seq = t.stops;
    const times = t.times;
    const n = Math.min(seq.length, times.length);
    if (n < 2) continue;
    const mode = modeIdOf(String(t.mode || 'bus'));
    const id = tripId++;
    for (let i = 0; i + 1 < n; i++) {
      const from = seq[i];
      const to = seq[i + 1];
      const dep = times[i];
      const arr = times[i + 1];
      if (!(from >= 0 && from < stopCount && to >= 0 && to < stopCount)) continue;
      if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr < dep) continue;
      tFrom[w] = from; tTo[w] = to; tDep[w] = dep; tArr[w] = arr;
      tTrip[w] = id; tMode[w] = mode;
      w++;
    }
  }

  // Sort by departure once, by sorting an index permutation and writing the
  // columns back in that order.
  const order = new Array(w);
  for (let i = 0; i < w; i++) order[i] = i;
  order.sort((a, b) => tDep[a] - tDep[b] || tArr[a] - tArr[b]);

  const from = new Int32Array(w);
  const to = new Int32Array(w);
  const dep = new Int32Array(w);
  const arr = new Int32Array(w);
  const trip = new Int32Array(w);
  const mode = new Uint8Array(w);
  for (let i = 0; i < w; i++) {
    const j = order[i];
    from[i] = tFrom[j]; to[i] = tTo[j]; dep[i] = tDep[j];
    arr[i] = tArr[j]; trip[i] = tTrip[j]; mode[i] = tMode[j];
  }

  // Walking transfers in CSR form: the neighbours of stop s are
  // transferTo[transferOffset[s] .. transferOffset[s + 1]].
  const degree = new Int32Array(stopCount);
  const valid = [];
  for (const t of raw.transfers || []) {
    const f = t.from;
    const v = t.to;
    const sec = Number(t.walkSec !== undefined ? t.walkSec : t.seconds);
    if (!(f >= 0 && f < stopCount && v >= 0 && v < stopCount) || f === v) continue;
    if (!Number.isFinite(sec) || sec < 0) continue;
    valid.push([f, v, Math.round(sec)]);
    degree[f]++;
  }
  const transferOffset = new Int32Array(stopCount + 1);
  for (let i = 0; i < stopCount; i++) transferOffset[i + 1] = transferOffset[i] + degree[i];
  const transferTo = new Int32Array(valid.length);
  const transferSec = new Int32Array(valid.length);
  const cursor = Int32Array.from(transferOffset.subarray(0, stopCount));
  for (const [f, v, sec] of valid) {
    const at = cursor[f]++;
    transferTo[at] = v;
    transferSec[at] = sec;
  }

  const present = new Set(modeNames);

  return {
    source,
    label: label || source,
    dataVersion: raw.date ? 'sl-gtfs-' + raw.date
      : (raw.version ? 'v' + raw.version : 'unknown'),
    dayType: raw.dayType || 'weekday',
    timezone: 'Europe/Stockholm',
    stops,
    indexById,
    indexByName,
    connectionCount: w,
    from, to, dep, arr, trip, mode,
    tripCount: tripId,
    modeNames, modeIds,
    transferOffset, transferTo, transferSec,
    transferCount: valid.length,
    modes: MODES.filter((m) => present.has(m)),
  };
}

/**
 * vijay-team also ship a columnar connections artifact that carries **real
 * arrival times**. The network file only gives a departure per stop, so
 * rebuilding trips from it forces us to treat the next stop's departure as the
 * arrival, which overstates ride time on every route with a dwell. When the
 * connections file is there we use it and the engine gets more honest.
 */
function applyConnections(net, raw, label) {
  const n = Math.min(
    raw.from.length, raw.to.length, raw.dep.length, raw.arr.length);
  if (!n) return net;

  const routes = raw.routes || [];
  const modeIds = new Map();
  const modeNames = [];
  const modeIdOf = (name) => {
    let id = modeIds.get(name);
    if (id === undefined) {
      id = modeNames.length;
      modeIds.set(name, id);
      modeNames.push(name);
    }
    return id;
  };
  // Resolve each route's mode once rather than per connection.
  const routeMode = new Uint8Array(routes.length);
  for (let i = 0; i < routes.length; i++) {
    routeMode[i] = modeIdOf(String((routes[i] && routes[i].mode) || 'bus'));
  }
  const fallbackMode = modeIdOf('bus');

  const stopCount = net.stops.length;
  const order = [];
  for (let i = 0; i < n; i++) {
    const f = raw.from[i];
    const t = raw.to[i];
    const d = raw.dep[i];
    const a = raw.arr[i];
    if (!(f >= 0 && f < stopCount && t >= 0 && t < stopCount)) continue;
    if (!Number.isFinite(d) || !Number.isFinite(a) || a < d) continue;
    order.push(i);
  }
  order.sort((x, y) => raw.dep[x] - raw.dep[y] || raw.arr[x] - raw.arr[y]);

  const w = order.length;
  const from = new Int32Array(w);
  const to = new Int32Array(w);
  const dep = new Int32Array(w);
  const arr = new Int32Array(w);
  const trip = new Int32Array(w);
  const mode = new Uint8Array(w);
  let maxTrip = 0;
  for (let i = 0; i < w; i++) {
    const j = order[i];
    from[i] = raw.from[j];
    to[i] = raw.to[j];
    dep[i] = raw.dep[j];
    arr[i] = raw.arr[j];
    const t = raw.trip ? raw.trip[j] : 0;
    trip[i] = t;
    if (t > maxTrip) maxTrip = t;
    const r = raw.route ? raw.route[j] : -1;
    mode[i] = (r >= 0 && r < routeMode.length) ? routeMode[r] : fallbackMode;
  }

  const present = new Set(modeNames);
  return Object.assign({}, net, {
    connectionCount: w,
    from, to, dep, arr, trip, mode,
    tripCount: maxTrip + 1,
    modeNames, modeIds,
    modes: MODES.filter((m) => present.has(m)),
    connectionsLabel: label,
    realArrivals: true,
  });
}

/**
 * Loads one network per day type on demand (`get`), or all three up front
 * (`preloadAll`) - vijay-team's health audit measured the first weekend
 * query at ~4s because weekday was the only day warmed by then. `init()`
 * calls `preloadAll()` off the request path (setImmediate) so a deployment
 * still boots fast, but weekend files are usually ready before anyone asks.
 */
function createStore(dataDir) {
  const loaded = new Map();
  const searchDirs = [
    ...VIJAY_DIRS,
    path.join(dataDir || '.', 'network'),
    dataDir || '.',
  ];

  function loadDay(dayType) {
    if (loaded.has(dayType)) return loaded.get(dayType);

    let net = null;
    for (const dir of searchDirs) {
      const found = readNetworkFile(dir, dayType);
      if (!found || !Array.isArray(found.raw.stops) || !found.raw.stops.length) continue;
      const started = Date.now();
      net = build(found.raw, 'gtfs', path.basename(found.file));

      // Prefer vijay-team's connections artifact when it sits beside the
      // network file: same stop indices, but with real arrival times.
      const conn = readConnectionsFile(dir, dayType);
      if (conn && conn.raw.stopCount === found.raw.stops.length) {
        net = applyConnections(net, conn.raw, path.basename(conn.file));
      }

      console.log('[marlin]', dayType, 'network:', net.stops.length, 'stops,',
        net.connectionCount, 'connections,', net.transferCount, 'transfers from',
        path.basename(found.file),
        net.realArrivals ? '+ ' + net.connectionsLabel + ' (real arrivals)' : '(derived arrivals)',
        'in', Date.now() - started, 'ms');
      break;
    }

    if (!net) {
      const fixture = require('./fixture');
      net = build(fixture.raw(), 'fixture', 'fixture');
      console.log('[marlin] no preprocessed network found - running on the fixture');
    }

    loaded.set(dayType, net);
    return net;
  }

  return {
    get(dayType) {
      return loadDay(DAY_TYPES.includes(dayType) ? dayType : 'weekday');
    },
    loadedDays() {
      return Array.from(loaded.keys());
    },
    preloadAll() {
      for (const dayType of DAY_TYPES) loadDay(dayType);
    },
  };
}

module.exports = { createStore, build, dayTypeFor, MODES, DAY_TYPES };
