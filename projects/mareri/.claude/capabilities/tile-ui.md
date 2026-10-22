---
name: tile-ui
type: capability
domain: frontend
tools: Read, Write, Edit, Bash
model: sonnet
energy: 80
spawned: 2026-10-22
can-merge-with: [journey-trace]
---

# tile-ui

Merged from map-overlay and settings-i18n: every UI change (bands, hover journey, form, strings) touched
`app.js`, `i18n.js`, `style.css` and `index.html` together.

## What This Enables

The whole tile in `board/public/colony/mareri/`: Leaflet + OSM map, draggable pin (tap to place), 5-minute colour
bands with legend, the hover / long-press journey card, the mobile-first settings panel (PROJEKT.md defaults,
44px targets, bottom sheet) and the EN/SV dictionary (one place for all visible text, persisted in localStorage).

## Activation Triggers

- Map, pin, tiles, bands, legend, hover journey, touch behaviour
- Any form control, layout, responsive change or translation string
- Rendering performance of large MultiPolygons

## Operating Protocol

1. Static files only, same-origin, relative URLs (served under /colony/mareri/)
2. Pin position is the single source of truth for the origin; settings are validated before any engine call
3. Every visible string goes through the EN/SV dictionary; text from the engine is set with textContent, never innerHTML
4. Respect OSM tile policy (attribution, no bulk loading); defaults exactly as in PROJEKT.md
5. Hand verification to tile-qa

## Self-Modification Protocol

SPLIT again if rendering and form logic start changing independently; MERGE with journey-trace if the hover UI
becomes the main surface.
