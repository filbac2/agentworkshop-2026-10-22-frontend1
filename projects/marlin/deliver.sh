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
LOG=projects/marlin/.claude/flux/evolution.log
if ! git pull --quiet origin main; then
  # Our own evolution.log is append-only and gets touched by almost every
  # delivery, so a rebase conflict there is near-certain and always harmless:
  # both sides only added lines. Union them and move on. Any other conflicted
  # file is a real one and needs a human, per spore platforms-3 (same symptom:
  # pr.sh stops with a --auto-flag/non-fast-forward message after your own
  # earlier PR merged: git merge --no-ff -X ours origin/main, then check
  # git diff --stat only touches your folders).
  CONFLICTED="$(git diff --name-only --diff-filter=U)"
  if [ "$CONFLICTED" != "$LOG" ]; then
    echo "Conflict outside $LOG - resolve by hand (spore platforms-3)." >&2
    echo "$CONFLICTED" >&2
    exit 1
  fi
  python3 -c "
import re
with open('$LOG') as f:
    c = f.read()
c = re.sub(r'<<<<<<< [^\n]*\n(.*?)\n=======\n(.*?)>>>>>>> [^\n]*\n',
           lambda m: m.group(1) + '\n' + m.group(2), c, flags=re.S)
with open('$LOG', 'w') as f:
    f.write(c)
"
  git add "$LOG"
  git rebase --continue
fi
git push --force-with-lease fork team/marlin 2>&1 | grep -v '^$' || true

echo
echo "== pr.sh =="
tools/pr.sh marlin "$MSG"

