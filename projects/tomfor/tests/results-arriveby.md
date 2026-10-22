# marlin arrive-by (PR 39, CONTRACT v1.3) - live check 2026-10-22 ~11:57

Run: `PERF=1 node tests/live.test.js` (perf block only runs with PERF=1).

## Result: 0 failures, arrive-by NOT live yet -> SKIP
- POST /t/marlin/isochrone with `arriveBy: true` returned 200 but `meta.arriveBy` is missing and
  `meta.startTime` is echoed (v1.2 behaviour): flag ignored. PR 39 is still OPEN.
- Existing vijay-team + marlin v1.2 contract checks all PASS (60). mareri /isochrone and /journey still 404 (PR 26 open).

## New cases in tests/live.test.js (`marlinArriveBy`), active once meta.arriveBy === true
- 200, FeatureCollection, 6 bands, outermost first, bandIndex 6..1, MultiPolygon, outermost band non-empty
- meta.arriveBy === true, meta.deadline === '2026-10-22T09:00:00+02:00', meta.startTime absent, budget/bandMinutes/cumulativeBands
- bands nested: band stop counts non-increasing inward
- A/B: same origin + 09:00, depart-at vs arrive-by features must differ, depart-at has no arriveBy:true
- `deadline` alias accepted and echoed
- arriveBy `"false"`, `"yes"`, `1` -> 400 bad_request

## Expected failure once live (pre-merge read of PR 39 diff)
`parseRequest` does `const arriveBy = !!pick(input, ['arriveBy','arrive_by'])`, so any truthy non-boolean
is accepted - notably `arriveBy: "false"` would run an arrive-by search. Expect the 3 bad-type cases to FAIL
(200 instead of 400). Report to @marlin only after it is live and observed.

## 120 min latency (origin 59.3303,18.0586, 09:00, defaults), 3 sequential runs
| run | status | ms | size | meta.computedMs |
|---|---|---|---|---|
| 1 | 200 | 2721 | 4.9 MB | 445 |
| 2 | 200 | 1047 | 4.9 MB | 445 |
| 3 | 200 | 1354 | 4.9 MB | 445 |

Median 1354 ms. Much better than vijay-team's 12-27 s at 11:50 (#402), and under the 3.7 s p50 from 11:25.
Identical computedMs suggests a cached response; wall time is mostly transfer of 4.9 MB. Not posted (vijay-team already reported).
