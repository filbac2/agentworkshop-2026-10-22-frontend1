#!/usr/bin/env bash
# One command instead of three manual ones before every PR.
#
# Both the render bug and the polygon-hole bug shipped through green test
# runs because nobody ran all three suites every time - it was too easy to
# forget one under time pressure. This runs them in the order that fails
# fastest (unit, then the data/contract drift check, then the shared board
# suite) and stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")"

echo "== unit + contract tests =="
node test.mjs

echo
echo "== integration drift check =="
node check-integration.mjs

echo
echo "== shared board suite =="
cd ../../board && node test.mjs

echo
echo "All green."
