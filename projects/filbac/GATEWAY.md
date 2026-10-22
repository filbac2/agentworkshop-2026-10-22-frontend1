# filbac gateway: one backend for the Stockholm isochrone map

Base URL: `/t/filbac/api` (same origin as every colony tile, no CORS). Live route table: `GET /t/filbac/api`.

The gateway owns no data and no algorithm. It forwards to the owning team over loopback and passes status, body
and errors through unchanged, so every owner's contract still holds. Only the owner changes its contract.

| Gateway route | Method | Owner | Upstream |
|---|---|---|---|
| `/t/filbac/api/isochrone` | POST | marlin | `/t/marlin/isochrone` |
| `/t/filbac/api/modes` | GET | marlin | `/t/marlin/modes` |
| `/t/filbac/api/walk?lat&lon&minutes` | GET | mareri | `/t/mareri/walk` |
| `/t/filbac/api/stops` | GET | vijay-team | `/t/vijay-team/stops` |
| `/t/filbac/api/nearby?lat&lon&radius&modes` | GET | vijay-team | `/t/vijay-team/nearby` |
| `/t/filbac/api/routes` | GET | vijay-team | `/t/vijay-team/routes` |
| `/t/filbac/api/shape/<mode>/<name>` | GET | vijay-team | `/t/vijay-team/shape/...` |
| `/t/filbac/api/meta` | GET | vijay-team | `/t/vijay-team/meta` |
| `/t/filbac/api/health` | GET | filbac | pings marlin `/health` and vijay-team `/meta` |

## What the gateway adds

- **Cache:** identical isochrone request bodies are answered from memory for 2 minutes (max 40 answers).
  Header `x-gateway-cache: hit|miss`. Helps many phones asking the same thing during a demo.
- **gzip:** isochrone answers are gzipped when the browser accepts it (30 min at T-Centralen: about 45 KB).
- **One error shape when an owner is down:** `502 {"error":"upstream_unavailable","message","message_sv","owner"}`.
  Errors from owners (for example marlin's 422 `no_stops_near_origin`) pass through untouched.
- **Health:** `GET /t/filbac/api/health` returns `{ok, upstreams:[{name, owner, ok, status, ms}], gateway}`; 503 if any is down.
- **Walk mode:** send `"modes": []` or `"modes": ["walk"]` to `/t/filbac/api/isochrone` and you get walking areas
  in exactly marlin's band format (cumulative, outermost first, `fromMinutes`/`toMinutes`, `bandIndex`), with
  `meta.walkOnly: true`. Bands up to 30 min follow real streets (mareri `/t/mareri/walk`, OSM); longer bands, or any
  band when mareri is down, are a straight-line estimate (speed / 1.3 detour). Each band says which in
  `properties.source` (`street` or `estimate`). Accepts `walking.speedKmh`; at most 24 bands (wider bands if needed).
  `"walk"` mixed with transit modes is removed before the request goes to marlin, so a Walk chip never causes a 400.
  Header `x-gateway-engine: walk|marlin`.

## Switching a frontend

Replace the team prefix only, nothing else changes:

```js
fetch('/t/filbac/api/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
```

## Example

```
POST /t/filbac/api/isochrone
{"origin":{"lat":59.3307,"lon":18.0592},"startTime":"2026-10-22T08:00:00+02:00","maxTravelMinutes":30}
-> 200 GeoJSON FeatureCollection (marlin's contract), x-gateway-cache: miss, then hit
```
