import assert from 'node:assert';
const S = await import(new URL('../../../board/public/colony/tomfor/strings.js', import.meta.url));
const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });
const set = (search) => { globalThis.location = { search }; };
set('?lang=sv'); assert.equal(S.detectLang(), 'sv');
set('?lang=sv-SE'); assert.equal(S.detectLang(), 'sv');
set('?x=1&lang=EN'); assert.equal(S.detectLang(), 'en');
set('?lang=xx'); assert.equal(S.detectLang(), 'en'); // falls through to navigator
globalThis.localStorage = { getItem: () => 'sv' };
set('?lang=xx'); assert.equal(S.detectLang(), 'sv'); // falls through to saved choice
set('?lang=en'); assert.equal(S.detectLang(), 'en'); // URL beats saved choice
delete globalThis.localStorage; delete globalThis.location;
assert.equal(S.detectLang(), 'en'); // no location/localStorage (node)
assert.equal(S.detectLang('?lang=sv'), 'sv');
if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
console.log('strings-lang OK');
