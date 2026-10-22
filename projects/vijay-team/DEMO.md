# Demo checklist: Isochronous Public Transport Map for Stockholm

Status checked live on 2026-10-22 10:40. Re-check before the demo. Owner in brackets.

**Single frontend: `https://frontend1.torget.bjarby.com/colony/mareri/`** (filbac proposed converging on it in #build 166, vijay-team agreed in 167; filbac's tile becomes a redirect once mareri's PR 18 is live). Live HTTP status at 10:40: mareri 200, filbac 200, tomfor 200, vijay-team 200. Engine: `POST /t/marlin/isochrone` on real GTFS (6,038 stops, 644,804 connections, weekday).

| Requirement | Status | Evidence |
|---|---|---|
| Map of Stockholm with OSM tiles, pan and zoom | Done | Leaflet with `tile.openstreetmap.org`, centred on Stockholm, zoom 11 (mareri app.js) |
| Origin pin, movable | Done | draggable marker plus click on map moves it, coordinates shown (mareri) |
| Start time, default now | Done | datetime-local prefilled with now; read in browser time zone, not Stockholm (mareri, reported) |
| Max travel time 5 to 120 step 5, default 30 | Done (UI) | select built from 5..120 step 5, 30 selected (mareri). Engine still accepts 33 when called directly (marlin, re-tested 10:40) |
| Max waiting time, default 7 | Done | field default 7; range 0-60 in mareri vs 0-30 in filbac, to agree (mareri, filbac) |
| Walking times (to destination, between stations) | Done (UI) | two fields, defaults 10 and 5 min. Engine walking is straight-line at 4.8 km/h; mareri's street-based walk outline is in PR 18, not live yet (mareri, marlin) |
| Transport types | Done | six checkboxes bus, metro, tram, train, commuter_rail, boat sent as `modes`; engine rejects unknown names with EN/SV message (mareri, marlin) |
| Max connections, default 3 | Done | field default 3; HTML max 10 but JS max 8 (mareri) |
| Update button triggers calculation | Done | fetch to `/t/marlin/isochrone`, overlay redrawn; `?stub=1` swaps in fake circles (mareri) |
| 5-minute colour bands | Partly | engine returns cumulative 5-min bands on real data, tile draws them in one translucent pane. Bands break nesting in some cases (marlin) |
| Results within a couple of seconds | Done (engine) | real data 13 to 330 ms per query; 120 min answer is 1.09 MB gzipped, so slow on mobile networks (marlin, perf-analyst) |
| Trafiklab not called per request | Done | all data preprocessed from the GTFS zip, no Trafiklab call at request time (marlin, vijay-team) |
| Mobile and desktop usable | Partly | viewport meta, 700px breakpoint, bottom sheet, 44px mode rows. Sheet toggle about 28px, 60vh sheet hides map on 360px phones (mareri, reported) |
| Clean modern UI | Partly | clean in code; not yet visually checked on a phone by a human |
| English and Swedish | Done | EN/SV switch, saved in localStorage, mode and error strings translated (mareri, tomfor) |
| Clear error messages (API failure, no routes, too restrictive) | Done | engine `message` and `message_sv` shown, no-modes error, network failure text (mareri, tomfor catalog). Not yet seen end to end by a human |

## Biggest blockers right now

1. **Polygon nesting violations in marlin's bands**: outer and inner bands do not always nest, so the overlay can show holes or odd shapes. Owner marlin, vijay-team is auditing 8 origins. Also T-Centralen 60 min polygon misses 3 far stops (93.9% coverage).
2. **Stub mode in mareri**: `?stub=1` replaces the engine with fake circles and is not visibly labelled. The default URL uses the real engine, so demo with no query string. Owner mareri.
3. **mareri PR 18 not live yet** (walk outline, sheet fixes, fitBounds, sticky Update, Stockholm time zone). Until then walking is straight-line and mobile layout has the known issues. Owner mareri.
4. **Engine accepts `maxTravelMinutes: 33`** where the contract says multiples of 5; the UI cannot send it, so low risk (marlin).
5. Frontend convergence: filbac redirect to mareri pending; tomfor holds the single verdict after PR 18.

## Demo script (3 minutes)

Use `https://frontend1.torget.bjarby.com/colony/mareri/` with no `?stub=1`.

1. Open it in a phone-sized window. Show the OSM map of Stockholm, zoom in on T-Centralen.
2. Place the pin on T-Centralen. Show defaults: now, 30 min, 7 min wait, 3 connections.
3. Press Update. Bands appear within seconds, 5 minutes each.
4. Change max travel to 60 min and untick bus. Update. The area changes shape.
5. Move the pin to Kista. Update.
6. Switch to Swedish. Choose very restrictive settings (0 connections, 5 min): the clear error message appears.
7. Show our station explorer (`/colony/vijay-team/`) as the data behind it: 6,038 stations, 645k weekday connections, no Trafiklab calls.
