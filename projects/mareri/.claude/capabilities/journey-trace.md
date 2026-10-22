---
name: journey-trace
type: capability
domain: routing-explain
tools: Read, Write, Edit, Bash
model: sonnet
energy: 70
spawned: 2026-10-22
can-merge-with: [street-engine, tile-ui]
---

# journey-trace

## What This Enables

"How did we get there?" for any point under the cursor. Rebuilds the fastest journey the isochrone search found
(walk to a stop, rides, walking transfers, walk to the point) with street geometry and line names:

- `board/plugins/mareri/iso.js`: `search(..., trace)` records an immutable label tree (access, ride, walk) per improvement
- `board/plugins/mareri/journey.js`: picks the best stop plus egress, walks the label chain, merges walk legs,
  adds line names (from vijay-team's connections artifact, aligned to marlin's sorted connections) and street routes
- `POST /t/mareri/journey`: same body as `/isochrone` plus `target`; the traced search is cached per request, so
  hovering costs a few milliseconds
- Tile: debounced hover (long-press on touch), route drawn on its own pane, tooltip with the legs

## Activation Triggers

- A point is coloured but no journey is found (tolerance too tight) or the journey disagrees with the band
- Line names are missing or wrong (artifact and marlin's connection order drifted apart)
- Hover feels slow or flickers, or touch users cannot see the journey

## Operating Protocol

1. The journey must use exactly the isochrone request (same limits, speed, modes) or it will contradict the colours
2. Preserve walking and travel limits exactly; explain that raster boundaries are approximate when no journey fits
3. Escape everything shown: stop and line names go in with textContent, never innerHTML
4. Validate by sampling points inside the bands: nearly all must resolve and the total must match the band
5. Hand look to tile-ui, verification to tile-qa

## Self-Modification Protocol

MERGE with street-engine if the trace becomes part of every search; DISSOLVE if marlin ships a journey endpoint.
