# Demo checklist: Isochronous Public Transport Map for Stockholm

Status checked live on 2026-10-22 11:01. Re-check before the demo. Owner in brackets.

**ONE GROUP APP (lead, #build 223): integrator is mareri** (vijay-team voted in #build 225; filbac and the converge plan agree). Headline tile: `https://frontend1.torget.bjarby.com/colony/mareri/`. It loads other teams' modules from `/colony/<team>/...` and `/t/<team>/...`. vijay-team provides data, not a second map:
- Data endpoints `/t/vijay-team/{network,connections,stops,nearby,routes,shape,meta}` (contract: `CONTRACT.md`). Live: `meta` 200 at 11:01.
- Map overlay `/colony/vijay-team/lines-layer.js` (`VijayLines.attach(map)`, `setVisible(false)` to toggle). **Not live yet: 404 at 11:01, goes live when PR 15 merges** (PR 15 was conflicting, re-synced 10:51, release round retries every 5 min; unverified until it merges).

Live at 11:01: mareri tile 200 (PR 18 merged, redesign), `/t/mareri/walk` 200 (street-based walk outline), engine `/t/marlin/health` ok (6,038 stops, 644,804 connections, weekday, source gtfs). Not yet in mareri's page (unverified whether mareri will adopt): filbac `search-control.js`, tomfor `mareri-adapter.js`, our lines layer.

| Requirement | Status | Evidence |
|---|---|---|
| Map of Stockholm with OSM tiles, pan and zoom | Done | Leaflet with `tile.openstreetmap.org`, centred on Stockholm, zoom 11 (mareri app.js) |
| Origin pin, movable | Done | draggable marker plus click on map moves it, coordinates shown (mareri) |
| Start time, default now | Done | datetime-local prefilled with now; read in browser time zone, not Stockholm (mareri, reported) |
| Max travel time 5 to 120 step 5, default 30 | Done (UI) | select built from 5..120 step 5, 30 selected (mareri). Engine still accepts 33 when called directly (marlin, tested 10:40, not re-tested) |
| Max waiting time, default 7 | Done | field default 7; range 0-60 in mareri vs 0-30 in filbac, to agree (mareri, filbac) |
| Walking times (to destination, between stations) | Done (UI) | two fields, defaults 10 and 5 min. Engine walking is straight-line at 4.8 km/h; mareri's street-based walk outline is live (`/t/mareri/walk`, OSM Valhalla); engine walking itself is still straight-line (mareri, marlin) |
| Transport types | Done | six checkboxes bus, metro, tram, train, commuter_rail, boat sent as `modes`; engine rejects unknown names with EN/SV message (mareri, marlin) |
| Max connections, default 3 | Done | field default 3; HTML max 10 but JS max 8 (mareri) |
| Update button triggers calculation | Done | fetch to `/t/marlin/isochrone`, overlay redrawn; `?stub=1` swaps in fake circles (mareri) |
| 5-minute colour bands | Partly | engine returns cumulative 5-min bands on real data, tile draws them in one translucent pane. Nesting bug fixed by marlin (PR 17): 254 -> 13 violations of 3968 stations at 120 min, T-Centralen; 0 at 30 min. 13 remain, minor (vijay-team, 10:51) |
| Results within a couple of seconds | Done (engine) | real data 13 to 330 ms per query; 120 min answer is about 1.1 MB gzipped; under 20 parallel clients 120 min p50 5.2 s, 60 min p50 0.84 s (vijay-team load test). Fine at 30 min |
| Trafiklab not called per request | Done | all data preprocessed from the GTFS zip, no Trafiklab call at request time (marlin, vijay-team) |
| Mobile and desktop usable | Partly | viewport meta, 700px breakpoint, bottom sheet, 44px mode rows. Sheet toggle and 60vh sheet issues reported against the old tile; PR 18 redesign and fixes not re-checked by us. tomfor's acceptance test at 10:57 found no FAIL on phone and desktop (tomfor) |
| Clean modern UI | Partly | clean in code; not yet visually checked on a phone by a human |
| English and Swedish | Done | EN/SV switch, saved in localStorage, mode and error strings translated (mareri, tomfor) |
| Clear error messages (API failure, no routes, too restrictive) | Done | engine `message` and `message_sv` shown, no-modes error, network failure text (mareri, tomfor catalog). Not yet seen end to end by a human |

## Biggest blockers right now

1. **Our PR 15 not merged**, so `lines-layer.js` is 404 live. Owner vijay-team; re-run `tools/pr.sh vijay-team ...` if the next round refuses it again.
2. **Heavy load at 60+ min**: many phones at once makes 120 min slow (p95 10.8 s at 20 clients). Marlin has the cache and 60 m simplification suggestions. Demo at 30 to 60 min.
3. **13 residual nesting violations at 120 min** (was 254). Minor.
4. **mareri integration pending**: it is not yet loading the search control, tomfor adapter or our lines layer (unverified after 10:59). `?stub=1` fake circles remain unlabelled; demo without it.
5. Oracle differences (3 of 15 pairs differ by over 5 min, e.g. T-Centralen to Skansen) reported to marlin, no answer seen yet.

## Demo script (3 minutes)

Use `https://frontend1.torget.bjarby.com/colony/mareri/` with no `?stub=1`.

1. Open the one group app (mareri) in a phone-sized window. OSM map of Stockholm, zoom to T-Centralen.
2. Pin on T-Centralen. Defaults: now, 30 min, 7 min wait, 3 connections.
3. Update. Bands in 5-minute steps appear in seconds, nested rings, dashed street-walk outline around the pin.
4. Max travel 60 min, untick bus, Update: shape changes. Avoid 120 min live (4 MB answer).
5. Move the pin to Kista, Update.
6. Switch to Swedish. Use restrictive settings (0 connections, 5 min): clear error message.
7. Our part, once PR 15 is live (unverified): toggle the rail, tram and boat lines layer on the same map with `VijayLines`. Fallback now: `/colony/vijay-team/` station explorer and `/t/vijay-team/meta`: 6,038 stations, about 645k weekday connections, no Trafiklab calls at request time.
8. One line on quality: our audit found the nesting bug (254 -> 13 violations at 120 min after marlin's fix).
