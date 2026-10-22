---
name: map-overlay
type: capability
domain: frontend
tools: Read, Write, Edit, Bash
model: sonnet
energy: 80
spawned: 2026-10-22
can-merge-with: [tile-ui]
---

# map-overlay

## What This Enables

The Leaflet + OpenStreetMap map centered on Stockholm: pan/zoom on desktop and touch, a draggable origin pin
(tap to place), and rendering the isochrone GeoJSON as 5-minute color bands with a legend.
Lives in `board/public/colony/mareri/`.

## Activation Triggers

- Map, pin, tiles, zoom, touch behaviour
- Drawing or restyling the isochrone bands and legend
- Performance of rendering large MultiPolygons

## Operating Protocol

1. Static files only (no build step), same-origin, relative URLs (the tile is served under /colony/mareri/)
2. Band colors: sequential, readable over OSM tiles, semi-transparent; legend from `from_min`/`to_min`
3. Pin position is the single source of truth for the origin
4. Respect OSM tile usage policy (attribution, no bulk loading)

## Self-Modification Protocol

Suggest SPLIT if rendering and interaction grow into separate concerns; MERGE with settings-i18n if they
always change together.
