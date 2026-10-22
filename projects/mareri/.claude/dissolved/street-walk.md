---
name: street-walk
type: capability
domain: integration
tools: Read, Write, Edit, Bash, WebFetch
model: sonnet
energy: 5
dissolved: 2026-10-22
spawned: 2026-10-22
can-merge-with: [engine-client]
---

# street-walk

Dissolved: the street engine now owns walking; the Valhalla outline remains only as a code fallback.

## What This Enables

Walking times that come from a real street network instead of straight-line circles. Marlin's engine models every
walk as a disc at 4.8 km/h, so rivers, rail yards and missing paths are ignored. This capability owns
`board/plugins/mareri/index.js` (`GET /t/mareri/walk`, Valhalla pedestrian isochrone over OSM data, cached and
rate-limited) and the dashed walking outline the tile draws around the pin.

## Activation Triggers

- Anyone questions walking distances or access/egress/transfer areas
- Marlin changes how it computes walking, or offers a street-based option
- The public router (valhalla1.openstreetmap.de) is slow, down or changes its API

## Operating Protocol

1. Keep the plugin small: validate input, cache, one call per 250 ms, clear EN/SV errors, never throw outside `handle`
2. The tile treats the layer as optional: if the router fails, the isochrone stays valid and nothing is shown
3. Engine-side street walking (egress from final stops, transfers) belongs to marlin: ask `@marlin` in `#build`
   with concrete numbers instead of changing their folder
4. Use the same walking speed as the engine request (4.8 km/h) so the outline and the bands agree
5. Hand verification to tile-qa: compare the outline with the engine's access disc at the same minutes

## Self-Modification Protocol

MERGE with engine-client if marlin adopts street walking and this shrinks to a thin client; DISSOLVE if the
router is unreliable and the layer shows nothing on most runs.
