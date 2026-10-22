#!/usr/bin/env bash
# Usage: projects/vijay-team/refresh.sh   (from anywhere in the repo)
# Downloads the organisers' hosted SL GTFS zip (not Trafiklab, its download quota is shared), rebuilds the artifacts
# in board/plugins/vijay-team/artifacts/ and validates them. Then deliver with tools/pr.sh vijay-team "<what>".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URL="${GTFS_URL:-https://frontend1.torget.bjarby.com/data/sl-gtfs.zip}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "-> downloading $URL"
curl -sSfL -o "$TMP/sl.zip" "$URL"
unzip -oq "$TMP/sl.zip" -d "$TMP/gtfs"
echo "-> feed: $(tail -n 1 "$TMP/gtfs/feed_info.txt" | cut -d, -f5)"

node "$ROOT/projects/vijay-team/preprocess.js" "$TMP/gtfs" "$ROOT/board/plugins/vijay-team/artifacts"
node "$ROOT/projects/vijay-team/preprocess-shapes.js" "$TMP/gtfs" "$ROOT/board/plugins/vijay-team/artifacts"
node "$ROOT/projects/vijay-team/preprocess-feed.js" "$TMP/gtfs" "$ROOT/board/plugins/vijay-team/artifacts"
node "$ROOT/projects/vijay-team/check.js"
echo "Done. Deliver: tools/pr.sh vijay-team \"Refresh SL data\""
