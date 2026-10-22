# marlin — isochrone engine

Our module in the group's project: the backend that turns a pin on the map into
time-banded reachable areas for Stockholm public transport.

- **The contract** others build against: [`CONTRACT.md`](CONTRACT.md).
- **The code**: `board/plugins/marlin/`, mounted at `/t/marlin/`.
- **A tile to see it working**: `board/public/colony/marlin/`, served at `/colony/marlin/`.
  mareri owns the group's real frontend; this tile is a console for our engine.

## How it works

`isochrone.js` runs a round-based connection scan. Round *k* holds the earliest arrival
at every stop using at most *k* transit legs, so the user's **maximum number of
connections** is the loop bound rather than a filter applied at the end. Inside a round
the scan walks one globally sorted connection array once, from the first departure at or
after the start time until the travel budget runs out.

`bands.js` turns arrival times into colour bands. A point *d* metres from a stop reached
at travel time *t* is itself reachable in *t + d / walkSpeed*, so the area within a band
edge *B* is the union of discs of radius *(B − t) · walkSpeed* around every stop with
*t ≤ B*, capped by the egress walking limit. The bands are cumulative and come back
outermost first: paint them in order and the nearer bands cover the farther ones, which
gives the ring picture without computing a single polygon union.

Discs fully inside a disc already kept are dropped through a coarse grid, which keeps the
response small without changing the shape.

## Data

The engine never calls Trafiklab. It loads preprocessed files once, at startup, from
`<dataDir>/network/` — the artifacts vijay-team produce from the SL GTFS zip. The formats
are in `CONTRACT.md`.

Until those files exist, `fixture.js` builds a synthetic Stockholm network: seven real
lines with realistic geography and headways. `/t/marlin/health` reports
`source: "fixture"` or `source: "gtfs"`, so the tile and the group's frontend can warn
about test data. Nothing else changes when the real data arrives.

## Tests

```bash
projects/marlin/verify.sh                  # all three suites, stops at the first failure
projects/marlin/deliver.sh "one line"      # verify, then sync/realign/pr.sh in one step
```

or run them separately:

```bash
node projects/marlin/test.mjs              # 37 tests: algorithm, bands, contract, HTTP surface
node projects/marlin/check-integration.mjs # drift check, run before every PR
node board/test.mjs                        # the shared board suite, must stay green
```

The interesting ones are the invariants: more travel time or more transfers must never
reach *fewer* stops, arrivals must stay inside the budget, every band must be present
even when empty, a 120-minute query must stay well under a second, and a band's
polygon must actually cover every stop it claims to reach (the 254-violation bug
vijay-team found was exactly this guarantee breaking).

### Why there are two suites

`test.mjs` asks whether we are consistent with ourselves. It passed through every
defect we shipped today, because all but one came from a boundary with another
team: vijay-team renamed a folder and we silently served a 39-stop fixture, three
teams sent three field spellings, a two-hour answer was 29 MB.

`check-integration.mjs` asks the opposite question. It asserts we are on real data
(6038 stops, not 39), that all three teams' field spellings give an identical
answer, that errors still carry mareri's vocabulary, that two hours still fits on
a phone, and that we are within 15% of vijay-team's own independent reference
numbers. Run it before every PR.

## Local run

```bash
PLUGINS_DIR=board/plugins node board/server.js
# then open /colony/marlin/
```
