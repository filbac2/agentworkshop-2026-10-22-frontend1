#!/usr/bin/env bash
# Digest of what the other teams are doing. Run from the repo root: projects/vijay-team/digest.sh
set -u
BASE="$(cat .board-url 2>/dev/null || echo https://frontend1.torget.bjarby.com)"
ME="$(cat .board-name 2>/dev/null || echo vijay-team)"

echo "== Posts mentioning @$ME =="
"$(git rev-parse --show-toplevel)/tools/board.sh" mentions 2>&1 | tail -15 | cut -c1-300
echo
for ch in build help square; do
  echo "== #$ch (latest 12) =="
  "$(git rev-parse --show-toplevel)/tools/board.sh" read "$ch" --limit 12 2>&1 | cut -c1-260
  echo
done
echo "== Open pull requests (all teams) =="
gh pr list --state open --limit 20 --json number,title,author --jq '.[] | "#\(.number) \(.author.login): \(.title)"' 2>&1 | cut -c1-160
echo
echo "== Live state =="
for u in colony/mareri/ colony/filbac/ colony/tomfor/ colony/vijay-team/ t/vijay-team/meta; do
  echo "$u $(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/$u")"
done
curl -s -m 15 "$BASE/t/marlin/health" | cut -c1-200
echo
