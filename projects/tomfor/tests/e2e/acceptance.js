// Group acceptance test: walks every requirement in PROJEKT.md on the ONE map app (/colony/mareri/)
// in headless Chromium at 390px touch phone and 1280px desktop.
// Run: PLAYWRIGHT_BROWSERS_PATH=.pw-browsers node tests/e2e/acceptance.js   (npm run e2e:acceptance)
// Writes tests/e2e/acceptance-run.json and screenshots to tests/screenshots/acc-*.png.
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const APP = process.env.APP || '/colony/mareri/';
const SHOTS = path.join(__dirname, '..', 'screenshots');
const OUT = path.join(__dirname, 'acceptance-run.json');
const T_CENTRALEN = [59.3313, 18.0593];
const WATER = [59.27, 18.62];
const STHLM = [59.3293, 18.0686];

const results = {}; // id -> { phone: {...}, desktop: {...} }
const rec = (id, dev, status, evidence) => {
  (results[id] = results[id] || {})[dev] = { status, evidence };
  console.log(`[${dev}] ${id}: ${status} - ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
};
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const shot = async (page, name) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200); return page.screenshot({ path: path.join(SHOTS, `acc-${name}.png`) }); };

const mapState = page => page.evaluate(() => {
  const m = window.__e2eMap; const c = m.getCenter();
  return { lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4), zoom: m.getZoom() };
});
const pinLatLng = page => page.evaluate(() => {
  let ll = null; window.__e2eMap.eachLayer(l => { if (l.getLatLng && l.options && l.options.draggable) ll = l.getLatLng(); });
  return ll && [+ll.lat.toFixed(4), +ll.lng.toFixed(4)];
});
const statusText = page => page.locator('#status').innerText().catch(() => '');
const statusIsError = page => page.evaluate(() => document.getElementById('status').className.includes('error'));

// A free point on the visible map (not under the panel/sheet or a control).
const freeMapPoint = page => page.evaluate(() => {
  const m = window.__e2eMap; const c = m.getContainer().getBoundingClientRect();
  for (const fy of [0.15, 0.25, 0.35, 0.1]) for (const fx of [0.5, 0.7, 0.3, 0.85]) {
    const x = c.left + c.width * fx, y = c.top + c.height * fy;
    const el = document.elementFromPoint(x, y);
    if (el && (el.classList.contains('leaflet-tile') || el.classList.contains('leaflet-container'))) return { x, y };
  }
  return null;
});

async function touchDrag(cdp, from, to, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await new Promise(r => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function pinch(cdp, center, d0, d1, steps = 8) {
  const pts = d => [{ x: center.x - d, y: center.y, id: 0 }, { x: center.x + d, y: center.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / steps) });
    await new Promise(r => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function openSheet(page) {
  // Phone: the settings sheet collapses after a successful Update; reopen before touching controls.
  const collapsed = await page.evaluate(() => document.getElementById('panel').classList.contains('collapsed'));
  if (collapsed) { await page.locator('#sheet-toggle').tap(); await page.waitForTimeout(350); }
}
async function setNumber(page, id, v) { await page.locator('#' + id).fill(String(v)); }
async function setRange(page, id, v) {
  await page.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
}
async function setModes(page, dev, want) { // want: array of mode values that should be checked
  for (const cb of await page.locator('#modes input[type=checkbox]').all()) {
    const v = await cb.getAttribute('value');
    if ((await cb.isChecked()) !== want.includes(v)) {
      const lbl = cb.locator('xpath=ancestor::label[1]');
      const tgt = (await lbl.count()) ? lbl : cb;
      dev === 'phone' ? await tgt.tap() : await tgt.click();
    }
  }
}
async function submit(page, dev) {
  await openSheet(page);
  const btn = page.locator('#update');
  await btn.scrollIntoViewIfNeeded();
  dev === 'phone' ? await btn.tap() : await btn.click();
}
// Submit and wait until the status line settles (not "calculating").
async function submitAndSettle(page, dev, ms = 20000) {
  await submit(page, dev);
  await page.waitForFunction(() => { const b = document.getElementById('update'); return !b.disabled; }, null, { timeout: ms }).catch(() => {});
  await page.waitForTimeout(300);
  const inView = await page.evaluate(() => { const r = document.getElementById('status').getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; });
  return { status: (await statusText(page)).trim(), isError: await statusIsError(page), inView, layers: await H.overlayCount(page) };
}

async function runDevice(browser, dev) {
  const { ctx, page, log } = await H.openApp(browser, APP, dev);
  const cdp = dev === 'phone' ? await ctx.newCDPSession(page) : null;
  const bodies = [];
  const metas = []; const hosts = new Set();
  page.on('request', r => hosts.add(new URL(r.url()).host));
  page.on('response', async r => { if (r.url().includes('/t/marlin/isochrone') && r.status() === 200) { try { const j = await r.json(); metas.push(j.meta || {}); } catch (e) {} } });
  page.on('request', r => { if (r.url().includes('/t/marlin/isochrone') && r.method() === 'POST') { try { bodies.push(JSON.parse(r.postData())); } catch (e) {} } });
  await page.evaluate(() => localStorage.setItem('lang', 'en'));
  await page.reload({ waitUntil: 'networkidle' });
  if (!(await H.hasMap(page))) { rec('R1 map', dev, 'FAIL', 'Leaflet map instance not found'); return { log }; }
  const loadedAt = Date.now();

  // R1 Map: OSM tiles, Stockholm centre, pan and zoom.
  {
    const tiles = await page.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].filter(i => i.complete && i.naturalWidth > 0).map(i => new URL(i.src).host));
    const osm = tiles.filter(h => h.endsWith('openstreetmap.org')).length;
    const s0 = await mapState(page);
    const dist = Math.hypot(s0.lat - STHLM[0], s0.lon - STHLM[1]);
    const p = await freeMapPoint(page);
    let panned = false, zoomed = false, zEv = '';
    if (p) {
      if (dev === 'phone') await touchDrag(cdp, p, { x: p.x - 120, y: p.y + 60 });
      else { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x - 120, p.y + 60, { steps: 8 }); await page.mouse.up(); }
      await page.waitForTimeout(500);
      const s1 = await mapState(page);
      panned = s1.lat !== s0.lat || s1.lon !== s0.lon;
      if (dev === 'phone') await pinch(cdp, p, 40, 140);
      else { await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -500); }
      await page.waitForTimeout(900);
      const s2 = await mapState(page);
      zoomed = s2.zoom > s1.zoom;
      zEv = `${dev === 'phone' ? 'pinch' : 'wheel'} zoom ${s1.zoom}->${s2.zoom}`;
      // zoom control buttons too
      const zin = page.locator('.leaflet-control-zoom-out');
      dev === 'phone' ? await zin.tap() : await zin.click();
      await page.waitForTimeout(500);
      zEv += `, zoom-out button ->${(await mapState(page)).zoom}`;
    }
    const ok = osm > 0 && dist < 0.05 && panned && zoomed;
    rec('R1 map', dev, ok ? 'PASS' : (osm > 0 ? 'PARTIAL' : 'FAIL'),
      `${osm}/${tiles.length} loaded tiles from tile.openstreetmap.org; start centre ${s0.lat},${s0.lon} z${s0.zoom}; ${dev === 'phone' ? 'touch' : 'mouse'} drag pan ${panned ? 'moved map' : 'did NOT move'}; ${zEv}`);
    await page.evaluate(([lat, lon]) => window.__e2eMap.setView([lat, lon], 12, { animate: false }), T_CENTRALEN);
  }

  // R2 Origin: tap/click sets pin, drag moves it, coordinates shown and sent.
  {
    const set = await H.placePin(page, dev, T_CENTRALEN);
    const out1 = (await page.locator('#origin-out').innerText()).trim();
    let dragEv = 'no drag';
    const m = page.locator('.leaflet-marker-icon').first();
    const bb = await m.boundingBox();
    if (bb) {
      const from = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
      const to = { x: from.x + 70, y: from.y - 50 };
      const before = await pinLatLng(page);
      if (dev === 'phone') await touchDrag(cdp, from, to, 12);
      else { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); }
      await page.waitForTimeout(500);
      const after = await pinLatLng(page);
      const out2 = (await page.locator('#origin-out').innerText()).trim();
      const moved = before && after && (before[0] !== after[0] || before[1] !== after[1]);
      dragEv = `drag pin ${moved ? 'moved' : 'did NOT move'} ${before} -> ${after}, origin text "${out2}"`;
      results._dragMoved = results._dragMoved || {}; results._dragMoved[dev] = moved;
    }
    // put pin back at T-Centralen for the calculations
    await H.placePin(page, dev, T_CENTRALEN);
    const ok = set.ok && results._dragMoved && results._dragMoved[dev];
    rec('R2 origin pin', dev, ok ? 'PASS' : set.ok ? 'PARTIAL' : 'FAIL',
      `${dev === 'phone' ? 'tap' : 'click'} sets pin at ${set.marker}${set.panned ? ' (map panned first, sheet covered target)' : ''}, origin text "${out1}"; ${dragEv}`);
  }

  // R3..R8 defaults and ranges (read from the DOM, before any change).
  await openSheet(page);
  {
    const v = await page.locator('#start-time').inputValue();
    const diffMin = Math.abs(new Date(v).getTime() - loadedAt) / 60000;
    rec('R3 start time default now', dev, diffMin <= 2 ? 'PASS' : 'FAIL', `datetime-local value ${v}, ${diffMin.toFixed(1)} min from page load (browser TZ ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  }
  {
    const a = await page.locator('#max-travel').evaluate(e => ({ type: e.type, min: e.min, max: e.max, step: e.step, value: e.value }));
    await setRange(page, 'max-travel', 33); const snap = await page.locator('#max-travel').inputValue();
    await setRange(page, 'max-travel', 500); const top = await page.locator('#max-travel').inputValue();
    const label = (await page.locator('#travel-out').innerText()).trim();
    await setRange(page, 'max-travel', 30);
    const ok = a.min === '5' && a.max === '120' && a.step === '5' && a.value === '30' && snap % 5 === 0 && top === '120';
    rec('R4 max travel 5-120 step 5 default 30', dev, ok ? 'PASS' : 'FAIL', `range min ${a.min} max ${a.max} step ${a.step} default ${a.value}; 33 snaps to ${snap}, 500 clamps to ${top}; label "${label}" at 120`);
  }
  {
    const a = await page.locator('#max-wait').evaluate(e => ({ min: e.min, max: e.max, value: e.value }));
    rec('R5 max wait default 7', dev, a.value === '7' ? 'PASS' : 'FAIL', `number input default ${a.value}, range ${a.min}-${a.max}`);
  }
  {
    const a = await page.locator('#max-transfers').evaluate(e => ({ min: e.min, max: e.max, value: e.value }));
    rec('R8 max transfers default 3', dev, a.value === '3' ? 'PASS' : 'FAIL', `number input default ${a.value}, range ${a.min}-${a.max}`);
  }
  const modeVals = await page.locator('#modes input[type=checkbox]').evaluateAll(es => es.map(e => ({ v: e.value, on: e.checked, label: (e.closest('label') || {}).innerText })));

  // R9/R10/R11 first Update with defaults: request body, bands, legend, timing.
  const nBefore = bodies.length;
  const first = await H.clickUpdate(page, dev);
  const b0 = bodies[nBefore];
  const legend1 = await page.evaluate(() => {
    const e = document.getElementById('legend'); const r = e.getBoundingClientRect();
    const segs = [...e.querySelectorAll('.legend-bar > *')].map(s => ({ title: s.title, bg: getComputedStyle(s).backgroundColor }));
    return { shown: !e.hidden && r.height > 0, inView: r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top), vh: innerHeight,
      scale: [...e.querySelectorAll('.legend-scale > *')].map(s => s.innerText.trim()), segs };
  });
  const colours = legend1.segs.map(s => s.bg);
  const doneText = (await statusText(page)).trim();
  if (dev === 'phone') await shot(page, 'phone-result');

  {
    const ok = b0 && b0.walking && b0.walking.egressMinutes === 10 && b0.walking.transferMinutes === 5;
    // change walking settings and confirm they are sent
    await openSheet(page);
    await setNumber(page, 'walk-dest', 6); await setNumber(page, 'walk-transfer', 3);
    var walkChange = { n: bodies.length };
    rec('R6 walking settings', dev, ok ? 'PASS' : 'FAIL',
      `fields "Walk to destination (min)" default 10 and "Walk between stops (min)" default 5; request walking ${JSON.stringify(b0 && b0.walking)}`);
  }

  // R9 Update recalculates: change travel 30->15, uncheck bus, new walking; expect a new request with those values and fewer bands.
  {
    await setRange(page, 'max-travel', 15);
    await setModes(page, dev, modeVals.map(m => m.v).filter(v => v !== 'bus'));
    const r2 = await H.clickUpdate(page, dev);
    const b1 = bodies[walkChange.n];
    const ok = b1 && b1.maxTravelMinutes === 15 && !b1.modes.includes('bus') && b1.walking.egressMinutes === 6 && b1.walking.transferMinutes === 3 && r2.rendered && r2.layers < first.layers;
    rec('R9 Update recalculates', dev, ok ? 'PASS' : 'FAIL',
      `1st Update: ${first.status}, ${first.layers} band layers; changed to 15 min, no bus, walk 6/3 -> new POST maxTravelMinutes ${b1 && b1.maxTravelMinutes}, modes ${b1 && b1.modes.join('+')}, walking ${b1 && JSON.stringify(b1.walking)} -> ${r2.status}, ${r2.layers} band layers`);
    rec('R7 transport type filters', dev, modeVals.length >= 6 && b1 && !b1.modes.includes('bus') ? 'PASS' : 'FAIL',
      `${modeVals.length} checkboxes (${modeVals.map(m => m.v + (m.on ? '' : ' off')).join(', ')}), all on by default; unchecking bus removes it from the request`);
    // restore defaults
    await openSheet(page);
    await setRange(page, 'max-travel', 30); await setModes(page, dev, modeVals.map(m => m.v));
    await setNumber(page, 'walk-dest', 10); await setNumber(page, 'walk-transfer', 5);
  }

  // R10 bands + legend
  {
    const titles = legend1.segs.map(s => s.title);
    const has = ['0–5', '5–10', '10–15', '15–20', '20–25', '25–30'].every(r => titles.some(t => t.startsWith(r)));
    const distinct = new Set(colours).size;
    const ok = legend1.shown && has && distinct >= 6;
    rec('R10 5-min bands + legend', dev, ok && legend1.inView ? 'PASS' : ok ? 'PARTIAL' : 'FAIL',
      `30 min -> ${first.layers} overlay layers (6 bands${first.layers > 6 ? ' + walk outline' : ''}); legend ${legend1.segs.length} segments, ${distinct} distinct colours, per-band ranges only as title tooltips (${titles.join(', ')}), visible scale ${legend1.scale.join('/')}; legend ${legend1.inView ? 'in view' : `NOT in view without scrolling the panel (top ${legend1.top} px, viewport ${legend1.vh})`}`);
  }

  // R11 Performance: click -> overlay drawn. Desktop median of 3, phone 1 run (first was above).
  {
    const runs = [first.renderMs];
    if (dev === 'desktop') {
      for (let i = 0; i < 2; i++) { await page.waitForTimeout(400); runs.push((await H.clickUpdate(page, dev)).renderMs); }
      await setRange(page, 'max-travel', 60);
      var r60 = await H.clickUpdate(page, dev);
      await setRange(page, 'max-travel', 30);
      await H.clickUpdate(page, dev);
      await shot(page, 'desktop-result');
    }
    const ms = runs.filter(x => x != null);
    const med = ms.length ? median(ms) : null;
    rec('R11 render within a couple of seconds', dev, med != null && med < 2000 ? 'PASS' : 'FAIL',
      `click->overlay at 30 min: ${ms.join(' / ')} ms${dev === 'desktop' ? ` (median ${med}); 60 min: ${r60.renderMs} ms, ${r60.layers} bands` : ''}; status line "${doneText}"`);
  }

  // R15 EN/SV
  {
    await openSheet(page);
    const sv = await H.switchLang(page, dev, 'SV');
    const svTexts = await page.evaluate(() => ({
      start: document.querySelector('[data-i18n=startTime]').innerText, travel: document.querySelector('[data-i18n=maxTravel]').innerText,
      modes: document.querySelector('[data-i18n=modes]').innerText, legend: (document.getElementById('legend').innerText || '').split('\n')[0],
      chips: [...document.querySelectorAll('#modes label')].map(l => l.innerText.trim()).join('/'), title: document.title,
    }));
    if (dev === 'phone') await shot(page, 'phone-sv');
    const en = await H.switchLang(page, dev, 'EN');
    // persists across reload?
    await H.switchLang(page, dev, 'SV');
    await page.reload({ waitUntil: 'networkidle' });
    const persisted = await page.evaluate(() => document.documentElement.lang);
    await page.evaluate(() => localStorage.setItem('lang', 'en'));
    await page.reload({ waitUntil: 'networkidle' });
    await H.placePin(page, dev, T_CENTRALEN);
    rec('R15 English and Swedish', dev, sv.ok && en.ok ? 'PASS' : 'FAIL',
      `SV: button "${sv.updateLabel}", html lang ${sv.htmlLang}, "${svTexts.start}", "${svTexts.travel}", "${svTexts.modes}", modes ${svTexts.chips}, legend "${svTexts.legend}"; back to EN: "${en.updateLabel}"; SV kept after reload: ${persisted === 'sv'}`);
  }

  // R16 errors
  const errs = {};
  {
    // a) API failure: block /t/marlin with route interception (network abort), then a 503, then a 500 with a body.
    await page.route('**/t/marlin/**', r => r.abort('failed'));
    errs.abort = await submitAndSettle(page, dev);
    if (dev === 'desktop') await shot(page, 'desktop-api-blocked');
    await page.unroute('**/t/marlin/**');
    await page.route('**/t/marlin/isochrone', r => r.fulfill({ status: 503, contentType: 'text/html', body: '<h1>503</h1>' }));
    errs.s503 = await submitAndSettle(page, dev);
    await page.unroute('**/t/marlin/isochrone');
    await page.route('**/t/marlin/isochrone', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal"}' }));
    errs.s500 = await submitAndSettle(page, dev);
    await page.unroute('**/t/marlin/isochrone');
    // b) no routes: engine answers 200 with no reachable area (mocked), and the real engine with the pin in open water.
    await page.route('**/t/marlin/isochrone', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [], meta: { stopsReached: 0 } }) }));
    errs.empty = await submitAndSettle(page, dev);
    await page.unroute('**/t/marlin/isochrone');
    await page.evaluate(([lat, lon]) => window.__e2eMap.setView([lat, lon], 12, { animate: false }), WATER);
    await H.placePin(page, dev, WATER);
    errs.water = await submitAndSettle(page, dev);
    if (dev === 'phone') await shot(page, 'phone-no-routes');
    // c) too restrictive: real engine, T-Centralen, 5 min, 0 wait, 0 transfers, boat only, walk 0/0.
    await page.evaluate(([lat, lon]) => window.__e2eMap.setView([lat, lon], 12, { animate: false }), T_CENTRALEN);
    await H.placePin(page, dev, T_CENTRALEN);
    await openSheet(page);
    await setRange(page, 'max-travel', 5); await setNumber(page, 'max-wait', 0); await setNumber(page, 'max-transfers', 0);
    await setNumber(page, 'walk-dest', 0); await setNumber(page, 'walk-transfer', 0);
    await setModes(page, dev, ['boat']);
    errs.restrictive = await submitAndSettle(page, dev);
    if (dev === 'desktop') await shot(page, 'desktop-too-restrictive');
    // same, but default walking 10/5: engine still finds stops by walking
    await openSheet(page);
    await setNumber(page, 'walk-dest', 10); await setNumber(page, 'walk-transfer', 5);
    errs.restrictiveWalk = await submitAndSettle(page, dev);
    // d) client validation: all modes off, max wait out of range.
    await openSheet(page);
    await setModes(page, dev, []);
    errs.noModes = await submitAndSettle(page, dev);
    await setModes(page, dev, modeVals.map(m => m.v));
    await setNumber(page, 'max-wait', 999);
    errs.badNumber = await submitAndSettle(page, dev);
    const s = x => `"${x.status}"${x.isError ? '' : ' (not styled as error)'}${x.inView ? '' : ' [message NOT in view without scrolling]'}${x.layers ? `, ${x.layers} old band layers still on map` : ''}`;
    const generic = x => /something went wrong|HTTP \d|internal/i.test(x.status);
    rec('R16a error: API failure', dev, [errs.abort, errs.s503].every(x => x.isError && x.status && !generic(x)) ? (generic(errs.s500) || !errs.abort.inView ? 'PARTIAL' : 'PASS') : 'FAIL',
      `/t/marlin blocked (abort): ${s(errs.abort)}; 503: ${s(errs.s503)}; 500 JSON without message: ${s(errs.s500)}`);
    rec('R16b error: no routes', dev, errs.water.isError && errs.empty.isError ? (errs.water.inView ? 'PASS' : 'PARTIAL') : 'FAIL',
      `pin in open water (real engine): ${s(errs.water)}; mocked 200 with 0 features: ${s(errs.empty)}`);
    // A dedicated "settings too restrictive" message must name the settings, not just the walk.
    const restr = /restrict|snäv|too (strict|narrow)|more transport types|more (connections|transfers)/i.test(errs.restrictive.status);
    rec('R16c error: too restrictive', dev, errs.restrictive.isError && restr ? 'PASS' : errs.restrictive.isError ? 'PARTIAL' : 'FAIL',
      `5 min, wait 0, transfers 0, walk 0/0, boat only (real engine): ${s(errs.restrictive)}; same with walk 10/5: ${s(errs.restrictiveWalk)}${errs.restrictiveWalk.isError ? '' : ' (walk-only area drawn, no hint)'}; client checks: all modes off ${s(errs.noModes)}, max wait 999 ${s(errs.badNumber)}`);
  }

  // R13 responsive extras (facts for the table)
  const extra = { touchTargetsUnder44: await H.touchTargets(page), hOverflow: await H.hOverflow(page), update: await H.updateReachable(page) };
  const m0 = metas[0] || {};
  rec('R12 Trafiklab cached/preprocessed', dev, m0.source === 'gtfs' ? 'PASS' : 'PARTIAL',
    `engine meta: source ${m0.source}, dataVersion ${m0.dataVersion}, computedMs ${m0.computedMs} ; hosts the browser contacted: ${[...hosts].join(', ')}`);
  rec('R13 responsive / touch', dev, !extra.hOverflow && extra.touchTargetsUnder44.length === 0 ? 'PASS' : 'PARTIAL',
    `horizontal overflow ${extra.hOverflow}; own controls under 44 px: ${extra.touchTargetsUnder44.join('; ') || 'none'}; Update in view at end ${extra.update.inView}`);
  rec('R17 console / network health', dev, log.consoleErrors.filter(e => !/ERR_FAILED|503|500|422/.test(e)).length === 0 ? 'PASS' : 'PARTIAL',
    `${log.consoleErrors.length} console errors (${log.consoleErrors.filter(e => !/ERR_FAILED|503|500|422/.test(e)).length} not caused by our injected failures); /isochrone statuses ${log.isoCalls.join(',')}`);
  await ctx.close();
  return { log: { consoleErrors: log.consoleErrors, failed: log.failed, isoCalls: log.isoCalls, loadMs: log.loadMs }, errs, extra, firstBody: b0 };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await H.chromium.launch();
  const run = { at: new Date().toISOString(), base: H.BASE, app: APP, devices: {} };
  for (const dev of ['phone', 'desktop']) {
    try { run.devices[dev] = await runDevice(browser, dev); }
    catch (e) { console.error(dev, 'crashed:', e.message); run.devices[dev] = { crash: e.message }; }
  }
  await browser.close();
  delete results._dragMoved;
  run.results = results;
  fs.writeFileSync(OUT, JSON.stringify(run, null, 2));
  console.log('\nwrote', path.relative(process.cwd(), OUT));
})();
