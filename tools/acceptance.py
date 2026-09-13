#!/usr/bin/env python3
"""Acceptance sweep: autopilot on every built-in fold, in parallel.
Passes when each fold finishes, fixed >= MIN_FIXED * total, no error."""
import re
import json, os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
MIN_FIXED = 0.65  # autopilot must graze at least this share of the inward side chains
# +4 s on every fold for the pre-race preview orbit, which costs frames but not run time
# The campaign order lives in folds.js and changes; read it from there rather than restating it, so a
# reorder cannot silently pair one fold's results with another fold's name and time budget.
def campaign_ids():
    src = open(os.path.join(HERE, '..', 'folds.js')).read()
    return re.findall(r'id:"([^"]+)"', src)

SECONDS = {'BUNDLE': 34, '1QJ8': 54, '1AEP': 44, '256B': 29, '2ABD': 29, '1BCF': 44, '1MBN': 39, '1LDG': 92, '1TIM': 69, '1M56': 114}
ids = campaign_ids()
assert set(ids) == set(SECONDS), f'folds.js and SECONDS disagree: {set(ids) ^ set(SECONDS)}'
ORACLE = '--oracle' in sys.argv  # human-limited perfect player at real cruise speed instead of autopilot
t0 = time.time()
# run at most PAR folds at once (each is a Chromium instance); giants are memory-hungry
PAR = 8
def launch(i, fid):
    return subprocess.Popen([sys.executable, os.path.join(HERE, 'headless_run.py'), '--fold', str(i), '--seconds', str(SECONDS[fid]), '--size', '320,200']
                            + (['--eval', 'window.ORACLE=true'] if ORACLE else ['--autopilot']), stdout=subprocess.PIPE, text=True)
procs = []
pending = list(enumerate(ids))
running = []
while pending or running:
    while pending and len(running) < PAR:
        i, fid = pending.pop(0); p = launch(i, fid); procs.append(p); running.append(p)
    time.sleep(0.5)
    running = [p for p in running if p.poll() is None]
ok = True
print(f"{'fold':7} {'time':>6} {'fixed':>9} {'perf':>5} {'miss':>5} {'score':>6}  result")
for fid, p in zip(ids, procs):
    out, _ = p.communicate()
    try:
        st = json.loads(out.strip().splitlines()[-1])
    except Exception:
        print(f'{fid:7} FAIL no status: {out[:200]}'); ok = False; continue
    enough = st['fixed'] >= MIN_FIXED * st['total'] or st['total'] - st['fixed'] <= 3  # tiny folds (3-4 blocks): the spring autopilot may miss a few
    good = st['done'] and enough and not st['err']
    ok &= good
    print(f"{fid:7} {st['t']:6.1f} {st['fixed']:>4}/{st['total']:<4} {st.get('perfect', 0):>5} {st.get('missed', 0):>5} {st['score']:>6}  {'ok' if good else 'FAIL ' + str(st['err'] or '')}")
print(f"{'PASS' if ok else 'FAIL'} in {time.time() - t0:.0f} s")
sys.exit(0 if ok else 1)
