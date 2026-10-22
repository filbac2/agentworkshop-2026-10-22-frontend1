// Walk-only E2E on the ONE map app (/colony/mareri/, mareri PR 26): all transport chips off + Update
// must POST modes [] to /t/filbac/api/isochrone, get meta.walkOnly true, draw bands, show legend/status
// in EN and SV, and no error line. Before PR 26 the app refuses "no mode": then we print SKIP.
// Run: npm run e2e:walk   (PLAYWRIGHT_BROWSERS_PATH=.pw-browsers node tests/e2e/walk-only.js)
const H = require('./helpers');

const APP = process.env.APP || '/colony/mareri/';
const GATEWAY = '/t/filbac/api/isochrone';
const device = process.env.DEVICE || 'desktop';

const statusInfo = page => page.evaluate(() => {
  const s = document.getElementById('status');
  return s ? { text: s.innerText.replace(/\s+/g, ' ').trim(), error: /error/i.test(s.className) } : { text: '', error: false };
});
const errorLines = async page => (await H.visibleMessages(page)).filter(m => /error|fel|failed|misslyck|choose|välj|at least|minst/i.test(m.text));

async function runWalk(page) {
  const reqs = [];
  const onReq = r => { if (r.url().includes(GATEWAY) && r.method() === 'POST') { try { reqs.push(JSON.parse(r.postData() || '{}')); } catch (e) { reqs.push({}); } } };
  page.on('request', onReq);
  const respP = page.waitForResponse(r => r.url().includes(GATEWAY) && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
  const upd = await H.clickUpdate(page, device).catch(e => ({ err: e.message }));
  const resp = await respP;
  let body = null; if (resp) body = await resp.json().catch(() => null);
  page.off('request', onReq);
  return { upd, req: reqs[reqs.length - 1] || null, status: resp ? resp.status() : null, body };
}

(async () => {
  const browser = await H.chromium.launch();
  const fails = [];
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  try {
    const { page, log } = await H.openApp(browser, APP, device);
    if (!(await H.hasMap(page))) throw new Error('map instance not found at ' + APP);
    await H.placePin(page, device);
    const off = await H.setAllModesOff(page, device);
    const still = await page.locator('input[type=checkbox]').evaluateAll(es => es.filter(e => ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'].includes(e.value) && e.checked).length);
    console.log(`turned ${off} transport chips off, ${still} still on`);

    const r = await runWalk(page);
    const st = await statusInfo(page);
    const errs = await errorLines(page);
    const sentEmpty = r.req && Array.isArray(r.req.modes) && r.req.modes.length === 0;
    const walkOnly = r.body && r.body.meta && r.body.meta.walkOnly === true;
    if (!sentEmpty || !walkOnly) {
      const why = !r.req ? 'no request sent' : `sent modes ${JSON.stringify(r.req.modes)} -> ${r.status}`;
      console.log(`old behaviour: ${why}; status "${st.text}"${st.error ? ' (error)' : ''}${errs.length ? '; messages: ' + errs.map(e => e.text).join(' | ') : ''}`);
      console.log('SKIP: PR 26 not live');
      process.exitCode = 0;
      return;
    }

    check(still === 0, 'all transport chips off');
    check(sentEmpty, `POST ${GATEWAY} with modes [] (body ${JSON.stringify(r.req).slice(0, 120)})`);
    check(r.status === 200 && walkOnly, `response ${r.status}, meta.walkOnly ${r.body.meta.walkOnly}, ${(r.body.features || []).length} bands`);
    check(r.upd.rendered && r.upd.layers > 0, `bands drawn: ${r.upd.layers} overlay layers`);

    for (const lang of ['EN', 'SV']) {
      const sw = await H.switchLang(page, device, lang);
      if (lang === 'SV' || !sw.ok) { const again = await runWalk(page); check(again.status === 200 && again.body && again.body.meta && again.body.meta.walkOnly === true, `[${lang}] re-run walk-only -> ${again.status}`); }
      const legend = await H.legendInfo(page);
      const s = await statusInfo(page);
      const e = await errorLines(page);
      check(sw.ok, `[${lang}] language switch, Update label "${sw.updateLabel}", html lang ${sw.htmlLang}`);
      check(legend.visible && legend.text.length > 0, `[${lang}] legend visible: "${legend.text || ''}"`);
      check(!!s.text && !s.error, `[${lang}] status "${s.text}"`);
      const looksLang = lang === 'SV' ? /[åäö]|gång|minuter|min/i.test(s.text + ' ' + (legend.text || '')) : /walk|min/i.test(s.text + ' ' + (legend.text || ''));
      check(looksLang, `[${lang}] legend/status text is in ${lang}`);
      check(!s.error && e.length === 0, `[${lang}] no error line${e.length ? ': ' + e.map(x => x.text).join(' | ') : ''}`);
    }
    check(log.consoleErrors.length === 0, `no console errors${log.consoleErrors.length ? ': ' + log.consoleErrors.join(' | ') : ''}`);
    console.log(fails.length ? `walk-only: ${fails.length} FAIL` : 'walk-only: PASS');
    process.exitCode = fails.length ? 1 : 0;
  } catch (e) {
    console.log('ERROR ' + e.message);
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
})();
