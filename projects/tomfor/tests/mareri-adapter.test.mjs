import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
const dir = new URL('../../../board/public/colony/tomfor/', import.meta.url);
const S = await import(new URL('strings.js', dir)); const E = await import(new URL('errors.js', dir)); await import(new URL('search.js', dir));
const en = Object.keys(S.strings.en).sort(), sv = Object.keys(S.strings.sv).sort();
assert.deepStrictEqual(en, sv); console.log('strings.js keys match:', en.length);
for (const k of ['no_routes','too_restrictive','api','offline','timeout','unavailable','unreachable']) { assert(S.strings.en['error.'+k+'.fix']); }
assert.equal(S.t('sv','error.heading'), 'Felmeddelanden');
assert.equal(E.errorMessage('sv',{error:'no_stops_near_origin'}).key,'no_stops');
// adapter
const ctx = { I18N: { en: { title: 'Stockholm isochrone map', update: 'Update' }, sv: { title: 'Isokronkarta över Stockholm', update: 'Uppdatera' } } };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('mareri-adapter.js', dir), 'utf8').replace('(typeof window', '(typeof __x'), ctx);
const A = ctx.TomforMareri; await A.ready;
const ak = (l) => Object.keys(A.strings[l]).filter(k => k !== 'sec.limits').sort();
assert.deepStrictEqual(Object.keys(A.strings.en).sort(), ak('sv')); // sv adds only sec.limits
assert.equal(ctx.I18N.sv.title, 'Restidskarta för Stockholm'); assert.equal(ctx.I18N.sv.update, 'Uppdatera');
assert.equal(A.errorText('sv', {}), null); // errors.js not loaded yet -> fall back
A.use(E);
const mk = (o) => Object.assign(new Error('HTTP x'), o);
const cases = [
  [mk({ status: 422, code: 'no_stops_near_origin', engineMessageSv: 'Ingen hållplats inom 10 minuters gångavstånd från nålen.' }), 'no_stops'],
  [mk({ status: 422, code: 'nothing_reachable' }), 'too_restrictive'],
  [mk({ status: 422, body: { error: 'nothing_reachable', kind: 'too_restrictive' } }), 'too_restrictive'],
  [mk({ status: 503 }), 'unavailable'], [mk({ status: 404 }), 'unavailable'],
  [mk({ isNetwork: true }), 'unreachable'], [Object.assign(new Error('a'), { name: 'AbortError' }), 'timeout'],
  [mk({ status: 500 }), 'api'],
];
for (const [e, key] of cases) { const i = A.errorInfo('sv', e); assert.equal(i.key, key, JSON.stringify(e)); assert(!/HTTP|\d{3}/.test(i.message), i.message); console.log(key.padEnd(16), i.message); }
console.log('EN:', A.errorText('en', mk({ status: 422, code: 'nothing_reachable', engineMessage: 'No departure fits.' })));
console.log('OK');
