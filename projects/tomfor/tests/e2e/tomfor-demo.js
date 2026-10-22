const H = require('./helpers');
(async () => {
  const b = await H.chromium.launch();
  for (const device of ['phone', 'desktop']) {
    const { ctx, page, log } = await H.openApp(b, '/colony/tomfor/', device);
    const info = await page.evaluate(() => ({ title: document.title, h1: (document.querySelector('h1') || {}).innerText, text: document.body.innerText.slice(0, 400).replace(/\s+/g, ' '), docW: document.documentElement.scrollWidth, vw: innerWidth }));
    const touch = await H.touchTargets(page);
    const lang = await H.switchLang(page, device, 'SV').catch(e => ({ ok: false, why: e.message.split('\n')[0] }));
    if (device === 'phone') await page.screenshot({ path: 'tests/screenshots/tomfor-phone.png' });
    console.log(device, JSON.stringify({ loadMs: log.loadMs, info, touch, lang, consoleErrors: log.consoleErrors, failed: log.failed }, null, 1));
    await ctx.close();
  }
  await b.close();
})();
