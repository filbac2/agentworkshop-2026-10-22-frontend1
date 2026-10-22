#!/usr/bin/env bash
# Deliver: verify, then realign the fork branch and open/update the PR.
#
# tools/pr.sh fails with "non-fast-forward" every time a previous PR has
# already merged, because team/marlin on the fork still points at the old
# merged tip. The fix is always the same two commands; this just runs them
# so nobody has to remember the dance or debug the error message again.
#
# Usage: projects/marlin/deliver.sh "one line about what changed"
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

MSG="${1:?Usage: deliver.sh \"one line about what changed\"}"

echo "== verify =="
projects/marlin/verify.sh

echo
echo "== sync and realign fork branch =="
git pull --quiet origin main
git push --force-with-lease fork team/marlin 2>&1 | grep -v '^$' || true

echo
echo "== pr.sh =="
tools/pr.sh marlin "$MSG"
