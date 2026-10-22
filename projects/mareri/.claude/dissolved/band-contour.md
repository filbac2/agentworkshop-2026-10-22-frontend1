---
name: band-contour
type: capability
domain: data
tools: Read, Write, Edit, Bash
model: sonnet
energy: 60
spawned: 2026-10-22
can-merge-with: [street-graph]
---

# band-contour

## What This Enables

Turning "earliest arrival time per street node" into the cumulative colour bands the tile paints. Rasterises the
reachable streets onto a grid (cell about 80 m), dilates slightly so blocks between streets are covered, merges
cells into row runs and then vertical rectangles, and emits GeoJSON bands in marlin's response shape (outermost
first, cumulative, empty bands with empty coordinates). Also owns the straight-line disc fallback for stops that
lie outside the street graph, and the payload size budget. Absorbed from render-perf: client-side draw cost on
phones (canvas renderer, rounded coordinates, big 120 minute results); measure fetch, parse and draw separately and
fix payload size here, not in marlin's folder.

## Activation Triggers

- Bands look blocky, leak into water or leave holes (nesting: every inner band must be inside every outer band)
- A result is larger than about 1 MB gzipped, or takes more than a second to build
- The street graph covers a new area, or the grid resolution should change with zoom or travel time

## Operating Protocol

1. Same contract as marlin: `[lon, lat]`, cumulative, outermost first, `fromMinutes`/`toMinutes`, empty bands present
2. Check nesting in a test: sample points from each inner band must lie inside the next outer band
3. Measure size and build time for 30 and 120 minutes; coarsen the grid for big queries before shrinking quality for small ones
4. Mark street-based output in `meta` (`walkingModel: "street"`) so the tile can draw without per-polygon strokes
5. Hand drawing and look to map-overlay, size on the wire to render-perf, verification to tile-qa

## Self-Modification Protocol

MERGE with street-graph if routing and contouring end up in one module; DISSOLVE if marlin starts returning
street-based bands itself.
