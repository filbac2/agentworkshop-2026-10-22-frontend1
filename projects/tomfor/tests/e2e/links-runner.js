// Links-driven acceptance runner: opens each shareable link from links.txt in Chromium (phone 390px + desktop 1280px),
// waits for the isochrone overlay or an error, prints one health line per link and viewport, writes links-run.json.
// Line format: tomfor-acceptance <PASS|FAIL|SKIP> <link-id> <viewport> <ms> <note>
// Run: npm run e2e:links   (env BASE, LINKS=path, ONLY=id1,id2, VIEWPORTS=phone,desktop)
const fs = require('fs');
const path = require('path');
const { chromium, BASE, openApp, placePin, switchLang, overlayCount } = require('./helpers');

const LINKS = process.env.LINKS || path.join(__dirname, 'links.txt');
const OUT = path.join(__dirname, 'links-run.json');
const SHOTS = path.join(__dirname, '..', 'screenshots');
const VIEWPORTS = (process.env.VIEWPORTS || 'phone,desktop').split(',');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const OUTCOME_TIMEOUT = 20000;

function parseLinks(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map((l, i) => {
    const [u, c = ''] = l.split(/\s+#\s*/, 2);
    const words = c.trim().split(/\s+/);
    const id = words[0] && !words[0].includes('=') ? words.shift() : 'link-' + (i + 1);
    const ex = words.find(w => w.startsWith('expect='));
    const url = new URL(u, BASE);
    const p = url.searchParams;
    // mareri share link (PR 26): #ll=lat,lon&t=min&w=&x=&d=&r=&m=modes[&lang=sv]
    const h = new URLSearchParams(url.hash.slice(1));
    const ll = h.has('ll') ? h.get('ll').split(',').map(Number) : null;
    const pick = (q, hk) => (p.has(q) ? p.get(q) : h.has(hk) ? h.get(hk) : null);
    const min = pick('min', 't'), modes = pick('modes', 'm');
    return {
      id, url: url.toString(), path: url.pathname + url.search + url.hash, comment: c.trim(),
      expect: ex ? ex.slice(7) : 'overlay',
      needsHash: words.includes('needs=hash'),
      params: {
        lat: p.has('lat') ? +p.get('lat') : ll ? ll[0] : null, lon: p.has('lon') ? +p.get('lon') : ll ? ll[1] : null,
        min: min != null ? +min : null, modes: modes != null ? modes.split(',').filter(Boolean) : null,
        lang: pick('lang', 'lang'), time: p.get('time'),
      },
    };
  });
}

const markerLatLng = page => page.evaluate(() => {
  const m = window.__e2eMap; if (!m) return null;
  let ll = null; m.eachLayer(l => { if (l.getLatLng && l.options && l.options.icon !== undefined && !l.getRadius) ll = l.getLatLng(); });
  return ll && [ll.lat, ll.lng];
});

const overlayIds = page => page.evaluate(() => {
  const o = []; if (!window.__e2eMap) return '';
  window.__e2eMap.eachLayer(l => { if (l.getLatLngs && !l.getLatLng) o.push(l._leaflet_id); }); return o.join(',');
});

const errorText = page => page.evaluate(() => {
  const els = [...document.querySelectorAll('[role=alert], [role=status].error, #status.error, .error')];
  const e = els.find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && x.innerText.trim(); });
  return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, 100) : null;
});

const updateLabel = page => page.evaluate(() => {
  const b = document.querySelector('#update') || [...document.querySelectorAll('button')].find(x => /^(Update|Uppdatera)$/.test(x.innerText.trim()));
  return b ? b.innerText.trim() : '';
});

// Which of the link's params did the app pick up by itself from the URL?
async function detectUrlState(page, log, p) {
  await page.waitForTimeout(1500);
  const seen = [];
  if (log.isoCalls.length) seen.push('auto-request');
  const mk = await markerLatLng(page);
  if (mk && p.lat != null && Math.abs(mk[0] - p.lat) < 0.002 && Math.abs(mk[1] - p.lon) < 0.002) seen.push('pin');
  const ui = await page.evaluate(() => ({
    min: (document.querySelector('#max-travel') || {}).value,
    time: (document.querySelector('#start-time') || {}).value,
  }));
  if (p.min != null && p.min !== 30 && +ui.min === p.min) seen.push('min');
  if (p.time && ui.time && ui.time.startsWith(p.time)) seen.push('time');
  const lbl = await updateLabel(page);
  if (p.lang === 'sv' && lbl === 'Uppdatera') seen.push('lang');
  return seen;
}

// Fallback when the app ignores URL params: set the same state through the UI like a user would.
async function driveUi(page, device, p) {
  const done = [];
  if (p.lang) { const r = await switchLang(page, device, p.lang.toUpperCase()); if (r.ok) done.push('lang'); }
  if (p.min != null) {
    const ok = await page.evaluate(v => {
      const el = document.querySelector('#max-travel'); if (!el) return false;
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return +el.value === v;
    }, p.min);
    if (ok) done.push('min');
  }
  if (p.time) { const t = page.locator('#start-time'); if (await t.count()) { await t.fill(p.time.slice(0, 16)); done.push('time'); } }
  if (p.modes) {
    for (const cb of await page.locator('input[type=checkbox]').all()) {
      const v = await cb.getAttribute('value'); if (!v) continue;
      const want = p.modes.includes(v);
      if (await cb.isChecked() !== want) {
        const lbl = cb.locator('xpath=ancestor::label[1]'); const tgt = (await lbl.count()) ? lbl : cb;
        device === 'phone' ? await tgt.tap() : await tgt.click();
      }
    }
    done.push('modes');
  }
  if (p.lat != null) { const r = await placePin(page, device, [p.lat, p.lon]); if (r.ok) done.push('pin'); }
  return done;
}

async function waitOutcome(page, before, t0) {
  try {
    await page.waitForFunction(b => {
      const m = window.__e2eMap; if (!m) return false;
      const o = []; m.eachLayer(l => { if (l.getLatLngs && !l.getLatLng) o.push(l._leaflet_id); });
      if (o.length && o.join(',') !== b) return true;
      const e = [...document.querySelectorAll('[role=alert], [role=status].error, #status.error, .error')]
        .find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && x.innerText.trim(); });
      return !!e;
    }, before, { timeout: OUTCOME_TIMEOUT, polling: 50 });
  } catch (e) { return { got: 'timeout', ms: Date.now() - t0 }; }
  const ms = Date.now() - t0;
  const err = await errorText(page);
  if (err) return { got: 'error', ms, error: err };
  return { got: 'overlay', ms, layers: await overlayCount(page) };
}

async function runOne(browser, link, device) {
  const r = { id: link.id, url: link.url, viewport: device, expect: link.expect };
  const { ctx, page, log } = await openApp(browser, link.path, device);
  try {
    r.loadMs = log.loadMs;
    const seen = await detectUrlState(page, log, link.params);
    r.urlStateSeen = seen;
    r.urlState = seen.length > 0;
    if (link.needsHash && !r.urlState) {
      r.status = 'SKIP'; r.ms = 0; r.note = 'share-link hash not picked up by the app (not live yet)';
      return r;
    }
    let out;
    if (log.isoCalls.length) {
      out = await waitOutcome(page, '', Date.now() - 1500);
      r.drove = [];
    } else {
      r.drove = await driveUi(page, device, link.params);
      const before = await overlayIds(page);
      const respP = page.waitForResponse(x => x.url().includes('/isochrone'), { timeout: OUTCOME_TIMEOUT }).catch(() => null);
      const btn = page.locator('#update');
      const t0 = Date.now();
      device === 'phone' ? await btn.tap() : await btn.click();
      out = await waitOutcome(page, before, t0);
      const resp = await respP; r.httpStatus = resp ? resp.status() : null;
    }
    Object.assign(r, out);
    r.updateLabel = await updateLabel(page);
    const notes = [];
    if (out.got === 'overlay') notes.push(`overlay ${out.layers} layers`);
    if (out.got === 'error') notes.push(`error "${out.error}"`);
    if (out.got === 'timeout') notes.push('no overlay or error within ' + OUTCOME_TIMEOUT / 1000 + 's');
    if (r.httpStatus) notes.push('http ' + r.httpStatus);
    let pass = out.got === link.expect;
    if (link.params.lang === 'sv' && r.updateLabel !== 'Uppdatera') { pass = false; notes.push('not Swedish: button "' + r.updateLabel + '"'); }
    notes.push(r.urlState ? 'url-state ' + seen.join('+') : 'url-state not supported, drove UI ' + r.drove.join('+'));
    if (log.consoleErrors.length) notes.push(log.consoleErrors.length + ' console error(s)');
    r.status = pass ? 'PASS' : 'FAIL';
    r.note = notes.join('; ');
    r.consoleErrors = log.consoleErrors;
    if (!pass) {
      fs.mkdirSync(SHOTS, { recursive: true });
      r.screenshot = `tests/screenshots/links-${link.id}-${device}.png`;
      await page.screenshot({ path: path.join(SHOTS, `links-${link.id}-${device}.png`) });
    }
  } catch (e) {
    r.status = 'FAIL'; r.got = 'exception'; r.ms = r.ms || 0; r.note = 'runner exception: ' + e.message.split('\n')[0].slice(0, 120);
  } finally { await ctx.close(); }
  return r;
}

(async () => {
  const links = parseLinks(LINKS).filter(l => !ONLY || ONLY.includes(l.id));
  const browser = await chromium.launch();
  const results = [];
  for (const link of links) for (const device of VIEWPORTS) {
    const r = await runOne(browser, link, device);
    results.push(r);
    console.log(`tomfor-acceptance ${r.status} ${r.id} ${r.viewport} ${r.ms ?? 0} ${r.note}`);
  }
  await browser.close();
  const summary = {
    runner: 'tomfor-acceptance', format: 'tomfor-acceptance <PASS|FAIL|SKIP> <link-id> <viewport> <ms> <note>',
    base: BASE, finishedAt: new Date().toISOString(),
    pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length,
    skip: results.filter(r => r.status === 'SKIP').length,
    urlStateSupported: results.some(r => r.urlState), results,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');
  console.log(`tomfor-acceptance SUMMARY ${summary.pass} pass ${summary.fail} fail ${summary.skip} skip, url-state ${summary.urlStateSupported ? 'supported' : 'not supported'}, json tests/e2e/links-run.json`);
  process.exit(summary.fail ? 1 : 0);
})();
