# tomfor: i18n, errors and place search

Owner: team tomfor. Plain ES modules, no dependencies, no backend. Served as static files under `/colony/tomfor/`.
Only tomfor changes this file; changes are announced in `#build` first.

tomfor has no tile page: per filbac's `#build` post 290 the group shows one tile in the colony, so our
`index.html` (docs + test page) was removed. The modules below stay at the same URLs, and this file is the docs.

## Modules

| file | what |
|---|---|
| `/colony/tomfor/strings.js` | EN/SV strings, `t()`, band legend, language detection |
| `/colony/tomfor/errors.js` | clear EN/SV error messages (what happened + what to do), `fetchJson` |
| `/colony/tomfor/search.js` | debounced address search (Nominatim, Stockholm area) and "my location" |
| `/colony/tomfor/mareri-adapter.js` | classic script for the group app: wording, aria-labels, `window.TomforMareri.errorText` |

Classic script load (between the app's `i18n.js` and `app.js`):

```html
<script src="i18n.js"></script>
<script src="/colony/tomfor/mareri-adapter.js"></script>
<script src="app.js"></script>
<!-- then, for a marlin error: const msg = window.TomforMareri.errorText(lang, err); -->
```

ES module load:

```js
import { t, bandLegend, detectLang, MODES } from '/colony/tomfor/strings.js';
import { errorMessage, fetchJson } from '/colony/tomfor/errors.js';
import { searchAddress, createSearcher, locate } from '/colony/tomfor/search.js';
```

## Loading tomfor in the group app

tomfor is not the integrator (we vote mareri) and has no tile of its own. The integrator loads us in one of two ways,
no build step and no backend:

1. One classic script tag, between its `i18n.js` and `app.js`: `<script src="/colony/tomfor/mareri-adapter.js"></script>`.
   It merges our EN/SV wording into `window.I18N`, localizes aria-labels and exposes `window.TomforMareri.errorText(lang, err)`.
2. ES modules: the three import lines at the top of this file (`strings.js`, `errors.js`, `search.js`).

All files are same-origin static files under `/colony/tomfor/`. `docs.*` keys in `strings.js` were used by our removed tile; they stay for compatibility.

## strings.js

- `t(lang, key, vars?)`: `lang` is `'en'` or `'sv'` (anything else falls back to en). `{name}` placeholders are filled from `vars`.
  `t('sv', 'legend.band', {from: 0, to: 5})` gives `0–5 min`. Missing key gives the English text, then the key.
- `strings.en` / `strings.sv`: identical keys: `app.*`, `map.hint`, `pin.*`, `settings.*`, `mode.<mode>`, `legend.*`,
  `result.*`, `warning.fixture`, `search.*`, `error.*`.
- `MODES`: `bus, metro, tram, train, commuter_rail, boat` (vijay-team names; label key `mode.<name>`).
- `bandLegend(lang, maxTravelMinutes = 30, bandMinutes = 5)` gives `[{from, to, color, label}]`, nearest band first. `BAND_COLORS` is the palette.
- `detectLang(search?)` reads the URL param `?lang=` (`en`/`sv`, also `sv-SE`; unknown values are skipped), then localStorage `lang`, then `navigator.language`, then `en`. Works in node too. `normalizeLang(x)`, `LANGS`.

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

## Acceptance summary (moved from the removed tile)

Our run of the PROJEKT.md requirements against the group app (phone 390px touch / desktop 1280x800). Details:
[tests/results-acceptance.md](tests/results-acceptance.md), raw run `tests/e2e/acceptance-run.json`.

| # | requirement | phone | desktop |
|---|---|---|---|
| R1 | OSM map, Stockholm, pan + zoom | PASS | PASS |
| R2 | Set and move the pin | PASS | PASS |
| R3 | Start time defaults to now | PASS | PASS |
| R4 | Max travel 5-120, step 5, default 30 | PASS | PASS |
| R5 | Max wait default 7 | PASS | PASS |
| R6 | Walking: to destination + between stations | PASS | PASS |
| R7 | Transport type filters | PASS | PASS |
| R8 | Max transfers default 3 | PASS | PASS |
| R9 | Update recalculates | PASS | PASS |
| R10 | 5-min colour bands + legend | PASS | PARTIAL |
| R11 | Rendered within a couple of seconds | PASS | PASS |
| R12 | Trafiklab cached / preprocessed | PASS | PASS |
| R13 | Responsive, touch-friendly | PARTIAL | PARTIAL |
| R15 | English and Swedish | PASS | PASS |
| R16a | Clear error: API failure | PARTIAL | PARTIAL |
| R16b | Clear error: no routes | PARTIAL | PARTIAL |
| R16c | Clear error: options too restrictive | PARTIAL | PARTIAL |
| R17 | Console / network health | PASS | PASS |
