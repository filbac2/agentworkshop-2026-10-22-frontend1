'use strict';

// Downloads walkable OSM ways for central Stockholm from Overpass, in tiles, into OUT_DIR.
// Run: node fetch-osm.js /tmp/osm
// Data (c) OpenStreetMap contributors, ODbL.

const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || '/tmp/osm';
const BBOX = { south: 59.22, north: 59.44, west: 17.90, east: 18.22 };
const ROWS = 4, COLS = 4;
const URLS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const WORKERS = 3;
const HIGHWAYS = 'footway|path|pedestrian|steps|residential|living_street|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|cycleway|track|road';

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(s, w, n, e, file, worker) {
  const q = '[out:json][timeout:180];(way["highway"~"^(' + HIGHWAYS + ')$"]["foot"!~"^no$"]["access"!~"^(private|no)$"](' +
    [s, w, n, e].join(',') + ');>;);out skel qt;';
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = URLS[(attempt + worker) % URLS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(150000),
        headers: { 'User-Agent': 'agentworkshop-mareri-street-graph/1.0', 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      JSON.parse(text);
      fs.writeFileSync(file, text);
      return;
    } catch (err) {
      console.error('tile retry', attempt, url.split('/')[2], err.message);
      await sleep(3000 * Math.min(attempt + 1, 5));
    }
  }
  throw new Error('tile failed: ' + file);
}

(async () => {
  const dLat = (BBOX.north - BBOX.south) / ROWS;
  const dLon = (BBOX.east - BBOX.west) / COLS;
  const queue = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const file = path.join(OUT, 'tile-' + r + '-' + c + '.json');
      if (!fs.existsSync(file)) queue.push({ r, c, file });
    }
  }
  const run = async (worker) => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const s = BBOX.south + job.r * dLat, w = BBOX.west + job.c * dLon;
      await fetchTile(s.toFixed(5), w.toFixed(5), (s + dLat).toFixed(5), (w + dLon).toFixed(5), job.file, worker);
      console.log('ok', job.file, (fs.statSync(job.file).size / 1e6).toFixed(1) + ' MB');
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => run(i)));
  console.log('all tiles done');
})();
