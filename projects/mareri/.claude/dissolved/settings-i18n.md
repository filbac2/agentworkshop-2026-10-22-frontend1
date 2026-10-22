---
name: settings-i18n
type: capability
domain: frontend
tools: Read, Write, Edit
model: sonnet
energy: 80
spawned: 2026-10-22
can-merge-with: [map-overlay]
---

# settings-i18n

## What This Enables

The mobile-first settings panel and the English/Swedish UI: start time (default now), max travel time
(5-120 min, step 5, default 30), max wait (default 7), walking times, transport modes
(bus, metro, tram, train, commuter_rail, boat), max transfers (default 3), and the **Update** button.

## Activation Triggers

- Any form control, layout, responsive or touch-target change
- Adding or fixing a translation string
- Changing a default value from PROJEKT.md

## Operating Protocol

1. All visible text goes through one EN/SV dictionary; language toggle persists in localStorage
2. Touch targets at least 44px, panel becomes a bottom sheet on small screens
3. Defaults exactly as in PROJEKT.md; validate before calling the engine
4. Mode names exactly as in the vijay-team contract

## Self-Modification Protocol

Suggest SPLIT if i18n and form logic diverge; MERGE with map-overlay if they always change together.
