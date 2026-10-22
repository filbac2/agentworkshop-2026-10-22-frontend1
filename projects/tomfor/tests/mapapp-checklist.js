// Static + live checklist for a map app tile against the PROJEKT.md requirements. No dependencies.
// Run: node tests/mapapp-checklist.js /colony/filbac/ [/colony/mareri/ ...] [--base URL] [--out file.md]
// One tile gives a table with evidence; several tiles give a side-by-side table.
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const BASE = opt('--base', 'https://frontend1.torget.bjarby.com');
const OUT = opt('--out', null);
const TILES = args.length ? args : ['/colony/filbac/'];
const MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];
const ENGINE = '/t/marlin/isochrone';

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'tomfor-mapapp-checklist' } });
  return { status: res.status, text: await res.text() };
}

// Fetch the HTML, every same-origin script/stylesheet and every JS module it imports (static or dynamic).
async function load(tile) {
  const root = new URL(tile, BASE);
  const html = await get(root.href);
  const files = { [root.pathname]: html.text };
  const external = [];
  if (html.status !== 200) return { status: html.status, html: '', js: '', css: '', files, external };
  const queue = [];
  for (const m of html.text.matchAll(/<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) queue.push(m[1]);
  for (const m of html.text.matchAll(/<link[^>]*\bhref=["']([^"']+\.css[^"']*)["'][^>]*>/gi)) queue.push(m[1]);
  let inline = '';
  for (const m of html.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) inline += m[1] + '\n';
  const seen = new Set();
  const enqueueImports = (text, from) => {
    const re = /(?:import\s*(?:[\w*{}\s,$]+\s*from\s*)?|import\s*\(\s*|export\s*[\w*{}\s,$]*\s*from\s*)["']([^"']+)["']/g;
    for (const m of text.matchAll(re)) queue.push(new URL(m[1], from).href);
  };
  enqueueImports(inline, root.href);
  let js = inline, css = '';
  while (queue.length) {
    const u = new URL(queue.shift(), root);
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    if (u.origin !== root.origin) { external.push(u.href); continue; }
    const r = await get(u.href);
    files[u.pathname] = r.status === 200 ? r.text : `/* ${r.status} */`;
    if (r.status !== 200) continue;
    if (/\.css(\?|$)/.test(u.pathname)) css += r.text + '\n';
    else { js += r.text + '\n'; enqueueImports(r.text, u.href); }
  }
  return { status: 200, html: html.text, js, css, files, external };
}

const grade = (hits, total) => (hits === total ? 'pass' : hits > 0 ? 'partial' : 'fail');
const has = (re, s) => re.test(s);

function staticChecks(a) {
  const all = a.html + '\n' + a.js;
  const ext = a.external.join(' ');
  const r = [];
  const add = (item, parts) => {
    const hits = parts.filter((p) => p[1]).length;
    r.push({ item, result: grade(hits, parts.length), evidence: parts.map((p) => `${p[1] ? '+' : '-'}${p[0]}`).join(', ') });
  };
  add('OSM tiles + Leaflet', [
    ['leaflet loaded', /leaflet/i.test(ext + all)],
    ['L.map', has(/\bL\.map\(|new\s+maplibregl|leaflet/i, a.js)],
    ['tile.openstreetmap.org', has(/tile\.openstreetmap\.org/, all)],
  ]);
  add('Pin / origin', [
    ['marker', has(/L\.marker|Marker\(/, a.js)],
    ['set on map click/tap', has(/\.on\(\s*["'](click|contextmenu|tap)["']/, a.js)],
    ['movable (draggable)', has(/draggable\s*:\s*true|dragend/, a.js)],
  ]);
  add('Start time, default now', [
    ['time input', has(/datetime-local|type\s*[:=]\s*["']time["']/, all)],
    ['defaults to new Date()', has(/new Date\(\)|Date\.now\(\)/, a.js)],
  ]);
  add('Max travel 5-120 step 5, default 30', [
    ['range 5..120 step 5', has(/\b5\s*,\s*120\s*,\s*5\b|min\s*[:=]\s*["']?5["']?[\s\S]{0,60}max\s*[:=]\s*["']?120["']?[\s\S]{0,60}step\s*[:=]\s*["']?5\b|value\s*=\s*\{?\s*["']?5["']?.*120|=\s*5\s*;\s*\w+\s*<=\s*120\s*;\s*\w+\s*\+=\s*5/, all)],
    ['default 30', has(/maxTravel\w*["']?\s*[:=]\s*["']?30\b|===\s*30\)\s*\w+\.selected\s*=\s*true/i, all)],
  ]);
  add('Max wait, default 7', [
    ['wait control', has(/maxWait/i, all)],
    ['default 7', has(/maxWait\w*["']?\s*[:=]\s*["']?7\b|id=["']max-wait["'][^>]*value=["']7["']/i, all)],
  ]);
  add('Walking configs (to destination + between stations)', [
    ['walk to destination / egress', has(/egress|toDestination|walkTo|accessMinutes/i, all)],
    ['walk between stations / transfer', has(/transferMinutes|betweenStation|walkBetween|transferWalk/i, all)],
  ]);
  add('Modes (bus, metro, tram, train, commuter_rail, boat)', MODES.map((m) => [m, new RegExp(`["']${m}["']`).test(all)]));
  add('Max transfers, default 3', [
    ['transfers control', has(/maxTransfers/, all)],
    ['default 3', has(/maxTransfers["']?\s*[:=]\s*["']?3\b|id=["']max-transfers["'][^>]*value=["']3["']/, all)],
  ]);
  add('Update button', [
    ['"Update" label', has(/["'>]\s*Update\s*["'<]/, all)],
    ['"Uppdatera" label', has(/Uppdatera/, all)],
  ]);
  add('5-min band legend', [
    ['legend', has(/legend/i, all + a.css)],
    ['5-min bands', has(/band\w*\s*[:=]\s*5\b|\*\s*5\b|bandMinutes/i, all)],
  ]);
  add('EN / SV', [
    ['en strings', has(/\ben\s*:\s*\{/, all)],
    ['sv strings', has(/\bsv\s*:\s*\{/, all)],
    ['language switch', has(/Svenska|["']sv["']/, all)],
  ]);
  add('Mobile viewport + touch-friendly', [
    ['viewport meta', has(/<meta[^>]+name=["']viewport["'][^>]+width=device-width/i, a.html)],
    ['@media query', has(/@media/, a.css + a.html)],
    ['touch targets >=44px', has(/min-height\s*:\s*(4[4-9]|[5-9]\d)px/, a.css + a.html)],
  ]);
  const tomforErr = Object.keys(a.files).some((p) => /\/colony\/tomfor\/errors\.js$/.test(p)) || /colony\/tomfor\/errors\.js/.test(all);
  const eq = [
    ['HTTP error (!res.ok)', has(/!\s*res\.ok|\.status\s*(>=|!==)/, a.js)],
    ['bilingual server message', has(/message_sv/, a.js)],
    ['network/timeout', has(/AbortError|onLine|timeout/i, a.js)],
    ['no routes', has(/no_routes|noRoutes|nothing_reachable/i, all)],
    ['too restrictive', has(/too_restrictive|TooStrict|restrictive/i, all)],
  ];
  if (tomforErr) r.push({ item: 'Error handling', result: 'pass', evidence: 'imports /colony/tomfor/errors.js' });
  else {
    const hits = eq.filter((p) => p[1]).length;
    r.push({ item: 'Error handling', result: hits === eq.length ? 'pass' : grade(hits, eq.length), evidence: 'no tomfor errors.js; equivalent: ' + eq.map((p) => `${p[1] ? '+' : '-'}${p[0]}`).join(', ') });
  }
  add('Calls /t/marlin/isochrone', [['endpoint in code', a.js.includes(ENGINE)], ['POST', has(/method\s*:\s*["']POST["']/i, a.js)]]);
  return r;
}

function isoNow() {
  const d = new Date(), off = -d.getTimezoneOffset(), p = (n) => String(Math.abs(n)).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

// Replays the default request an app sends on first Update, 3 times, and times it.
async function replay() {
  const body = {
    origin: { lat: 59.3293, lon: 18.0686 }, startTime: isoNow(), maxTravelMinutes: 30, maxWaitMinutes: 7, maxTransfers: 3,
    modes: MODES, walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }, bandMinutes: 5,
  };
  const runs = [];
  let last;
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    const res = await fetch(BASE + ENGINE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    runs.push(Date.now() - t);
    let j; try { j = JSON.parse(text); } catch {}
    last = { status: res.status, j };
  }
  const f = last.j?.features || [];
  const bands = f.length === 6 && f.every((x) => x.properties.toMinutes - x.properties.fromMinutes === 5);
  const worst = Math.max(...runs);
  const result = last.status !== 200 ? 'fail' : bands && worst < 2000 ? 'pass' : worst < 5000 ? 'partial' : 'fail';
  return { item: 'Live default request to marlin (<2 s)', result, evidence: `status ${last.status}, ${f.length} bands${bands ? ' x 5 min' : ''}, stopsReached ${last.j?.meta?.stopsReached}, ms ${runs.join('/')}` };
}

const ICON = { pass: 'pass', partial: 'PARTIAL', fail: 'FAIL', n_a: 'n/a' };

(async () => {
  const results = [];
  for (const tile of TILES) {
    const a = await load(tile);
    const rows = a.status === 200 ? staticChecks(a) : [{ item: 'Tile reachable', result: 'fail', evidence: `HTTP ${a.status}` }];
    results.push({ tile, rows, files: Object.keys(a.files), external: a.external });
  }
  const live = await replay();
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  let md = `# Map app checklist (${when}, ${BASE})\n\n`;
  if (results.length === 1) {
    const { tile, rows, files, external } = results[0];
    md += `Tile: ${tile}\n\nFetched: ${files.join(', ')}\nExternal: ${external.join(', ') || 'none'}\n\n| # | Requirement | Result | Evidence |\n|---|---|---|---|\n`;
    [...rows, live].forEach((x, i) => (md += `| ${i + 1} | ${x.item} | ${ICON[x.result]} | ${x.evidence} |\n`));
    const all = [...rows, live];
    md += `\nTotal: ${all.filter((x) => x.result === 'pass').length} pass, ${all.filter((x) => x.result === 'partial').length} partial, ${all.filter((x) => x.result === 'fail').length} fail of ${all.length}\n`;
  } else {
    md += `| Requirement | ${results.map((r) => r.tile).join(' | ')} |\n|---|${results.map(() => '---').join('|')}|\n`;
    const items = [...new Set(results.flatMap((r) => r.rows.map((x) => x.item)))];
    for (const it of items) md += `| ${it} | ${results.map((r) => { const x = r.rows.find((y) => y.item === it); return x ? `${ICON[x.result]}: ${x.evidence}` : 'n/a'; }).join(' | ')} |\n`;
    md += `| ${live.item} (shared engine) | ${results.map(() => `${ICON[live.result]}: ${live.evidence}`).join(' | ')} |\n`;
  }
  console.log(md);
  if (OUT) require('fs').writeFileSync(OUT, md);
})().catch((e) => { console.error(e); process.exit(1); });
