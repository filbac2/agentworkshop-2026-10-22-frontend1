// mareri PR 26 readiness checks on the live map app (/colony/mareri/): group-app meta tag, share link in the URL hash,
// 44px targets at 390px, slider aria-valuetext, role=alert errors, visible focus rings, Swedish copy.
// Every check SKIPs (with what it saw) while PR 26 is not live; "live" = the meta tag or POST /t/mareri/journey exists.
// Run: npm run e2e:pr26   (env BASE, APP). Writes tests/e2e/pr26-run.json, screenshots tests/screenshots/pr26-*.png.
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const APP = process.env.APP || '/colony/mareri/';
const OUT = path.join(__dirname, 'pr26-run.json');
const SHOTS = path.join(__dirname, '..', 'screenshots');
const PIN = [59.3326, 18.0649];
const SETTINGS = { 'max-travel': 45, 'max-wait': 10, 'max-transfers': 2, 'walk-dest': 8, 'walk-transfer': 4 };
const MODES = ['bus', 'metro'];

const results = [];
const rec = (id, dev, status, evidence) => {
  results.push({ id, viewport: dev, status, evidence });
  console.log(`pr26 ${status} ${id} ${dev} - ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
};
// Before PR 26 is live a missing feature is a SKIP; after, it is a FAIL.
const gate = (live, ok) => (ok ? 'PASS' : live ? 'FAIL' : 'SKIP');

async function prLive() {
  const r = await fetch(H.BASE + '/t/mareri/journey', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
  return { journeyStatus: r ? r.status : null, journeyLive: !!r && r.status !== 404 };
}

const setControls = (page, settings) => page.evaluate(s => {
  for (const [id, v] of Object.entries(s)) {
    const e = document.getElementById(id); if (!e) continue;
    e.value = String(v);
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, settings);

const readState = page => page.evaluate(ids => {
  let pin = null;
  if (window.__e2eMap) window.__e2eMap.eachLayer(l => { if (l.getLatLng && l.options && l.options.draggable) pin = l.getLatLng(); });
  const v = {}; for (const id of ids) { const e = document.getElementById(id); v[id] = e ? +e.value : null; }
  const modes = [...document.querySelectorAll('#modes input[type=checkbox]')].filter(c => c.checked).map(c => c.value).sort();
  const upd = document.getElementById('update');
  return {
    pin: pin && [+pin.lat.toFixed(4), +pin.lng.toFixed(4)], values: v, modes,
    lang: upd && /Uppdatera/.test(upd.innerText) ? 'sv' : 'en', htmlLang: document.documentElement.lang,
  };
}, Object.keys(SETTINGS));

async function setModes(page, want) {
  for (const cb of await page.locator('#modes input[type=checkbox]').all()) {
    if ((await cb.isChecked()) !== want.includes(await cb.getAttribute('value'))) {
      const lbl = cb.locator('xpath=ancestor::label[1]');
      await ((await lbl.count()) ? lbl : cb).click();
    }
  }
}

async function submitAndWait(page) {
  await page.locator('#update').click();
  await page.waitForFunction(() => !document.getElementById('update').disabled, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function checkMeta(page, dev) {
  const content = await page.evaluate(() => { const m = document.querySelector('meta[name=colony]'); return m && m.getAttribute('content'); });
  return content;
}

async function checkShare(browser, live) {
  const dev = 'desktop';
  const { ctx, page } = await H.openApp(browser, APP, dev);
  try {
    const pinR = await H.placePin(page, dev, PIN);
    await setControls(page, SETTINGS);
    await setModes(page, MODES);
    const lang = await H.switchLang(page, dev, 'SV');
    const want = await readState(page);
    if (!want.pin) { rec('share-link', dev, 'FAIL', 'could not place the pin: ' + JSON.stringify(pinR)); return null; }
    await submitAndWait(page);
    const hash = await page.evaluate(() => location.hash);
    if (!hash || hash.length < 2) {
      rec('share-link', dev, live ? 'FAIL' : 'SKIP', `no location.hash after Update (pin ${pinR.ok}, lang ${lang.ok})`);
      rec('share-link-lang', dev, live ? 'FAIL' : 'SKIP', 'no hash');
      return null;
    }
    const url = (await page.evaluate(() => location.pathname + location.search)) + hash;
    const fresh = await H.openApp(browser, url, dev); // new context: no localStorage carried over
    try {
      await fresh.page.waitForTimeout(1500);
      const got = await readState(fresh.page);
      const diffs = [];
      if (!got.pin || Math.abs(got.pin[0] - want.pin[0]) > 0.0005 || Math.abs(got.pin[1] - want.pin[1]) > 0.0005) diffs.push(`pin ${want.pin} -> ${got.pin}`);
      for (const k of Object.keys(SETTINGS)) if (got.values[k] !== want.values[k]) diffs.push(`${k} ${want.values[k]} -> ${got.values[k]}`);
      if (got.modes.join() !== want.modes.join()) diffs.push(`modes ${want.modes} -> ${got.modes}`);
      rec('share-link', dev, diffs.length ? 'FAIL' : 'PASS', diffs.length ? `hash ${hash}: ${diffs.join('; ')}` : `hash ${hash} restored pin+settings+modes`);
      rec('share-link-lang', dev, got.lang === 'sv' ? 'PASS' : 'FAIL',
        got.lang === 'sv' ? 'fresh page opened in Swedish' : `fresh page opened in ${got.lang} (html lang ${got.htmlLang}); hash has no lang key: ${!/(^|[#&])(lang|l)=/.test(hash)}`);
      await fresh.page.screenshot({ path: path.join(SHOTS, 'pr26-share-restored-desktop.png') });
      return url;
    } finally { await fresh.ctx.close(); }
  } finally { await ctx.close(); }
}

async function checkTargets(browser, live) {
  const dev = 'phone';
  const { ctx, page } = await H.openApp(browser, APP, dev);
  try {
    const small = await H.touchTargets(page);
    rec('touch-targets-44', dev, gate(live, small.length === 0), small.length ? `${small.length} below 44px: ${small.slice(0, 8).join(', ')}` : 'all visible controls >= 44x44');
    const dvh = await page.evaluate(() => [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => /dvh/.test(r.cssText)); } catch (e) { return false; } }));
    rec('dvh-units', dev, gate(live, dvh), dvh ? 'stylesheet uses dvh' : 'no dvh in same-origin stylesheets');
    await page.screenshot({ path: path.join(SHOTS, 'pr26-targets-phone.png') });
  } finally { await ctx.close(); }
}

async function checkDesktopA11y(browser, live) {
  const dev = 'desktop';
  const { ctx, page } = await H.openApp(browser, APP, dev);
  try {
    const meta = await checkMeta(page, dev);
    rec('meta-colony-group-app', dev, gate(live, meta === 'group-app'), `meta[name=colony] content=${JSON.stringify(meta)}`);

    // Slider: aria-valuetext must read like "30 min" and follow the value.
    const vt0 = await page.getAttribute('#max-travel', 'aria-valuetext');
    await setControls(page, { 'max-travel': 45 });
    const vt1 = await page.getAttribute('#max-travel', 'aria-valuetext');
    const ok = /^30 min$/.test(vt0 || '') && /^45 min$/.test(vt1 || '');
    rec('slider-aria-valuetext', dev, vt0 == null && !live ? 'SKIP' : ok ? 'PASS' : 'FAIL', `initial ${JSON.stringify(vt0)}, after 45 ${JSON.stringify(vt1)}`);
    await setControls(page, { 'max-travel': 30 });

    // Visible focus ring on keyboard Tab through the first stops.
    await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
    const stops = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => {
        const e = document.activeElement; if (!e || e === document.body) return null;
        const s = getComputedStyle(e);
        const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) || (s.boxShadow && s.boxShadow !== 'none');
        return { el: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.type ? '[' + e.type + ']' : ''), ring, outline: `${s.outlineStyle} ${s.outlineWidth}` };
      }));
    }
    const seen = stops.filter(Boolean);
    const noRing = seen.filter(s => !s.ring).map(s => s.el);
    rec('focus-ring-on-tab', dev, gate(live, seen.length > 0 && noRing.length === 0),
      noRing.length ? `${noRing.length}/${seen.length} tab stops without outline/box-shadow: ${[...new Set(noRing)].slice(0, 8).join(', ')}` : `${seen.length} tab stops all show a ring`);

    // Error region: abort the engine call -> network error; it must be announced as an alert.
    await page.route('**/isochrone', r => r.abort());
    await page.locator('#update').click();
    await page.waitForFunction(() => !document.getElementById('update').disabled, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.unroute('**/isochrone');
    const err = await page.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.innerText.trim(); };
      const alert = [...document.querySelectorAll('[role=alert]')].find(vis);
      const st = document.getElementById('status');
      return { alertText: alert ? alert.innerText.trim().slice(0, 80) : null,
        status: st && { role: st.getAttribute('role'), live: st.getAttribute('aria-live'), cls: st.className, text: st.innerText.trim().slice(0, 80) } };
    });
    const alertOk = !!err.alertText || (err.status && err.status.text && /error/.test(err.status.cls) && err.status.live === 'assertive');
    rec('error-role-alert', dev, gate(live, alertOk), err.alertText ? `role=alert "${err.alertText}"` : `no visible role=alert; #status ${JSON.stringify(err.status)}`);

    // Swedish copy: the engine-unavailable text must say Beräkningstjänsten, not Isokronmotorn.
    const sv = await page.evaluate(() => { const d = window.I18N && (window.I18N.sv || window.I18N.SV); return d ? Object.values(d).join('\n') : null; });
    if (!sv) rec('sv-copy-berakningstjansten', dev, 'SKIP', 'window.I18N.sv not found');
    else {
      const iso = /Isokronmotorn/.test(sv), ber = /Beräkningstjänsten/.test(sv);
      const alt = (sv.match(/[^\n]*inte tillgänglig ännu[^\n]*/) || [''])[0];
      rec('sv-copy-berakningstjansten', dev, iso && !live ? 'SKIP' : !iso && ber ? 'PASS' : 'FAIL',
        `Isokronmotorn present: ${iso}; Beräkningstjänsten present: ${ber}; unavailable text "${alt}"`);
    }
  } finally { await ctx.close(); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const probe = await prLive();
  const browser = await H.chromium.launch();
  let live = probe.journeyLive;
  try {
    const { ctx, page } = await H.openApp(browser, APP, 'desktop');
    live = live || (await checkMeta(page)) === 'group-app';
    await ctx.close();
    console.log(`pr26 INFO PR 26 live: ${live} (POST /t/mareri/journey -> ${probe.journeyStatus})`);
    await checkDesktopA11y(browser, live);
    await checkTargets(browser, live);
    const shareUrl = await checkShare(browser, live);
    if (shareUrl) console.log('pr26 INFO share URL', shareUrl);
  } catch (e) {
    rec('runner', 'n/a', 'FAIL', 'exception: ' + e.message.split('\n')[0].slice(0, 160));
  } finally { await browser.close(); }
  const count = s => results.filter(r => r.status === s).length;
  const summary = { runner: 'pr26', base: H.BASE, app: APP, finishedAt: new Date().toISOString(), live, journeyStatus: probe.journeyStatus,
    pass: count('PASS'), fail: count('FAIL'), skip: count('SKIP'), results };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');
  console.log(`pr26 SUMMARY live=${live} ${summary.pass} pass ${summary.fail} fail ${summary.skip} skip, json tests/e2e/pr26-run.json`);
  process.exit(summary.fail ? 1 : 0);
})();
