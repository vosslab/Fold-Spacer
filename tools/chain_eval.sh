#!/usr/bin/env bash
# Whole-campaign check: autopilot from the bundle through to the last fold, in one run.
# Two things this wrapper exists to get right:
#  - the eval must be ONE line, and chain_eval.js's comment can only be stripped by a real parser: a sed
#    line range stops early, because any text describing the strip itself contains a block terminator;
#  - the reporter reads the run's JSON from a PIPE, so it cannot also be fed by a heredoc.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT=$(python3 -c "
import re, sys
s = open(sys.argv[1]).read()
print(' '.join(re.sub(r'/\*.*?\*' + r'/', '', s, flags=re.S).split()))
" "$HERE/chain_eval.js")
python3 "$HERE/headless_run.py" --fold 0 --seconds "${CHAIN_SECONDS:-620}" --autopilot \
  --eval "$SCRIPT" --size 390,760 2>/dev/null | tail -1 | python3 -c "
import json, sys
rows = (json.loads(sys.stdin.read()).get('chain') or [])
if not rows:
    print('FAIL: no folds logged'); sys.exit(1)
print('%-7s %-8s %-5s %8s %10s' % ('fold', 'fixed', 'rank', 'time', 'score'))
tot = fixed = 0
for f, fx, rk, t, sc, rf in rows:
    a, b = fx.split('/'); fixed += int(a); tot += int(b)
    print('%-7s %-8s %-5s %7.1fs %10s' % (f, fx, rk, t, sc))
print('---  %d folds, %d/%d side chains, %s points, %.1f min of flying'
      % (len(rows), fixed, tot, rows[-1][4], sum(r[3] for r in rows) / 60))
if len(rows) != 10:
    print('FAIL: expected 10 folds, logged %d' % len(rows)); sys.exit(1)
if len({(r[3], r[4]) for r in rows}) < len(rows):
    print('FAIL: folds share a time and score - the harness is not waiting for each fold to run'); sys.exit(1)
if len({r[0] for r in rows}) != 10:
    print('FAIL: a fold was logged twice'); sys.exit(1)
print('PASS: the whole campaign plays through, ranks spread %s' % '/'.join(sorted({r[2] for r in rows})))
"
