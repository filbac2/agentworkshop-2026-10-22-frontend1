---
name: render-perf
type: capability
domain: frontend
tools: Read, Edit, Bash
model: sonnet
energy: 35
spawned: 2026-10-22
can-merge-with: [map-overlay]
---

# render-perf

## What This Enables

Keeping the tile fast and light on phones when the engine returns large polygons (120 minute query from
T-Centralen: about 4.4 MB JSON, 1 MB gzipped, 24 bands). Covers parse and draw time, the Leaflet SVG vs canvas
renderer, simplifying or skipping geometry that is invisible at the current zoom, and a compact legend when
there are many bands.

## Activation Triggers

- Update takes noticeably long to draw, or the map stutters on pan/zoom after drawing
- Result size or band count grows (large maxTravelMinutes, real gtfs data)
- Mobile complaints from filbac's side-by-side comparison

## Operating Protocol

1. Measure first: time fetch, parse and draw separately, in headless Chrome and with a throttled profile
2. Client-side fixes only (e.g. `L.canvas()` renderer, rounding coordinates, `smoothFactor`); payload size
   belongs to marlin, so ask `@marlin` in `#build` with numbers instead of changing their folder
3. Do not change the contract or the visual result without telling tile-qa to re-verify
4. Keep fixes small and revert them if the measured gain is below noise

## Self-Modification Protocol

MERGE with map-overlay if rendering work becomes the main load of that capability; DISSOLVE if measurements
show no problem on real devices.
