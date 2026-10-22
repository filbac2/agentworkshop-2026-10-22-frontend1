# tomfor: i18n, errors and place search

Owner: team tomfor. Plain ES modules, no dependencies, no backend. Served at `/colony/tomfor/`.
Demo: `/colony/tomfor/index.html`. Only tomfor changes this file; changes are announced in `#build` first.

```js
import { t, bandLegend, detectLang, MODES } from '/colony/tomfor/strings.js';
import { errorMessage, fetchJson } from '/colony/tomfor/errors.js';
import { searchAddress, createSearcher, locate } from '/colony/tomfor/search.js';
```

## strings.js

- `t(lang, key, vars?)`: `lang` is `'en'` or `'sv'` (anything else falls back to en). `{name}` placeholders are filled from `vars`.
  `t('sv', 'legend.band', {from: 0, to: 5})` gives `0–5 min`. Missing key gives the English text, then the key.
- `strings.en` / `strings.sv`: identical keys: `app.*`, `map.hint`, `pin.*`, `settings.*`, `mode.<mode>`, `legend.*`,
  `result.*`, `warning.fixture`, `search.*`, `error.*`.
- `MODES`: `bus, metro, tram, train, commuter_rail, boat` (vijay-team names; label key `mode.<name>`).
- `bandLegend(lang, maxTravelMinutes = 30, bandMinutes = 5)` gives `[{from, to, color, label}]`, nearest band first. `BAND_COLORS` is the palette.
- `detectLang()` reads localStorage `lang`, then `navigator.language`. `normalizeLang(x)`, `LANGS`.

## errors.js

`errorMessage(lang, err)` returns `{key, code, text, fix, message}`; `text` says what happened, `fix` what to do, `message` is both.
`err` can be any of:

| input | key |
|---|---|
| marlin body `{error:'no_stops_near_origin'}` (also what marlin returns for too-restrictive settings; fix text suggests more walking, modes or transfers) | `no_stops` |
| `no_routes` | `no_routes` |
| `{error:'nothing_reachable'}`, `too_restrictive`, HTTP 422 | `too_restrictive` |
| `{error:{code:'no_routes'}}` (mareri shape) | same codes as above |
| `bad_request`, `unknown_mode`, other 4xx | `bad_request` |
| `network_not_loaded` (503) | `network_not_loaded` |
| 5xx, `internal`, failed fetch (TypeError) | `api` |
| `navigator.onLine === false`, `{code:'offline'}` | `offline` |
| AbortError / TimeoutError / 408 / 504 | `timeout` |
| GeolocationPositionError (1 denied, 2 unavailable, 3 timeout) | `geo_denied` / `geo_unavailable` / `timeout` |
| `{code:'search_failed'}` | `search_failed` |
| `{code:'unavailable'}` (marlin kind) | `unavailable` (new, additive) |
| `{code:'unreachable'}` | `unreachable` (new, additive) |

## mareri-adapter.js

Classic script for /colony/mareri: better EN/SV wording merged into window.I18N, localized aria-labels, and
`window.TomforMareri.errorText(lang, err)` for marlin errors. Exact lines and the wording table: [MARERI-INTEGRATION.md](MARERI-INTEGRATION.md).

Example: `errorMessage('sv', {status: 422, error: 'nothing_reachable'}).text` gives `Inställningarna är för snäva.`

`fetchJson(url, opts?, timeoutMs = 15000)` is a fetch wrapper that rejects with `{status, ...body}` on non-2xx and an AbortError on timeout, so `catch (e) { errorMessage(lang, e) }` just works.

## search.js

- `searchAddress(query, {lang, limit, signal})` resolves `[{label, lat, lon}]` (Nominatim, bounded to the Stockholm area, Sweden only).
  Queries under 3 characters resolve `[]`. Requests are queued so there is at most 1 per 1.1 s. Rejects `{code:'search_failed'}`.
- `createSearcher({lang: () => 'en', delayMs: 400})` returns `{search(text), cancel()}`: debounced; a newer call rejects the older with `{name:'AbortError'}` (ignore it).
- `locate()` resolves `{lat, lon, accuracy}` or rejects with a GeolocationPositionError / `{code:'geo_unavailable'}`; pass it to `errorMessage`.

Browser only for search: Nominatim answers 403 to Node's default fetch User-Agent. In Node tests, wrap `fetch` to send a
`User-Agent` header (verified live 10:25: works, 5 hits for "Kungsgatan 1").

Example (mareri): `const [p] = await searchAddress('Drottninggatan 1'); map.setView([p.lat, p.lon], 15); setPin(p.lat, p.lon);`
