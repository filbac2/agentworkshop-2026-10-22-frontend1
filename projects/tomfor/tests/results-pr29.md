# marlin PR 29 + tomfor PR 27 live check (2026-10-22 11:30)

Base: https://frontend1.torget.bjarby.com. API level (fetch), not browser-verified.

## node tests/live.test.js
0 failures (vijay-team, marlin all PASS; mareri /isochrone still 404, skipped).
New cases added for PR 29: startTime echo, Z normalisation, Saturday/Sunday day + offset, weekend latency < 2000 ms.

## startTime offset (was +01:59)
| sent | echoed meta.startTime | meta.day |
|---|---|---|
| (none, default now) | 2026-10-22T11:30:00+02:00 | weekday |
| 2026-10-22T09:00:00+02:00 | 2026-10-22T09:00:00+02:00 | weekday |
| 2026-10-22T07:00:00Z | 2026-10-22T09:00:00+02:00 | weekday |
| 2026-10-24T10:00:00+02:00 | 2026-10-24T10:00:00+02:00 | saturday |
| 2026-10-25T10:00:00+01:00 (after DST end) | 2026-10-25T10:00:00+01:00 | sunday |

Fixed, including DST change on Oct 25.

## Weekend preload (was ~4 s cold start)
/health: days [weekday, saturday, sunday], networkLoaded true, dataVersion sl-gtfs-20261103.
First Saturday request: 98 ms round trip (computedMs 43). First Sunday: 73 ms (computedMs 14).
Second test run: sat 292 ms, sun 175 ms. No cold start.

## Colony files (/colony/tomfor/)
| file | status | bytes |
|---|---|---|
| strings.js | 200 | 13573 |
| errors.js | 200 | 2722 |
| search.js | 200 | 3079 |
| mareri-adapter.js | 200 | 6709 |

Live strings.js has no mode.walk key yet (only settings.walkEnd / settings.walkTransfer); expected, PR 31 pending.
Note: /colony/tomfor/ and index.html return 404 (no index page shipped; not in scope here).
