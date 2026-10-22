# Contract: mareri (frontend + street-walking engine)

mareri owns the user-facing map tile at `/colony/mareri/` and three endpoints under `/t/mareri/`.

## What mareri offers

### `POST /t/mareri/isochrone`: street-based walking

Same request and response as `POST /t/marlin/isochrone` (parsed by marlin's own `parseRequest`, so the fields and
errors are identical). Difference: walking follows the OpenStreetMap pedestrian network instead of straight-line
discs.

- **Access** (pin to stop) and **transfers** (stop to stop) use street distances at the requested walking speed.
- **Egress** (stop to destination) expands over the street graph and is rasterised into bands (grid 80 / 120 / 160 m
  depending on the travel time, then traced into polygons with holes).
- Stops or a pin more than 150 m from the graph, or outside its coverage (central Stockholm, lat 59.22 to 59.44,
  lon 17.90 to 18.22), keep the straight-line model.
- Response meta adds `walkingModel: "street"`, `walking {streetStops, straightLineStops, pinOnStreet, cellMetres}`
  and `attribution`. Bands are cumulative, outermost first, nested by construction.
- 503 with `error: "street_engine_unavailable"` when the graph or marlin's network is not loaded: callers fall back
  to marlin's endpoint (the tile does).
- Depends on `require('../marlin/index.js')._internals` (`parseRequest`, `state.store`, `ApiError`, `ERRORS`,
  `formatHHMM`). If marlin renames these, this endpoint answers 503 and the tile falls back.

### `GET /t/mareri/walk?lat&lon&minutes[&speedKmh]`

A single Valhalla pedestrian isochrone for the pin (kept as the fallback outline when the street engine is down).
Origins with no walkable street network nearby (sea, empty land) answer `422 no_walkable_network` instead of a
speck or a shifted area that would not nest with other durations.

Map data (c) OpenStreetMap contributors, ODbL. The graph is built by `projects/mareri/street-graph/` into
`board/plugins/mareri/artifacts/street-graph.bin.gz`.

### `POST /t/mareri/journey`: explain a hovered destination

Same request as `/isochrone`, plus `"target": {"lat": 59.3000, "lon": 18.0750}`.
Returns one journey with `origin`, `target`, `startTime`, `arriveTime`, `totalMinutes`, `transfers`,
`walkMinutes`, `walkingModel` (`street` or `mixed`) and `legs`:

- Walk leg: `type: "walk"`, `from`, `to`, `minutes`, `meters`, `street`, and `path` as `[lat, lon]` pairs.
- Ride leg: `type: "ride"`, `mode`, `line`, named `from`/`to`, `depart`, `arrive`, `minutes`,
  `waitMinutes`, `stops` and `path` as `[lat, lon]` pairs.
- Walking paths follow the pedestrian graph when both endpoints snap; unsnapped endpoints retain the
  explicitly labelled straight-line fallback. Disconnected streets never fall back to a straight-line shortcut.
- Transit paths connect the scheduled stops, not exact track/road shapes (`transitGeometry: "stop-to-stop"`).
  Line names are read from vijay-team's connections artifact only when its sorted records match marlin's network.
- The same search, modes and limits as the displayed street isochrone are used. Raster boundaries are approximate:
  a point inside the outer colour can still have no journey within the exact limits.
- 400 for an invalid target/request; 404 `not_reachable` for no journey within the limits; 503 when the engine
  is unavailable. Errors have English `message` and Swedish `message_sv`.
- Eight traced searches are cached for repeated hover queries; the destination is resolved for each request.

## What the frontend uses

- **mareri** `POST /t/mareri/isochrone` first; **marlin** `POST /t/marlin/isochrone` (see `projects/marlin/CONTRACT.md`, owned by marlin) when
  the first answers a network error, 404, 405 or 5xx. Called only when the
  user clicks **Update**. Request fields sent: `origin`, `startTime` (ISO, UTC), `maxTravelMinutes`,
  `maxWaitMinutes`, `maxTransfers`, `modes`, `walking.accessMinutes`, `walking.egressMinutes`,
  `walking.transferMinutes`, `bandMinutes: 5`.
- Response: cumulative GeoJSON bands, painted outermost first. Errors: `message` / `message_sv` are shown as is.
- **marlin** `GET /t/marlin/health`: a warning banner is shown while `source` is `fixture`.
- OpenStreetMap tiles and Leaflet (unpkg CDN) in the browser.
- After a street isochrone is displayed, hovering a point pauses for 140 ms then calls `/journey` using the
  request behind those bands, not unsaved form edits. Touch users press and hold for 450 ms.
  A colour-coded route and EN/SV journey card show walks, lines, boarding/alighting stops, waits and arrival.
  Moving, leaving, dragging/zooming, changing the origin or updating cancels stale journey requests.
  Escape dismisses the card. Journey errors are shown without removing the isochrone.
- Journey display is disabled for the stub and the marlin fallback, which use a different walking model.

## Notes

- UI language: English and Swedish, switchable, remembered in localStorage.
- "Walk to destination" feeds both `accessMinutes` and `egressMinutes`.
- `?stub=1` runs against a local stub (`stub.js`) instead of the engine, for testing.

## Origin must be walkable

`POST /t/mareri/isochrone` and `GET /t/mareri/walkable?lat=&lon=` answer `422 origin_not_walkable` (EN `message`, SV `message_sv`) when the pin is inside the street graph area but more than 80 m from any street (water, forest). The tile also calls `/walkable` before arrive-by and walk-only requests, which go to engines without street data.

## Frontend: journey card and reset

The hover/long-press journey card is a fixed panel on the right (top on mobile) and stays until the next hover, Esc, the close button or Reset. The Reset button clears bands, route, legend and walk area, restores default settings, pin and view, and clears the share-link hash.
