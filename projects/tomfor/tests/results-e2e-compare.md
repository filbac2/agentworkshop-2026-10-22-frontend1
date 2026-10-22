# Real-browser comparison: /colony/mareri/ vs /colony/filbac/

Run 2026-10-22 ~10:41 (Stockholm time) against https://frontend1.torget.bjarby.com, headless Chromium via Playwright
(browser actually ran). Phone = 390x844, touch, mobile UA. Desktop = 1280x800, mouse. Pin set by a real click/tap on
the map at T-Centralen (59.3313, 18.0593). Raw data: `tests/e2e/last-run.json`. Repro from `projects/tomfor`:
`npm i && npm run e2e:install && npm run e2e`. Static checklist for the same apps: `tests/results-compare.md`.

Note: mareri announced PR 18 (visual redesign) and filbac a sticky Update button at 10:33-10:34. This run measures
what was live at 10:41; if those were not deployed yet, rows marked (*) may change.

## Group decision and mareri fix list

The group converged in #build 166-167: /colony/mareri is the one map app. New findings for mareri from this run
(items already in #build 164/166/177 are left out: sheet toggle 44 px + aria-label, 60vh sheet, sticky Update,
transfers 10 vs 8, time zone, stub label, SV wording, hard-coded aria-labels):

1. Stale overlay on client-side error: with all modes off, Update shows "Select at least one transport type." but the
   previous 6 bands stay on the map, so the map and the message disagree. Clear the overlay (or dim it) on error.
2. Leaflet zoom +/- are 30x30 px on phone (below 44). E.g. a CSS rule on .leaflet-touch .leaflet-bar a to 44x44.
3. Status after Update reads "Done in 0.0 s." on phone while click-to-overlay was 93 ms; show ms or drop the line.

Verified fine on mareri: 0 console errors and 0 failed requests on both viewports, tap/click sets the pin, Update
200 with 6 bands drawn in 68-434 ms, legend visible after Update, EN/SV/EN switch (button, legend, html lang),
no horizontal overflow, mode checkboxes have 44 px hit areas, the sheet collapses after Update on phone so the map
shows, 422 in open water shows "No stop within walking distance of the pin. Move the pin or allow a longer walk."

## Matrix

| Check | mareri phone | mareri desktop | filbac phone | filbac desktop |
|---|---|---|---|---|
| Page loads, console errors | 0 errors, 0 failed requests | 0 / 0 | 0 / 0 | 0 / 0 |
| Pin by click/tap near T-Centralen | yes (sheet covers centre, map panned; pin 59.3321, 18.0629, ~250 m off) | yes (59.3314, 18.0595) | yes (59.3314, 18.0595) | yes (59.3314, 18.0595) |
| Update -> marlin status | 200 | 200 | 200 | 200 |
| Click -> overlay drawn, ms (runs) | 93 | 434 / 74 / 68 (median 74) | 572 | 774 / 287 / 77 (median 287) |
| Overlay | 6 band layers | 6 | 6 | 6 |
| Legend visible after Update | yes, "Travel time (min) 0–5 … 25–30" | yes | yes, "Travel time 0–5 … 25–30" | yes |
| EN -> SV -> EN | works (Uppdatera, legend Restid, html lang sv) | works | works (via select) | works |
| Update visible at load without scrolling (*) | no: inside sheet, needs panel scroll (top 966 px, viewport 844) | yes (top 632) | no: below the fold of the panel (top 1305 px) | no: needs panel scroll (top 866, viewport 800) |
| After Update on phone | sheet collapses, map + legend shown, sheet toggle to reopen | - | map stays at top, panel scrolled to Update, legend under the button | - |
| Touch targets < 44 px (own UI) | sheet toggle 358x28 | none | 5 range sliders 32 px high | 5 range sliders 32 px high |
| Touch targets < 44 px (Leaflet default) | zoom +/- 30x30, marker 25x41 | same | zoom +/- 30x30 | same |
| Mode checkboxes (label hit area) | pass | pass | pass | pass |
| Horizontal overflow | none | none | none | none |
| Error: all modes off + Update | no request sent; "Select at least one transport type." in view | same | same text, in view | same |
| Old overlay after that error | stays on map (6 layers) | stays | stays | stays |
| Error: pin in open water (59.27, 18.62) | - | 422; "No stop within walking distance of the pin. Move the pin or allow a longer walk." | - | 422; "No stop or station within walking distance. Allow more walking, more transport types or more connections, or move the pin closer to a stop." |

Timing: in an earlier run 2 minutes before, the same desktop steps gave mareri 127/67/86 ms and filbac 81/64/75 ms,
filbac phone 96 ms. Both apps are well under 1 s in every run; the first click after load is the slowest and the
difference between the apps is within run-to-run noise.

## Observations (facts, not verdicts)

- Broken: nothing observed in either app. Both do the full flow on phone and desktop with no console errors.
- Both draw the bands as many overlapping circles (see screenshots); this is the shape marlin sends, raised in #build 138/146.
- mareri: on phone the settings live in a bottom sheet that collapses after Update so the map is visible; the sheet
  toggle is 28 px high. Desktop Update is in view at load.
- filbac: on phone and at 1280x800 the Update button is below the visible part of the settings panel at load; the
  five range sliders are 32 px high. Engine error text gives more hints (walk, modes, connections).
- Neither clears the previous overlay when a client-side error is shown.

## Our own demo /colony/tomfor/

Loads on phone and desktop with 0 console errors, no horizontal overflow, all targets >= 44 px, SV switch works
(heading, legend, modes, search). One nit: the "Errors" section heading of the demo buttons stays English in SV.

## Screenshots (`tests/screenshots/`)

mareri-phone-result, mareri-desktop-result, mareri-desktop-nostops, filbac-phone-result, filbac-desktop-result,
filbac-desktop-nostops, tomfor-phone.

## Not tested

Offline / aborted request, geolocation, address search, drag of the pin, dark mode, real iOS Safari or Android
(Chromium emulation only), screen readers.
