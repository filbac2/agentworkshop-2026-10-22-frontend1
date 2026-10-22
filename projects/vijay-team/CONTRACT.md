# vijay-team: transit data layer (v1)

Source: SL GTFS (feed 2026-10-21) preprocessed offline by `projects/vijay-team/preprocess.js` into
`board/plugins/vijay-team/artifacts/network-<day>.json.gz`. No request ever calls Trafiklab.

## HTTP (mounted at `/t/vijay-team/`)

| Endpoint | Returns |
|---|---|
| `GET /network?day=weekday\|saturday\|sunday` | the compact network below (gzip JSON, `content-encoding: gzip`). Default: today's day type |
| `GET /stops?day=&bbox=minLon,minLat,maxLon,maxLat&modes=metro,bus` | JSON array of stops (with `index`), filtered |
| `GET /nearby?lat=&lon=&radius=800&modes=&day=` | stations within `radius` metres (max 3000), nearest first, max 50: `[{ index, id, name, modes, distM, walkSec }]`. `walkSec` is straight-line at 1.3 m/s. 400 if lat/lon are missing, empty or out of range (lat first). Any endpoint with an unknown `day` answers 400 |
| `GET /connections?day=` | connections for RAPTOR/CSA (gzip JSON, ~3-4 MB), format below |
| `GET /departures?stop=&time=HH:MM&day=&limit=10&modes=` | next departures from a station (`stop` = index or id from `/stops` or `/nearby`; `time` defaults to now in Stockholm; `limit` max 50): `{ stop, day, from, departures: [{ dep, depSec, route, mode, to, toIndex }] }`. 400 for an unknown stop or a bad time |
| `GET /service?stop=&day=` | first and last departure per mode at a station, departures per hour (24 buckets) and `serviceAfterMidnight`; `last` above 24:00 wraps (`lastSec` keeps the raw value, e.g. 90024 = 01:00 next day) |
| `GET /frequency?from=07:00&to=09:00&day=` | every station with service in the window: `{ stops: [{ index, departures, avgHeadwayMin }] }` for a service-quality layer. 400 if `to` is not after `from` |
| `/meta` `feed` key | `{ version, publisher, validFrom, validTo }`: the timetable only covers `validFrom` to `validTo`; warn users who pick a date outside it |
| `GET /routes?modes=` | `[{ name, mode, lines, days }]`: every route with line geometry; `days` lists the day types with service (empty = no trips in the feed) |
| `GET /shape/<mode>/<name>` | GeoJSON Feature, `MultiLineString` (one line per direction, `[lon, lat]`, simplified to about 20 m). 404 if unknown. Example: `/shape/metro/10` |
| `GET /meta` | per day type: `{ date, generated, stopCount, tripCount }` |

Each day type is one representative day (Tue / Sat / Sun), about 35k / 23k / 22k trips, about 1-2 MB gzipped.

## Modes

`bus`, `metro`, `tram`, `train` (Roslagsbanan, Saltsjöbanan), `commuter_rail` (Pendeltåg), `boat`.

## Network format

```json
{
  "version": 1, "dayType": "weekday", "date": "20261103", "generated": "ISO time",
  "stops": [{ "id": "9021001001051000", "name": "T-Centralen", "lat": 59.33166, "lon": 18.06169, "modes": ["metro"] }],
  "trips": [{ "route": "10", "mode": "metro", "stops": [243, 244, 250], "times": [30000, 30120, 30300] }],
  "transfers": [{ "from": 243, "to": 301, "walkSec": 180 }]
}
```

- Stops are stations (platforms merged). In `trips[].stops` and `transfers` a stop is its **index** in `stops`.
- `times[i]` is the departure in seconds after midnight at `stops[i]` (can exceed 86400 after midnight).
- `transfers` are directed walking links (GTFS transfers plus any station within 300 m at 1.3 m/s).
- Only the first time you board and each later stop matter: ride from `stops[i]` to `stops[j]`, j > i, leaving at `times[i]` and arriving at `times[j]`.

## Connections format (`/connections`, also the file `board/plugins/vijay-team/artifacts/connections-<day>.json.gz`)

Columnar arrays of equal length, one entry per hop between consecutive stops of a trip, sorted by departure stop, then `dep`:

```json
{ "version": 1, "dayType": "weekday", "date": "20261103", "stopCount": 6038,
  "routes": [{ "name": "10", "mode": "metro" }],
  "offsets": [0, 12, 40],
  "from": [0], "to": [5], "dep": [30000], "arr": [30120], "route": [0], "trip": [17] }
```

- Connections departing stop `s` are indices `offsets[s]` to `offsets[s+1]-1`, already sorted by `dep`.
- `from`/`to` are indices into the `stops` list of `/network`. `route` indexes `routes`. Same `trip` value on consecutive hops means no change needed.
- Walking links: `transfers` in `/network`. The calendar is already resolved into the day type.

## Changes

Only vijay-team changes this contract. Changes are announced in `#build` first.
