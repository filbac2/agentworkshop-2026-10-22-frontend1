const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA = path.join(__dirname, 'artifacts');
const DAY_TYPES = ['weekday', 'saturday', 'sunday'];
const cache = {};
const conns = {};
let shapes = null;

function loadShapes() {
  if (!shapes) shapes = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'shapes.json.gz'))));
  return shapes;
}

let routeDays = null;
function loadRouteDays() {
  if (!routeDays) {
    routeDays = new Map();
    for (const d of DAY_TYPES) {
      const c = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, `connections-${d}.json.gz`))));
      for (const r of c.routes) {
        const k = r.mode + '|' + r.name;
        if (!routeDays.has(k)) routeDays.set(k, []);
        routeDays.get(k).push(d);
      }
    }
  }
  return routeDays;
}

const tripEnds = {};
function loadDepartures(type) {
  if (!tripEnds[type]) {
    const c = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, `connections-${type}.json.gz`))));
    const last = new Map();
    for (let i = 0; i < c.from.length; i++) last.set(c.trip[i], c.to[i]);
    tripEnds[type] = { c, last };
  }
  return tripEnds[type];
}

const hhmm = (s) => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');

function stockholmNowSec() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return Number(p.find((x) => x.type === 'hour').value) * 3600 + Number(p.find((x) => x.type === 'minute').value) * 60;
}

function load(type) {
  if (!cache[type]) {
    const gz = fs.readFileSync(path.join(DATA, `network-${type}.json.gz`));
    cache[type] = { gz, net: JSON.parse(zlib.gunzipSync(gz)) };
  }
  return cache[type];
}

function dayTypeOf(q) {
  if (q.get('day') && DAY_TYPES.includes(q.get('day'))) return q.get('day');
  const d = new Date().getDay();
  return d === 0 ? 'sunday' : d === 6 ? 'saturday' : 'weekday';
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
  return true;
}

module.exports = {
  init() {
    DAY_TYPES.forEach(load);
  },
  async handle(req, res, ctx) {
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams;
    const p = ctx.path.replace(/^\/+|\/+$/g, '');

    if (q.has('day') && !DAY_TYPES.includes(q.get('day'))) {
      return json(res, 400, { error: 'day must be one of ' + DAY_TYPES.join(', ') });
    }

    if (p === 'network') {
      const { gz } = load(dayTypeOf(q));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=3600' });
      res.end(gz);
      return true;
    }
    if (p === 'connections') {
      const type = dayTypeOf(q);
      if (!conns[type]) conns[type] = fs.readFileSync(path.join(DATA, `connections-${type}.json.gz`));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=3600' });
      res.end(conns[type]);
      return true;
    }
    if (p === 'nearby') {
      const num = (k) => (q.get(k) === null || q.get(k).trim() === '' ? NaN : Number(q.get(k)));
      const lat = num('lat');
      const lon = num('lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { error: 'lat and lon are required numbers' });
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(res, 400, { error: 'lat must be within +-90 and lon within +-180 (lat first)' });
      const radius = Math.min(Math.max(Number(q.get('radius')) || 800, 50), 3000);
      const modes = (q.get('modes') || '').split(',').filter(Boolean);
      const { net } = load(dayTypeOf(q));
      const cosLat = Math.cos((lat * Math.PI) / 180);
      const out = [];
      net.stops.forEach((s, index) => {
        const distM = Math.round(Math.hypot((s.lat - lat) * 111320, (s.lon - lon) * 111320 * cosLat));
        if (distM > radius) return;
        if (modes.length && !s.modes.some((m) => modes.includes(m))) return;
        out.push({ index, id: s.id, name: s.name, modes: s.modes, distM, walkSec: Math.round(distM / 1.3) });
      });
      out.sort((a, b) => a.distM - b.distM);
      return json(res, 200, out.slice(0, 50));
    }
    if (p === 'departures') {
      const type = dayTypeOf(q);
      const { net } = load(type);
      const key = (q.get('stop') || '').trim();
      let idx = /^\d+$/.test(key) && Number(key) < net.stops.length ? Number(key) : net.stops.findIndex((s) => s.id === key);
      if (!key || idx < 0) return json(res, 400, { error: 'stop must be a station index or id from /stops or /nearby' });
      let from = stockholmNowSec();
      if (q.get('time')) {
        const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(q.get('time'));
        if (!m) return json(res, 400, { error: 'time must be HH:MM (00:00-23:59)' });
        from = Number(m[1]) * 3600 + Number(m[2]) * 60;
      }
      const limit = Math.min(Math.max(parseInt(q.get('limit'), 10) || 10, 1), 50);
      const modes = (q.get('modes') || '').split(',').filter(Boolean);
      const { c, last } = loadDepartures(type);
      const out = [];
      for (let i = c.offsets[idx]; i < c.offsets[idx + 1] && out.length < limit; i++) {
        if (c.dep[i] < from) continue;
        const r = c.routes[c.route[i]];
        if (modes.length && !modes.includes(r.mode)) continue;
        const end = last.get(c.trip[i]);
        out.push({ dep: hhmm(c.dep[i]), depSec: c.dep[i], route: r.name, mode: r.mode, to: net.stops[end].name, toIndex: end });
      }
      const s = net.stops[idx];
      return json(res, 200, { stop: { index: idx, id: s.id, name: s.name, modes: s.modes }, day: type, from: hhmm(from), departures: out });
    }
    if (p === 'service') {
      const type = dayTypeOf(q);
      const { net } = load(type);
      const key = (q.get('stop') || '').trim();
      const idx = /^\d+$/.test(key) && Number(key) < net.stops.length ? Number(key) : net.stops.findIndex((s) => s.id === key);
      if (!key || idx < 0) return json(res, 400, { error: 'stop must be a station index or id from /stops or /nearby' });
      const { c } = loadDepartures(type);
      const perHour = new Array(24).fill(0);
      const modes = {};
      for (let i = c.offsets[idx]; i < c.offsets[idx + 1]; i++) {
        const m = c.routes[c.route[i]].mode;
        const e = modes[m] || (modes[m] = { first: Infinity, last: -1, departures: 0 });
        e.first = Math.min(e.first, c.dep[i]);
        e.last = Math.max(e.last, c.dep[i]);
        e.departures++;
        perHour[Math.floor(c.dep[i] / 3600) % 24]++;
      }
      const out = {};
      for (const [m, e] of Object.entries(modes)) out[m] = { first: hhmm(e.first), last: hhmm(e.last), lastSec: e.last, departures: e.departures };
      const s = net.stops[idx];
      return json(res, 200, { stop: { index: idx, id: s.id, name: s.name }, day: type, modes: out, perHour, serviceAfterMidnight: Object.values(modes).some((e) => e.last >= 86400) });
    }
    if (p === 'frequency') {
      const type = dayTypeOf(q);
      const parse = (v, d) => {
        if (!v) return d;
        const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
        return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : NaN;
      };
      const from = parse(q.get('from'), 7 * 3600);
      const to = parse(q.get('to'), 9 * 3600);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return json(res, 400, { error: 'from and to must be HH:MM with to after from' });
      const { c } = loadDepartures(type);
      const { net } = load(type);
      const out = [];
      for (let s = 0; s < net.stops.length; s++) {
        let n = 0;
        for (let i = c.offsets[s]; i < c.offsets[s + 1]; i++) if (c.dep[i] >= from && c.dep[i] < to) n++;
        if (n) out.push({ index: s, departures: n, avgHeadwayMin: Math.round(((to - from) / 60 / n) * 10) / 10 });
      }
      return json(res, 200, { day: type, from: hhmm(from), to: hhmm(to), stops: out });
    }
    if (p === 'routes') {
      const { routes } = loadShapes();
      const rd = loadRouteDays();
      let list = routes.map((r) => ({ name: r.name, mode: r.mode, lines: r.lines.length, days: rd.get(r.mode + '|' + r.name) || [] }));
      const modes = (q.get('modes') || '').split(',').filter(Boolean);
      if (modes.length) list = list.filter((r) => modes.includes(r.mode));
      return json(res, 200, list);
    }
    if (p.startsWith('shape/')) {
      const [, mode, ...rest] = p.split('/');
      const name = decodeURIComponent(rest.join('/'));
      const r = loadShapes().routes.find((x) => x.mode === mode && x.name === name);
      if (!r) return json(res, 404, { error: 'unknown route' });
      return json(res, 200, { type: 'Feature', properties: { name: r.name, mode: r.mode }, geometry: { type: 'MultiLineString', coordinates: r.lines } });
    }
    if (p === 'tasks') {
      try {
        const body = fs.readFileSync(path.join(__dirname, 'tasks.json'), 'utf8');
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(body);
      } catch {
        return json(res, 200, { updated: null, tasks: [] });
      }
    }
    if (p === 'meta') {
      const out = {};
      for (const t of DAY_TYPES) {
        const { net } = load(t);
        out[t] = { date: net.date, generated: net.generated, stopCount: net.stops.length, tripCount: net.trips.length };
      }
      try {
        out.feed = JSON.parse(fs.readFileSync(path.join(DATA, 'feed.json'), 'utf8'));
      } catch {
        out.feed = null;
      }
      return json(res, 200, out);
    }
    if (p === 'stops') {
      const { net } = load(dayTypeOf(q));
      let list = net.stops.map((s, i) => ({ index: i, ...s }));
      const bbox = (q.get('bbox') || '').split(',').map(Number);
      if (bbox.length === 4 && bbox.every(Number.isFinite)) {
        const [minLon, minLat, maxLon, maxLat] = bbox;
        list = list.filter((s) => s.lon >= minLon && s.lon <= maxLon && s.lat >= minLat && s.lat <= maxLat);
      }
      const modes = (q.get('modes') || '').split(',').filter(Boolean);
      if (modes.length) list = list.filter((s) => s.modes.some((m) => modes.includes(m)));
      return json(res, 200, list);
    }
    return false;
  },
};
