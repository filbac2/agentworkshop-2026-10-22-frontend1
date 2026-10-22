// Reusable Playwright helpers for map-app E2E checks against the live colony.
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'https://frontend1.torget.bjarby.com';
const T_CENTRALEN = [59.3313, 18.0593];

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
           userAgent: devices['iPhone 13'].userAgent },
  desktop: { viewport: { width: 1280, height: 800 } },
};

// Capture the Leaflet map instance the app creates, so we can project lat/lon to pixels.
const CAPTURE_MAP = () => {
  let _L;
  Object.defineProperty(window, 'L', {
    configurable: true,
    get() { return _L; },
    set(v) { _L = v; try { v.Map.addInitHook(function () { window.__e2eMap = this; }); } catch (e) {} },
  });
};

async function openApp(browser, path, device) {
  const ctx = await browser.newContext(DEVICES[device]);
  await ctx.addInitScript(CAPTURE_MAP);
  const page = await ctx.newPage();
  const log = { consoleErrors: [], failed: [], isoCalls: [] };
  page.on('console', m => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => log.consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('requestfailed', r => log.failed.push(r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
  page.on('response', r => {
    if (r.status() >= 400 && !r.url().includes('/isochrone')) log.failed.push(r.status() + ' ' + r.url().slice(0, 120));
    if (r.url().includes('/isochrone')) log.isoCalls.push(r.status());
  });
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  log.loadMs = Date.now() - t0;
  return { ctx, page, log };
}

const hasMap = page => page.evaluate(() => !!window.__e2eMap);

async function placePin(page, device, latlng = T_CENTRALEN) {
  // Bring the target into the visible map area, then click/tap it like a user.
  const pt = await page.evaluate(([lat, lon]) => {
    const m = window.__e2eMap; if (!m) return null;
    const c = m.getContainer().getBoundingClientRect();
    const tryPt = () => { const p = m.latLngToContainerPoint([lat, lon]); return { x: c.left + p.x, y: c.top + p.y }; };
    const free = p => { const el = document.elementFromPoint(p.x, p.y); return el && (el.classList.contains('leaflet-container') || !!el.closest('.leaflet-tile-pane') || el.tagName === 'IMG' && el.classList.contains('leaflet-tile')) ; };
    let p = tryPt();
    if (!free(p)) {
      // Find a visible free spot on the map and pan so the target lands there.
      for (const fy of [0.2, 0.3, 0.15, 0.4, 0.5]) for (const fx of [0.5, 0.75, 0.25, 0.85]) {
        const q = { x: c.left + c.width * fx, y: c.top + c.height * fy };
        if (q.y < 0 || q.y > innerHeight || !free(q)) continue;
        const cur = m.latLngToContainerPoint([lat, lon]);
        m.panBy([cur.x - (q.x - c.left), cur.y - (q.y - c.top)], { animate: false });
        p = tryPt(); if (free(p)) return { ...p, panned: true };
      }
      return { ...p, blocked: true };
    }
    return p;
  }, latlng);
  if (!pt) return { ok: false, why: 'map instance not found' };
  if (device === 'phone') await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(400);
  const marker = await page.evaluate(() => {
    let ll = null; window.__e2eMap.eachLayer(l => { if (l.getLatLng && l.options && l.options.icon !== undefined && !l.getRadius) ll = l.getLatLng(); });
    return ll && [+ll.lat.toFixed(4), +ll.lng.toFixed(4)];
  });
  return { ok: !!marker, marker, panned: !!pt.panned, blocked: !!pt.blocked };
}

const overlayCount = page => page.evaluate(() => {
  let n = 0; window.__e2eMap.eachLayer(l => { if (l.getLatLngs && !l.getLatLng) n++; }); return n;
});

function updateButton(page) {
  return page.locator('button[type=submit], button').filter({ hasText: /^\s*(Update|Uppdatera)\s*$/ }).first();
}

async function clickUpdate(page, device) {
  const btn = updateButton(page);
  const before = await page.evaluate(() => { const o = []; window.__e2eMap.eachLayer(l => { if (l.getLatLngs && !l.getLatLng) o.push(l._leaflet_id); }); return o.join(','); });
  const respP = page.waitForResponse(r => r.url().includes('/isochrone'), { timeout: 20000 }).catch(() => null);
  const t0 = Date.now();
  if (device === 'phone') await btn.tap(); else await btn.click();
  const resp = await respP;
  const tResp = Date.now() - t0;
  let rendered = false;
  try {
    await page.waitForFunction(b => { const o = []; window.__e2eMap.eachLayer(l => { if (l.getLatLngs && !l.getLatLng) o.push(l._leaflet_id); }); return o.length > 0 && o.join(',') !== b; }, before, { timeout: 20000, polling: 20 });
    rendered = true;
  } catch (e) {}
  const tRender = Date.now() - t0;
  return { status: resp ? resp.status() : null, respMs: tResp, renderMs: rendered ? tRender : null, rendered, layers: await overlayCount(page) };
}

async function legendInfo(page) {
  return page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    const c = [...document.querySelectorAll('[class*=legend i],[id*=legend i]')].filter(vis);
    if (!c.length) return { visible: false };
    const e = c[0]; const txt = e.innerText.replace(/\s+/g, ' ').trim();
    return { visible: true, text: txt.slice(0, 120) };
  });
}

async function switchLang(page, device, to) {
  const btn = page.getByRole('button', { name: new RegExp('^' + to + '$', 'i') });
  if (await btn.count()) { device === 'phone' ? await btn.first().tap() : await btn.first().click(); }
  else {
    const sel = page.locator('select').filter({ has: page.locator('option', { hasText: /Svenska|English/ }) }).first();
    if (!(await sel.count())) return { ok: false, why: 'no language control' };
    await sel.selectOption(to.toLowerCase());
  }
  await page.waitForTimeout(300);
  const label = (await updateButton(page).innerText().catch(() => '')).trim();
  const lang = await page.evaluate(() => document.documentElement.lang);
  return { ok: to === 'SV' ? label === 'Uppdatera' : label === 'Update', updateLabel: label, htmlLang: lang };
}

async function updateReachable(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^(Update|Uppdatera)$/.test(x.innerText.trim()));
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    const inView = r.top >= 0 && r.bottom <= innerHeight && r.width > 0;
    const top = inView && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, inView, notCovered: !!top && (top === b || b.contains(top)), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
  });
}

async function touchTargets(page) {
  return page.evaluate(() => {
    const out = [];
    const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    for (const e of document.querySelectorAll('button, a[href], select, input, [role=button]')) {
      if (!vis(e) || e.closest('.leaflet-control-attribution')) continue;
      let t = e;
      if (e.type === 'checkbox' || e.type === 'radio') t = e.closest('label') || (e.id && document.querySelector('label[for="' + e.id + '"]')) || e;
      const r = t.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 44) {
        const name = (e.getAttribute('aria-label') || e.innerText || e.value || e.className || e.tagName).toString().trim().slice(0, 24);
        out.push(`${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

async function setAllModesOff(page, device) {
  const modes = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];
  let n = 0;
  for (const cb of await page.locator('input[type=checkbox]').all()) {
    const v = await cb.getAttribute('value');
    if (v && modes.includes(v) && await cb.isChecked()) {
      const lbl = cb.locator('xpath=ancestor::label[1]');
      const target = (await lbl.count()) ? lbl : cb;
      device === 'phone' ? await target.tap() : await target.click();
      n++;
    }
  }
  return n;
}

async function visibleMessages(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role=alert],[aria-live],[class*=error i],[class*=status i],[class*=msg i],[class*=message i],[class*=toast i]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.innerText.trim(); })
    .map(e => { const r = e.getBoundingClientRect(); return { text: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 140), inView: r.top >= 0 && r.bottom <= innerHeight }; })
    .filter((x, i, a) => a.findIndex(y => y.text === x.text) === i));
}

async function hOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
}

module.exports = { chromium, BASE, openApp, hasMap, placePin, clickUpdate, legendInfo, switchLang, updateReachable, touchTargets, setAllModesOff, visibleMessages, overlayCount, hOverflow };
