# mareri PR 26: pre-release check prep (2026-10-22 11:5x)

Status: **PR 26 not live** (POST /t/mareri/journey -> 404, no `meta[name=colony]`). All PR-26 checks SKIP; nothing already live is broken.

## How to run the minute it is live

```
npm run e2e:pr26                                  # browser checks, tests/e2e/pr26-run.json, tests/screenshots/pr26-*.png
ONLY=share-hash-45,share-hash-water npm run e2e:links   # share-link hashes from links.txt
node tests/live.test.js                           # /t/mareri/isochrone + /t/mareri/journey contract
```

"Live" = meta tag present or /journey not 404; after that a missing feature is a FAIL, not a SKIP.

## Results now (prep run)

| Check | Viewport | Result | Seen today |
|---|---|---|---|
| meta colony=group-app | desktop | SKIP | no meta tag |
| slider aria-valuetext "30 min" -> "45 min" | desktop | SKIP | attribute absent |
| focus ring on Tab (29 stops) | desktop | SKIP | 16/29 without ring: start-time, number inputs, checkboxes |
| error region role=alert (engine call aborted) | desktop | SKIP | #status role=status aria-live=polite, class error |
| SV copy: Beräkningstjänsten, no Isokronmotorn | desktop | SKIP | "Isokronmotorn är inte tillgänglig ännu." |
| all controls >= 44x44 at 390px | phone | SKIP | 13 below: pin 36x44, zoom 40x40, sheet toggle 356x30, EN/SV 40x36, slider 356x36, mode chips x38 |
| dvh units in CSS | phone | SKIP | none |
| share link: pin+settings+modes restore in fresh page | desktop | SKIP | no location.hash after Update |
| share link: language restores | desktop | SKIP | no hash |
| links.txt share-hash-45, share-hash-water | both | SKIP x4 | app ignores hash |
| links.txt existing 5 links | both | 10 PASS | unchanged |
| live.test.js mareri /isochrone, /journey | api | skipped (404) | vijay-team + marlin: 60 PASS, 0 fail |

## Expected FAILs once live (read from the PR 26 diff, not yet observed)

- **share-link-lang**: the hash holds `ll,t,w,x,d,r,m` only; language stays in localStorage, so a fresh browser opens in English.
- **error-role-alert**: diff keeps `#status role="status" aria-live="polite"`; no role=alert added.
- **sv-copy**: diff replaces Isokronmotorn with "Restidsberäkningen", not "Beräkningstjänsten". Isokronmotorn-free part will pass.
- **touch-targets**: diff raises zoom, chips, EN/SV, sheet toggle to 44px; the pin marker (36x44) is not changed in the diff.

## Changes made for this prep

- `tests/e2e/pr26.js` + `npm run e2e:pr26` (new).
- `tests/e2e/links-runner.js`: reads share state from the URL hash (`ll`, `t`, `m`, `lang`), keeps the hash in the URL it opens, `needs=hash` marks a link SKIP while the app ignores the hash; SKIP count in summary.
- `tests/e2e/links.txt`: 2 share-hash links.
- `tests/live.test.js`: `mareri-journey` block (200 shape, 400 bad target, 404 not_reachable, GET 405), skips on route 404.
