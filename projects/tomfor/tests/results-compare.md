# Map app checklist (2026-10-22 08:34Z, https://frontend1.torget.bjarby.com)

| Requirement | /colony/mareri/ | /colony/filbac/ |
|---|---|---|
| OSM tiles + Leaflet | pass: +leaflet loaded, +L.map, +tile.openstreetmap.org | pass: +leaflet loaded, +L.map, +tile.openstreetmap.org |
| Pin / origin | pass: +marker, +set on map click/tap, +movable (draggable) | pass: +marker, +set on map click/tap, +movable (draggable) |
| Start time, default now | pass: +time input, +defaults to new Date() | pass: +time input, +defaults to new Date() |
| Max travel 5-120 step 5, default 30 | pass: +range 5..120 step 5, +default 30 | pass: +range 5..120 step 5, +default 30 |
| Max wait, default 7 | pass: +wait control, +default 7 | pass: +wait control, +default 7 |
| Walking configs (to destination + between stations) | pass: +walk to destination / egress, +walk between stations / transfer | pass: +walk to destination / egress, +walk between stations / transfer |
| Modes (bus, metro, tram, train, commuter_rail, boat) | pass: +bus, +metro, +tram, +train, +commuter_rail, +boat | pass: +bus, +metro, +tram, +train, +commuter_rail, +boat |
| Max transfers, default 3 | pass: +transfers control, +default 3 | pass: +transfers control, +default 3 |
| Update button | pass: +"Update" label, +"Uppdatera" label | pass: +"Update" label, +"Uppdatera" label |
| 5-min band legend | pass: +legend, +5-min bands | pass: +legend, +5-min bands |
| EN / SV | pass: +en strings, +sv strings, +language switch | pass: +en strings, +sv strings, +language switch |
| Mobile viewport + touch-friendly | pass: +viewport meta, +@media query, +touch targets >=44px | pass: +viewport meta, +@media query, +touch targets >=44px |
| Error handling | PARTIAL: no tomfor errors.js; equivalent: +HTTP error (!res.ok), +bilingual server message, +network/timeout, -no routes, -too restrictive | pass: imports /colony/tomfor/errors.js |
| Calls /t/marlin/isochrone | pass: +endpoint in code, +POST | pass: +endpoint in code, +POST |
| Live default request to marlin (<2 s) (shared engine) | pass: status 200, 6 bands x 5 min, stopsReached 780, ms 44/27/29 | pass: status 200, 6 bands x 5 min, stopsReached 780, ms 44/27/29 |

## Shared tomfor modules imported

| module | /colony/mareri/ | /colony/filbac/ |
|---|---|---|
| /colony/tomfor/strings.js | no (own i18n.js) | no (inline strings) |
| /colony/tomfor/errors.js | no (own errorMessage, abort timeout, engine message EN/SV) | yes |
| /colony/tomfor/search.js | no (no address search / locate) | yes (address search + use my location) |

Extras: both show a test-data banner. mareri has client-side range validation, request abort/timeout, persisted language (filbac gets a 20 s timeout from errors.js). filbac has address search and geolocation.
Checklist script fixed for mareri: defaults set via a select loop and HTML value attributes were missed before.
