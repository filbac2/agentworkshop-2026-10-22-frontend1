// Usage: PLAYWRIGHT_BROWSERS_PATH=.pw-browsers node tests/e2e/compare-mapapps.js mareri
const H = require('./helpers');
const fs = require('fs');
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Server-side error: origin in open water (no stop within walking distance), one request.
async function runNoStops(browser, app) {
  const { ctx, page, log } = await H.openApp(browser, `/colony/${app}/`, 'desktop');
  const pin = await H.placePin(page, 'desktop', [59.27, 18.62]);
  const upd = await H.clickUpdate(page, 'desktop');
  await page.waitForTimeout(1500);
  const r = { app, device: 'desktop', case: 'no stops near origin', pin, status: upd.status, layers: upd.layers, messages: await H.visibleMessages(page), consoleErrors: log.consoleErrors };
  await page.locator('aside, .panel, form').first().screenshot({ path: `tests/screenshots/${app}-desktop-nostops.png` }).catch(() => page.screenshot({ path: `tests/screenshots/${app}-desktop-nostops.png` }));
  await ctx.close();
  return r;
}

async function run(browser, app, device) {
  const shot = step => `tests/screenshots/${app}-${device}-${step}.png`;
  const r = { app, device };
  const { ctx, page, log } = await H.openApp(browser, `/colony/${app}/`, device);
  r.loadMs = log.loadMs;
  r.mapCaptured = await H.hasMap(page);
  r.hOverflow = await H.hOverflow(page);
  r.updateAtLoad = await H.updateReachable(page);
  r.touchFails = await H.touchTargets(page);
  r.pin = await H.placePin(page, device);
  // On phone, a collapsed sheet may hide Update; open it the way a user would.
  r.openedSheet = false;
  if (!(await H.updateReachable(page)).notCovered) {
    const t = page.locator('[aria-expanded=false]').first();
    if (await t.count() && await t.isVisible()) { await t.tap().catch(() => t.click()); r.openedSheet = true; await page.waitForTimeout(400); }
  }
  r.updateAfterPin = await H.updateReachable(page);
  const runs = [];
  runs.push(await H.clickUpdate(page, device));
  if (device === 'desktop') { runs.push(await H.clickUpdate(page, device)); runs.push(await H.clickUpdate(page, device)); }
  r.update = runs[0]; r.renderMsAll = runs.map(x => x.renderMs); r.renderMsMedian = median(r.renderMsAll);
  await page.waitForTimeout(600);
  r.legend = await H.legendInfo(page);
  await page.screenshot({ path: shot('result') });
  r.langSV = await H.switchLang(page, device, 'SV');
  r.legendSV = await H.legendInfo(page);
  r.langEN = await H.switchLang(page, device, 'EN');
  // Error case: all modes off, then Update. Reopen a collapsed sheet first, as a user would.
  r.reopenedSheetForError = false;
  const tog = page.locator('[aria-expanded=false]').first();
  if (await tog.count() && await tog.isVisible()) { device === 'phone' ? await tog.tap() : await tog.click(); r.reopenedSheetForError = true; await page.waitForTimeout(500); }
  r.modesUnchecked = await H.setAllModesOff(page, device);
  const before = log.isoCalls.length;
  const layersBefore = await H.overlayCount(page);
  const btn = page.locator('button').filter({ hasText: /^\s*(Update|Uppdatera)\s*$/ }).first();
  const reach = await H.updateReachable(page);
  if (!reach.notCovered && device === 'phone') { await btn.scrollIntoViewIfNeeded(); }
  device === 'phone' ? await btn.tap() : await btn.click();
  await page.waitForTimeout(2500);
  r.error = { requestSent: log.isoCalls.length > before, status: log.isoCalls[before] || null, messages: await H.visibleMessages(page), layersBefore, layersAfter: await H.overlayCount(page) };
  r.consoleErrors = log.consoleErrors; r.failed = log.failed;
  await ctx.close();
  return r;
}

(async () => {
  const browser = await H.chromium.launch();
  const results = [];
  for (const app of process.argv.slice(2)) for (const device of ['phone', 'desktop']) {
    try { results.push(await run(browser, app, device)); }
    catch (e) { results.push({ app, device, crash: e.message.split('\n')[0] }); }
  }
  for (const app of process.argv.slice(2)) {
    try { results.push(await runNoStops(browser, app)); } catch (e) { results.push({ app, case: 'no stops', crash: e.message.split('\n')[0] }); }
  }
  await browser.close();
  fs.writeFileSync('tests/e2e/last-run.json', JSON.stringify({ at: new Date().toISOString(), browser: 'chromium headless (Playwright)', results }, null, 2));
  console.log(JSON.stringify(results, null, 1));
})();
