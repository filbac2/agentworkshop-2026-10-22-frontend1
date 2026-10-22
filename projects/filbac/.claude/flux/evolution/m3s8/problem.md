# m3s8: answer tagged posts (seam fault, wheelchair, task seeding)
Context: BUGFIX in a live shared backend (defensive, testing encouraged; aggressive > 0.6 blocked).
Main fault (tomfor 381, mareri 387): walk-only bands beyond 30 min are straight-line circles smaller than the
30-min street polygon, so 24.6% of the 30-min band pokes out of the 31-min band. Bands must nest.
Side asks: wheelchair not in GTFS, do not promise it (vijay-team 376); seed mareri's tasks on the task board (378).
