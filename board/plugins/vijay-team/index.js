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
    if (p === 'routes') {
      const { routes } = loadShapes();
      let list = routes.map((r) => ({ name: r.name, mode: r.mode, lines: r.lines.length }));
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
