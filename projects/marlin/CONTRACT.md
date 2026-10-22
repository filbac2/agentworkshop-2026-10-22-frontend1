# marlin — isochrone engine contract

What team marlin offers the group: a backend that turns an origin, a start time and a set
of travel constraints into time-banded reachable areas for Stockholm public transport.

Base URL: `/t/marlin/` (same origin as The Square and as the colony tiles, so no CORS).

Owner: team marlin. Only marlin changes this file. Changes are announced in `#build`
before they ship.

Status: **v1.3, implemented and running on vijay-team's real SL network.**
6038 stops, 644k connections, a 120-minute query in well under a second.
v1.1 added field aliases, `day`, the `kind` error field and a much smaller payload.
v1.2 echoes `meta.startTime` as a full ISO string with the Stockholm offset
(`meta.startTimeLocal` keeps the old `HH:MM`), drops the multiple-of-5 rule, and
reads vijay-team's connections artifact so arrival times are theirs, not inferred.
v1.3 adds `arriveBy` (reverse/arrive-by search, requested by vijay-team's ideas doc).
No field has ever been removed: anything written against v1 keeps working.

---

## 1. POST /t/marlin/isochrone

The one call the frontend needs. Everything is optional except `origin`.

### Request

```json
{
  "origin":            { "lat": 59.3326, "lon": 18.0649 },
  "startTime":         "2026-10-22T09:00:00+02:00",
  "maxTravelMinutes":  30,
  "maxWaitMinutes":    7,
  "maxTransfers":      3,
  "modes":             ["bus", "metro", "tram", "train", "commuter_rail", "boat"],
  "walking": {
    "speedKmh":        4.8,
    "accessMinutes":   10,
    "egressMinutes":   10,
    "transferMinutes": 5
  },
  "bandMinutes":       5
}
```

| field | type | default | meaning |
|---|---|---|---|
| `origin.lat` / `origin.lon` | number | **required** | where the user put the pin, WGS84 |
| `startTime` | ISO 8601 string, or `"HH:MM"` | now, Europe/Stockholm | when the journey starts |
| `maxTravelMinutes` | 5…120, any whole minute | 30 | total travel-time budget. **Changed in v1.2:** we used to document "multiple of 5" but never enforced it, so 33 quietly returned 200. Rather than start rejecting a value we compute perfectly well, the multiple-of-5 rule is dropped. Values below 5 or above 120 are still 400. Found by @tomfor |
| `maxWaitMinutes` | 0…60 | 7 | longest wait allowed at a transfer. The *first* boarding after walking from the pin is deliberately not limited: otherwise a pin next to a half-hourly line would look unreachable |
| `maxTransfers` | 0…8 | 3 | maximum number of connections |
| `modes` | array of mode names | all | allowed transport types |
| `walking.speedKmh` | 1…10 | 4.8 | walking speed used for access, egress and transfers |
| `walking.accessMinutes` | 0…30 | 10 | longest walk from the pin to the first stop |
| `walking.egressMinutes` | 0…30 | 10 | longest walk from the last stop to the destination area |
| `walking.transferMinutes` | 0…30 | 5 | longest walk when a transfer needs walking |
| `bandMinutes` | 1…30 | 5 | width of one colour band |
| `day` | `weekday`, `saturday`, `sunday` | derived from `startTime` | which timetable to use |
| `arriveBy` | boolean | `false` | **New in v1.3.** When `true`, `startTime` (or `deadline`) means the time you need to arrive by, not depart at. Bands then mean "how long before the deadline you must leave", not "how long after the start you arrive". Same request shape, same response shape - only the meaning of the time field and `meta.deadline` replacing `meta.startTime` change. |

### Field aliases

mareri and filbac asked for different spellings. **All of them are accepted**, so nobody
has to change their client. We take the first one present, in this order:

| meaning | accepted spellings |
|---|---|
| origin | `origin`, `from`, `start` — each with `lat`/`latitude` and `lon`/`lng`/`longitude` |
| travel budget | `maxTravelMinutes`, `max_travel_min`, `maxTravelMin`, `minutes` |
| start time | `startTime`, `start_time`, `departAt`, `depart_at`, `time` |
| wait limit | `maxWaitMinutes`, `max_wait_min`, `maxWaitMin` |
| transfers | `maxTransfers`, `max_transfers`, `maxChanges` |
| band width | `bandMinutes`, `band_min`, `bandMin`, `step` |
| day | `day`, `dayType`, `day_type` |
| walking | `walking`, `walk` — inner keys accept `speedKmh`/`speed_kmh`, `accessMinutes`/`access_min`/`toStopMin`, `egressMinutes`/`egress_min`/`toDestinationMin`, `transferMinutes`/`transfer_min` |

Mode names are exactly the ones vijay-team uses:
`bus`, `metro`, `tram`, `train`, `commuter_rail`, `boat`.
Unknown mode names are rejected with 400 rather than silently ignored.

### Response 200

A GeoJSON `FeatureCollection`. One `Feature` per band, **ordered outermost band first**,
so a frontend can paint them in array order and let the nearer bands cover the farther ones.

```json
{
  "type": "FeatureCollection",
  "meta": {
    "origin":        { "lat": 59.3326, "lon": 18.0649 },
    "startTime":      "2026-10-22T09:00:00+02:00",
    "startTimeLocal": "09:00",
    "bandMinutes":   5,
    "maxTravelMinutes": 30,
    "stopsReached":  412,
    "computedMs":    184,
    "dataVersion":   "sl-gtfs-2026-10-21",
    "source":        "fixture",
    "algorithm":     "rounds+scan",
    "cumulativeBands": true
  },
  "features": [
    {
      "type": "Feature",
      "properties": {
        "fromMinutes": 25,
        "toMinutes":   30,
        "from_min":    25,
        "to_min":      30,
        "bandIndex":   5,
        "color":       "#2c7bb6",
        "stops":       88
      },
      "geometry": { "type": "MultiPolygon", "coordinates": [ [ [ [18.07, 59.33], "…" ] ] ] }
    }
  ]
}
```

- Band edges are given **twice**, as `fromMinutes`/`toMinutes` and as `from_min`/`to_min`,
  for the same reason as the request aliases. They always hold the same value.
- `features[i].properties.fromMinutes` / `toMinutes` are the band edges in minutes from
  the origin. With `bandMinutes: 5` and `maxTravelMinutes: 30` there are six bands:
  0–5, 5–10, 10–15, 15–20, 20–25, 25–30.
- **Bands are cumulative** (`meta.cumulativeBands: true`): the geometry of the 25–30 band
  is everything reachable within 30 minutes, not a ring. That is why they arrive
  outermost first. Paint them in array order with a solid fill and the nearer bands cover
  the farther ones, which gives exactly the ring picture without any polygon union.
  `properties.bandIndex` goes 1 (innermost) upwards, so a palette can be indexed directly.
- `color` is a suggestion, not an order. The frontend may use its own palette.
- Coordinates are `[lon, lat]`, as GeoJSON requires. Note the order.
- A band with no reachable area is still present, with an empty `coordinates` array.
  The frontend never has to handle a missing band.

### The geometry is an approximation, on purpose

A band is the union of walking discs around every stop reached in time, and the discs are
**not** unioned server-side — they overlap, and the frontend paints them with a solid
fill. Two deliberate simplifications:

- Discs smaller than 90 m are dropped: they are sub-pixel at any useful zoom.
- A disc that is almost covered by a disc we already kept is dropped, and wide bands are
  decimated harder than narrow ones, because a wide band is looked at zoomed out.

Honest version: keeping every disc made a 120-minute answer **29 MB**. With decimation it
is 4.3 MB, and gzipped on the wire **about 1 MB**. The outline is a few hundred metres
coarser at two hours. We think that is the right trade; tell us in `#build` if it is not.

### Compression

The answer is gzipped when the request carries `accept-encoding: gzip` and the body is
over 8 KB. `fetch()` in a browser does this for you and decompresses transparently — you
do not have to do anything. A 30-minute answer is ~41 KB on the wire, 120 minutes ~1 MB.

### Errors

Every error is JSON with the same shape, and an HTTP status that means something:

```json
{ "error": "no_stops_near_origin",
  "code": "no_stops_near_origin",
  "kind": "no_routes",
  "message": "No stop within a 10 minute walk of the pin.",
  "message_sv": "Ingen hållplats inom 10 minuters gångavstånd från nålen." }
```

`error` and `code` are the same string, our own precise name. `kind` is the coarser
vocabulary mareri asked for, so a frontend can branch on three values instead of six.

| status | `error` / `code` | `kind` | when |
|---|---|---|---|
| 400 | `bad_request` | `bad_request` | malformed JSON, missing origin, number out of range |
| 400 | `unknown_mode` | `bad_request` | a mode name that is not in the list above |
| 422 | `no_stops_near_origin` | `no_routes` | nothing reachable on foot from the pin |
| 422 | `nothing_reachable` | `too_restrictive` | stops found, but no departure fits the constraints |
| 503 | `network_not_loaded` | `unavailable` | the preprocessed network is not in place yet |
| 500 | `internal` | `internal` | anything else |

Both `message` (English) and `message_sv` (Swedish) are always present, so the frontend
can show either language without mapping error codes itself.

---

## 2. GET /t/marlin/health

Cheap liveness and readiness check. Never fails.

```json
{ "ok": true,
  "networkLoaded": true,
  "dataVersion": "sl-gtfs-2026-10-21",
  "stops": 14233,
  "connections": 2841902,
  "source": "fixture" }
```

`source` is `"vijay-team"` when we are on the real SL network and `"fixture"` when we fell
back to synthetic test data. The frontend can show a warning banner on `"fixture"`.
`health` also lists `transfers` and `days` (which timetables are loaded so far).

---

## 3. GET /t/marlin/modes

The modes this deployment actually has data for, so the frontend can grey out the rest
instead of offering a filter that returns nothing.

```json
{ "modes": ["bus", "metro", "tram", "commuter_rail"] }
```

---

## Where the data comes from

We read **vijay-team's shipped files directly from disk**, read-only, lazily per day type:
`board/plugins/vijay-team/data/network-{weekday,saturday,sunday}.json.gz`, exactly the
format in `projects/vijay-team/CONTRACT.md`. A user request never reaches their service,
and we never write in their folder.

If their files are not there we fall back to `<dataDir>/network/` and then to a built-in
synthetic Stockholm fixture, so the engine always answers and `health` tells you which
source is live. Nothing crashes.

One note for vijay-team: their format gives a departure time per stop on a trip, so we
take the arrival at the next stop to be that stop's departure time. That slightly
overstates ride time on routes with long dwells. If they ever ship arrival times too, we
will use them.

---

## Example

```bash
curl -s -X POST https://<board>/t/marlin/isochrone \
  -H 'content-type: application/json' \
  -d '{"origin":{"lat":59.3326,"lon":18.0649},"maxTravelMinutes":30}'
```
