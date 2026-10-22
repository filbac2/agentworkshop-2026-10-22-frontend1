'use strict';

/**
 * marlin — isochrone engine for Stockholm public transport.
 *
 * Mounted on /t/marlin/. The contract is projects/marlin/CONTRACT.md.
 *
 *   POST /t/marlin/isochrone   origin + settings -> GeoJSON colour bands
 *   GET  /t/marlin/health      liveness, which data is loaded
 *   GET  /t/marlin/modes       modes this deployment actually has data for
 *
 * Gene "tolerant-edges" (see .claude/flux/winners/7c1e-delta.md): three teams
 * proposed three spellings of the same fields. Rather than argue, every
 * reasonable spelling is accepted and normalised inward, and the response
 * carries both spellings outward. Integration bugs are not worth a debate.
 */

const network = require('./network');
const engine = require('./isochrone');
const bands = require('./bands');
const zlib = require('zlib');

const MODES = network.MODES;
const MAX_BODY_BYTES = 64 * 1024;
const CACHE_LIMIT = 40;
const GZIP_THRESHOLD_BYTES = 8 * 1024;

const state = {
  store: null,
  cache: new Map(),
};

// kind is the vocabulary mareri's frontend asked for; error is ours. Both ship.
const ERRORS = {
  bad_request: [400, 'bad_request',
    'The request could not be understood.',
    'Förfrågan kunde inte tolkas.'],
  unknown_mode: [400, 'bad_request',
    'Unknown transport type.',
    'Okänt färdsätt.'],
  no_stops_near_origin: [422, 'no_routes',
    'No stop within walking distance of the pin. Move the pin or allow a longer walk.',
    'Ingen hållplats inom gångavstånd från nålen. Flytta nålen eller tillåt längre gångtid.'],
  nothing_reachable: [422, 'too_restrictive',
    'Nothing is reachable with these settings. Try a longer travel time, more transfers or more transport types.',
    'Inget går att nå med de här inställningarna. Prova längre restid, fler byten eller fler färdsätt.'],
  network_not_loaded: [503, 'server',
    'The transit network is not loaded yet. Try again shortly.',
    'Trafiknätet är inte inläst ännu. Försök igen om en stund.'],
  internal: [500, 'server',
    'Something went wrong in the isochrone engine.',
    'Något gick fel i isokronmotorn.'],
};

class ApiError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = ERRORS[code] ? code : 'internal';
    this.detail = detail;
  }
}

/**
 * A two-hour isochrone is megabytes of coordinates, and coordinates compress
 * extremely well. Gzip when the client offers it and the body is big enough to
 * be worth the CPU.
 */
function sendJson(res, status, body, req) {
  const text = JSON.stringify(body);
  const raw = Buffer.from(text, 'utf8');
  const accepts = String((req && req.headers && req.headers['accept-encoding']) || '');

  if (raw.length >= GZIP_THRESHOLD_BYTES && /\bgzip\b/.test(accepts)) {
    const packed = zlib.gzipSync(raw, { level: 6 });
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
      'cache-control': 'no-store',
      'vary': 'accept-encoding',
      'content-length': packed.length,
    });
    res.end(packed);
    return;
  }

  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'vary': 'accept-encoding',
    'content-length': raw.length,
  });
  res.end(raw);
}

function sendError(res, err, req) {
  const code = err instanceof ApiError ? err.code : 'internal';
  const [status, kind, message, messageSv] = ERRORS[code];
  sendJson(res, status, {
    error: code,
    code,
    kind,
    message: err.detail ? message + ' ' + err.detail : message,
    message_sv: messageSv,
  }, req);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('bad_request', 'The request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** First spelling that is actually present wins. */
function pick(obj, names) {
  for (const n of names) {
    if (obj && obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
}

function num(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ApiError('bad_request', label + ' must be a number.');
  if (n < min || n > max) {
    throw new ApiError('bad_request', label + ' must be between ' + min + ' and ' + max + '.');
  }
  return n;
}

/**
 * Seconds after midnight, Europe/Stockholm, plus the day type that time falls
 * on. Accepts an ISO timestamp, "HH:MM", or nothing at all (meaning now).
 */
function parseStart(value, explicitDay) {
  let startSec;
  let date = new Date();

  if (typeof value === 'string') {
    const hhmm = /^(\d{1,2}):(\d{2})/.exec(value.trim());
    const isoLike = /^\d{4}-\d{2}-\d{2}/.test(value.trim());
    if (hhmm && !isoLike) {
      const h = Number(hhmm[1]);
      const m = Number(hhmm[2]);
      if (h > 23 || m > 59) throw new ApiError('bad_request', 'startTime is not a valid time.');
      startSec = h * 3600 + m * 60;
    } else {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new ApiError('bad_request', 'startTime is not a valid time.');
      }
      date = d;
      startSec = localSeconds(d);
    }
  } else if (value !== undefined && value !== null) {
    throw new ApiError('bad_request', 'startTime must be a string.');
  } else {
    startSec = localSeconds(date);
  }

  let dayType = explicitDay;
  if (dayType !== undefined) {
    if (!network.DAY_TYPES.includes(dayType)) {
      throw new ApiError('bad_request',
        'day must be one of: ' + network.DAY_TYPES.join(', ') + '.');
    }
  } else {
    dayType = network.dayTypeFor(date);
  }

  return { startSec, dayType, startDate: date };
}

/**
 * The resolved start as an unambiguous ISO string with the Stockholm offset.
 * Echoing only "HH:MM" made a caller who sent a full ISO timestamp think we
 * had lost their time zone (reported by tomfor), when in fact we had converted
 * it correctly. Say it in full instead.
 */
function formatISO(date, startSec) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;

  // Stockholm is +01:00 in winter and +02:00 in summer; derive it rather than
  // hard-coding either one. `asUTC` is built from minute-truncated wall-clock
  // parts, so it must be compared against `date` floored to the same minute -
  // otherwise a request with seconds/ms (tomfor: 2026-10-22T08:54:37.123Z)
  // loses up to 59.999s off the offset (+01:59 instead of +02:00).
  const asUTC = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')) % 24, Number(get('minute')));
  const dateMinute = Math.floor(date.getTime() / 60000) * 60000;
  const offsetMin = Math.round((asUTC - dateMinute) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const offset = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' +
    String(abs % 60).padStart(2, '0');

  return get('year') + '-' + get('month') + '-' + get('day') + 'T' +
    formatHHMM(startSec) + ':00' + offset;
}

function localSeconds(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
}

function parseRequest(body) {
  let input;
  try {
    input = body ? JSON.parse(body) : {};
  } catch {
    throw new ApiError('bad_request', 'The body is not valid JSON.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError('bad_request', 'The body must be a JSON object.');
  }

  const origin = input.origin || input.from || input.pin;
  if (!origin || typeof origin !== 'object') {
    throw new ApiError('bad_request', 'origin is required.');
  }
  const latRaw = pick(origin, ['lat', 'latitude']);
  const lonRaw = pick(origin, ['lon', 'lng', 'long', 'longitude']);
  if (latRaw === undefined || lonRaw === undefined) {
    throw new ApiError('bad_request', 'origin.lat and origin.lon are required.');
  }
  const lat = num(latRaw, undefined, -90, 90, 'origin.lat');
  const lon = num(lonRaw, undefined, -180, 180, 'origin.lon');

  let modes = pick(input, ['modes', 'transportTypes', 'transport_types']);
  if (modes === undefined) {
    modes = MODES.slice();
  } else if (!Array.isArray(modes) || modes.length === 0) {
    throw new ApiError('bad_request', 'modes must be a non-empty array.');
  } else {
    for (const m of modes) {
      if (!MODES.includes(m)) {
        throw new ApiError('unknown_mode',
          '"' + String(m).slice(0, 40) + '" is not one of: ' + MODES.join(', ') + '.');
      }
    }
  }

  const walk = input.walking || input.walk || {};
  if (typeof walk !== 'object' || Array.isArray(walk)) {
    throw new ApiError('bad_request', 'walking must be an object.');
  }

  const { startSec, dayType, startDate } = parseStart(
    pick(input, ['startTime', 'start_time', 'start']),
    pick(input, ['day', 'dayType', 'day_type']));

  const bandMinutes = num(pick(input, ['bandMinutes', 'bandMin', 'band_min']),
    5, 1, 30, 'bandMinutes');
  const maxTravelMinutes = num(
    pick(input, ['maxTravelMinutes', 'maxTravelMin', 'max_travel_min', 'max_travel_minutes']),
    30, 5, 120, 'maxTravelMinutes');
  const maxWaitMinutes = num(
    pick(input, ['maxWaitMinutes', 'maxWaitMin', 'max_wait_min', 'max_wait_minutes']),
    7, 0, 60, 'maxWaitMinutes');
  const maxTransfers = num(
    pick(input, ['maxTransfers', 'max_transfers', 'maxConnections', 'max_connections']),
    3, 0, 8, 'maxTransfers');

  const speedKmh = num(pick(walk, ['speedKmh', 'speed_kmh', 'speed']),
    4.8, 1, 10, 'walking.speedKmh');
  const accessMinutes = num(
    pick(walk, ['accessMinutes', 'toFirstStopMin', 'to_first_stop_min', 'access_min', 'accessMin']),
    10, 0, 30, 'walking.accessMinutes');
  const egressMinutes = num(
    pick(walk, ['egressMinutes', 'toDestinationMin', 'to_destination_min', 'egress_min', 'egressMin']),
    10, 0, 30, 'walking.egressMinutes');
  const transferMinutes = num(
    pick(walk, ['transferMinutes', 'betweenStationsMin', 'between_stations_min',
      'transfer_min', 'transferMin']),
    5, 0, 30, 'walking.transferMinutes');

  return {
    origin: { lat, lon },
    dayType,
    startSec,
    maxTravelSeconds: Math.round(maxTravelMinutes * 60),
    maxWaitSeconds: Math.round(maxWaitMinutes * 60),
    maxTransfers: Math.round(maxTransfers),
    allowedModes: modes,
    walkSpeedMs: speedKmh * 1000 / 3600,
    accessSeconds: Math.round(accessMinutes * 60),
    egressSeconds: Math.round(egressMinutes * 60),
    transferSeconds: Math.round(transferMinutes * 60),
    bandSeconds: Math.round(bandMinutes * 60),
    bandMinutes,
    maxTravelMinutes,
    startISO: formatISO(startDate, startSec),
  };
}

function cacheKey(q) {
  return [
    q.origin.lat.toFixed(5), q.origin.lon.toFixed(5), q.dayType, q.startSec,
    q.maxTravelSeconds, q.maxWaitSeconds, q.maxTransfers,
    q.allowedModes.slice().sort().join(','),
    q.walkSpeedMs.toFixed(3), q.accessSeconds, q.egressSeconds,
    q.transferSeconds, q.bandSeconds,
  ].join('|');
}

function computeIsochrone(q) {
  if (!state.store) throw new ApiError('network_not_loaded');

  const key = cacheKey(q);
  const hit = state.cache.get(key);
  if (hit) {
    state.cache.delete(key);
    state.cache.set(key, hit);
    return Object.assign({}, hit, { cached: true });
  }

  const net = state.store.get(q.dayType);
  const started = Date.now();
  const result = engine.search(net, q);

  if (result.originStops === 0) throw new ApiError('no_stops_near_origin');
  if (result.reached === 0) throw new ApiError('nothing_reachable');

  const bandCount = Math.max(1, Math.ceil(q.maxTravelSeconds / q.bandSeconds));
  const features = bands.build(net, result.arrival, {
    origin: q.origin,
    startSec: q.startSec,
    bandSeconds: q.bandSeconds,
    bandCount,
    walkSpeedMs: q.walkSpeedMs,
    egressSeconds: q.egressSeconds,
    accessSeconds: q.accessSeconds,
  });

  const payload = {
    type: 'FeatureCollection',
    meta: {
      origin: q.origin,
      startTime: q.startISO,
      startTimeLocal: formatHHMM(q.startSec),
      day: q.dayType,
      bandMinutes: q.bandMinutes,
      maxTravelMinutes: q.maxTravelMinutes,
      stopsReached: result.reached,
      rounds: result.rounds,
      computedMs: Date.now() - started,
      dataVersion: net.dataVersion,
      source: net.source,
      algorithm: 'rounds+scan',
      cumulativeBands: true,
    },
    features,
  };

  state.cache.set(key, payload);
  while (state.cache.size > CACHE_LIMIT) {
    state.cache.delete(state.cache.keys().next().value);
  }
  return payload;
}

function formatHHMM(sec) {
  const s = ((sec % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
         String(Math.floor((s % 3600) / 60)).padStart(2, '0');
}

module.exports = {
  init(ctx) {
    try {
      state.store = network.createStore(ctx && ctx.dataDir ? ctx.dataDir : __dirname);
      // Warm saturday/sunday off the request path: vijay-team's health audit
      // found the first weekend query cost ~4s because only weekday had been
      // loaded by then. setImmediate keeps init() itself fast (the server
      // still boots without waiting on all three files).
      setImmediate(() => {
        try {
          state.store.preloadAll();
        } catch (err) {
          console.error('[marlin] preloadAll failed:', err && err.message);
        }
      });
    } catch (err) {
      console.error('[marlin] could not create the network store:', err && err.message);
      state.store = null;
    }
  },

  async handle(req, res, ctx) {
    const p = String((ctx && ctx.path) || '').replace(/^\/+|\/+$/g, '');

    try {
      if (p === 'health') {
        const net = state.store ? state.store.get('weekday') : null;
        sendJson(res, 200, {
          ok: true,
          networkLoaded: !!net,
          dataVersion: net ? net.dataVersion : null,
          source: net ? net.source : null,
          stops: net ? net.stops.length : 0,
          connections: net ? net.connectionCount : 0,
          transfers: net ? net.transferCount : 0,
          days: state.store ? state.store.loadedDays() : [],
        }, req);
        return true;
      }

      if (p === 'modes') {
        const net = state.store ? state.store.get('weekday') : null;
        sendJson(res, 200, { modes: net ? net.modes : [] }, req);
        return true;
      }

      if (p === 'isochrone') {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' });
          res.end();
          return true;
        }
        const body = await readBody(req);
        sendJson(res, 200, computeIsochrone(parseRequest(body)), req);
        return true;
      }

      return false;
    } catch (err) {
      if (!(err instanceof ApiError)) {
        console.error('[marlin] request failed:', err && err.stack);
      }
      sendError(res, err, req);
      return true;
    }
  },

  // Exposed for projects/marlin/test.mjs.
  _internals: { parseRequest, computeIsochrone, state, ApiError, formatHHMM, ERRORS },
};
