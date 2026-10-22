# Group acceptance test: /colony/mareri/ against PROJEKT.md

Run 2026-10-22 10:57 (Stockholm) against https://frontend1.torget.bjarby.com/colony/mareri/, real headless Chromium
(Playwright). Phone = 390x844, touch, mobile UA (pan by touch drag, zoom by two-finger pinch via CDP touch events).
Desktop = 1280x800, mouse (drag, wheel). Script: `tests/e2e/acceptance.js`, raw evidence per check:
`tests/e2e/acceptance-run.json`. Repro from `projects/tomfor`: `npm i && npm run e2e:install && npm run e2e:acceptance`.
The script was run 4 times while it was written; verdicts were identical in every run.

## Verdict

| # | Requirement (PROJEKT.md) | Phone 390 | Desktop 1280 | Evidence (short) |
|---|---|---|---|---|
| R1 | OSM map, Stockholm, pan + zoom | PASS | PASS | All loaded tiles from tile.openstreetmap.org; centre 59.3293, 18.0686 z11; touch drag / mouse drag pans; pinch / wheel zoom 11 -> 13; zoom buttons work |
| R2 | Set and move the pin | PASS | PASS | Tap/click sets pin and the Origin line; dragging the pin (touch and mouse) moves it, Origin text and next request follow |
| R3 | Start time defaults to now | PASS | PASS | datetime-local = load time (0.1-1.0 min diff), browser TZ Europe/Stockholm |
| R4 | Max travel 5-120, step 5, default 30 | PASS | PASS | range min 5 max 120 step 5 value 30; 33 snaps to 35, 500 clamps to 120; label "120 min" |
| R5 | Max wait default 7 | PASS | PASS | number input 7 (0-60) |
| R6 | Walking: to destination + between stations | PASS | PASS | "Walk to destination (min)" 10, "Walk between stops (min)" 5; changed to 6/3 -> request walking access 6, egress 6, transfer 3 |
| R7 | Transport type filters | PASS | PASS | 6 chips (bus, metro, tram, train, commuter rail, boat), all on; unchecking bus removes it from the POST |
| R8 | Max transfers default 3 | PASS | PASS | number input 3 (0-8) |
| R9 | Update recalculates | PASS | PASS | 30 min -> 6 bands; set 15 min, no bus, walk 6/3, Update -> new POST with exactly those values -> 3 bands |
| R10 | 5-min colour bands + legend | PASS | PARTIAL | 6 bands, 6 distinct colours, legend segments titled 0-5 ... 25-30 min. Desktop: legend top at 838 px in an 800 px viewport, needs a panel scroll. Visible legend scale is 0 / 15 / 30 only (per-band ranges are tooltips) |
| R11 | Rendered within a couple of seconds | PASS | PASS | Click -> overlay drawn, 30 min: phone 94-116 ms; desktop median 66-78 ms (3 runs each); 60 min 111-372 ms |
| R12 | Trafiklab cached / preprocessed | PASS | PASS | Engine meta source gtfs, dataVersion sl-gtfs-20261103, computedMs 8-16; browser contacts only the colony host, unpkg.com, tile.openstreetmap.org (backend not browser-verifiable beyond this) |
| R13 | Responsive, touch-friendly | PARTIAL | PARTIAL | No horizontal overflow. Under 44 px: mode chips 38 px high, EN/SV 40x36, zoom +/- 40x40, slider 36 px, sheet toggle 356x30 (phone) |
| R14 | Clean, modern, efficient UI | not scored | not scored | Subjective; see screenshots |
| R15 | English and Swedish | PASS | PASS | SV: Uppdatera, html lang sv, Starttid, Maximal restid, Trafikslag, Buss/Tunnelbana/Spårvagn/Tåg/Pendeltåg/Båt, legend Restid (min); back to EN; choice kept after reload |
| R16a | Clear error: API failure (route-blocked /t/marlin) | PARTIAL | PARTIAL | Text is clear: abort -> "Could not reach the server. Check your connection and try again."; 503 -> "The isochrone engine is not available yet..."; 500 -> "Something went wrong (HTTP 500)." BUT the message is out of view after Update on both viewports |
| R16b | Clear error: no routes | PARTIAL | PARTIAL | Pin in open water (real engine 422) -> "No stop within walking distance of the pin. Move the pin or allow a longer walk."; mocked 200 with 0 features -> "The engine returned no areas. Try other settings." Same out-of-view problem |
| R16c | Clear error: options too restrictive | PARTIAL | PARTIAL | 5 min, wait 0, transfers 0, walk 0/0, boat only -> the no-stop message, not a too-restrictive one; with walk 10/5 it draws a walk-only area with "Done" and no hint. Client checks are clear: no modes -> "Select at least one transport type.", wait 999 -> "Check the numbers: Max wait (min) is out of range." |
| R17 | Console / network health | PASS | PASS | 0 console errors apart from the failures the test injected (abort, 503, 500, 422) |

Summary: 13 of 17 scored rows PASS on phone, 12 on desktop; no FAIL. Every functional requirement works. What
keeps the rest PARTIAL is visibility of feedback (errors, desktop legend), touch target sizes, and no dedicated
too-restrictive message.

## New findings in this run (not in #build before)

1. **Error and status messages are out of view after Update** (phone and desktop). `#status` sits under the form.
   Desktop 1280x800: below the fold of the panel, the user clicks Update and sees nothing change
   (`acc-desktop-api-blocked.png`). Phone: on an error the sheet does not collapse and the message sits under the
   sticky Update button (`acc-phone-no-routes.png`). Suggested: move `#status` above the Update button or make it a
   toast over the map, and `scrollIntoView` on error.
2. **Desktop legend below the fold** at 1280x800 (top 838 px). Same root cause as 1: legend and status come after
   the form in the panel.
3. **Touch targets after the redesign:** mode chips 38 px high (were 44 before PR 18), EN/SV 40x36, zoom +/- 40x40.
4. Restrictive settings that still leave a walk-only area show "Done" with no hint (e.g. boat only, 5 min, 0
   transfers). Could say "Only walking distance reachable, try more transport types or time" when
   meta.stopsReached is small. Could be better, not broken.
5. Engine, minor, does not affect mareri: `meta.startTime` echoes a wrong offset when the request has seconds and
   milliseconds, e.g. startTime 2026-10-22T08:54:37.123Z -> "2026-10-22T10:54:00+01:59" (with :00 seconds it is
   +02:00). mareri sends whole minutes, so the demo is not affected.

Already reported in #build and still seen (not re-reported): "Done in 0.0 s." status (184), the old overlay stays
on the map after a client-side error (184; here 2 layers stay after "Select at least one transport type."),
raw HTTP status in the generic error (177), sheet toggle 30 px (164), engine gives no too-restrictive message (110).

## Screenshots (`tests/screenshots/`)

- `acc-phone-result.png`: phone after Update, bands + legend, sheet collapsed
- `acc-desktop-result.png`: desktop after Update (legend below the panel fold)
- `acc-phone-sv.png`: phone in Swedish
- `acc-desktop-api-blocked.png`: /t/marlin blocked, the error message is not visible
- `acc-phone-no-routes.png`: pin in open water, message hidden under the sticky Update
- `acc-desktop-too-restrictive.png`: restrictive settings

## Not tested

Real iOS Safari / Android (Chromium emulation only), slow 3G, request timeout (20 s), address search (not in
mareri yet), screen readers, keyboard-only use, dark mode, the backend's Trafiklab caching beyond what the meta
says.
