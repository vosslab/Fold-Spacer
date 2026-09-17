#!/usr/bin/env python3
"""Static fairness audit over the whole campaign.

For every inward side chain it checks that a craft flying inside the corridor can actually reach it,
and that the spacing from the previous one is crossable at top cruise speed. For every sheet passage
it checks that a gap wider than the craft exists. Run: python3 tools/fairness.py
"""
import re
import json, math, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
# The campaign order lives in folds.js and changes; read it from there rather than restating it, so a
# reorder cannot silently pair one fold's results with another fold's name and time budget.
def campaign_ids():
    src = open(os.path.join(HERE, '..', 'folds.js')).read()
    return re.findall(r'id:"([^"]+)"', src)

FOLDS = campaign_ids()
CRAFT_R, LAT_ACC, LAT_DAMP = 0.24, 44.0, 3.2
TOUCH_HELIX, TOUCH_TRENCH = 1.25, 2.25   # how far a finger can send the craft on a phone
# The hard requirement is the speed the ramp alone carries you to; a full combo adds more on top and is
# the player's own choice, so needing to ease off for those is a warning, not a failure.
BASE_CRUISE, TOP_CRUISE = 15.0 + 6.0, 15 + 6 + 0.3 * 12
# The fastest a player goes WITHOUT deliberately holding boost. Side chains are PLACED against
# TOP_CRUISE, so any speed source that escapes that ceiling silently un-places them: measured once, an
# uncapped slipstream plus the perfect-kick would have cost 3-9 side chains a fold. The game clamps cruise
# to MAX_CRUISE and this must stay equal to it. A non-zero count in this column means a passive speed
# bonus has escaped the cap, which is a FAILURE, not a matter of taste.
#
# Boost is the deliberate exception: holding it adds BOOST_ADD on top and does go past this, by design.
# The distinction that matters is intent — a player holding boost knows they are flying too fast for the
# next crossing and has chosen to; a slipstream that accrued on its own gives them no such choice.
FLATOUT = TOP_CRUISE
# A cofactor gate is reached MOVING outward, so the craft must null that velocity before it can come back
# to the side chain after it. The from-rest reach formula does not charge for that; this factor does.
# Without it the audit passed a 1BCF gate the oracle then proved unflyable (it dropped residue 58).
COF_SWING = 1.55

def travel(t):                      # lateral distance a player can cover from rest in t seconds
    vt = LAT_ACC / LAT_DAMP
    return vt * (t - (1 - math.exp(-LAT_DAMP * t)) / LAT_DAMP)

def cruise(progress):
    """The speed the ramp carries you to at that point in the fold.

    These mirror BASE_SPEED and RAMP_SPEED in src/game/runtime.js, which is also what buildCofactors uses to decide
    how far out a gate may sit. If they are changed there they must be changed here, or the audit will
    bless gates the game cannot fly and vice versa.
    """
    return 15.0 + 6.0 * max(0.0, min(1.0, progress))

procs = [subprocess.Popen([sys.executable, os.path.join(HERE, 'headless_run.py'), '--fold', str(i),
                           '--seconds', '1', '--size', '320,200', '--audit'],
                          stdout=subprocess.PIPE, text=True) for i in range(len(FOLDS))]
fails, warns = [], []
print(f"{'fold':7} {'chains':>6} {'unreachable':>11} {'band Å':>14} {'no perfect':>10} "
      f"{'off touch':>9} {'must slow':>9} {'flat-out':>8} {'sheets':>6} {'min gap Å':>9} {'cofactors':>9}")
for fid, p in zip(FOLDS, procs):
    out, _ = p.communicate()
    a = json.loads(out.strip().splitlines()[-1])
    h, sh = a['helix'], a['sheet']
    unreachable = [x for x in h if x['lo'] is None]
    noperfect = [x for x in h if x['perfect'] is None]
    bands = sorted(x['band'] for x in h if x['lo'] is not None)
    # consecutive collectables: can a player cross from one aim point to the next in the time available?
    tight, slow, flatout = [], [], []
    order = sorted(h, key=lambda x: x['s'])
    for a1, b1 in zip(order, order[1:]):
        ds = b1['s'] - a1['s']
        if ds <= 0:
            continue
        lateral = math.hypot(b1['aimX'] - a1['aimX'], b1['aimY'] - a1['aimY'])
        v = cruise(b1['s'] / max(1.0, a.get('len', 1)))
        if travel(ds / v) < lateral:
            tight.append((b1['res'], ds, lateral))          # impossible even at base speed: unfair
        elif travel(ds / (v + 0.3 * 12)) < lateral:
            slow.append((b1['res'], ds, lateral))           # possible, but you must not be at full speed
        elif travel(ds / FLATOUT) < lateral:
            flatout.append((b1['res'], ds, lateral))        # lost only if you hold full slipstream through it
    # the nearest position from which it can be touched / perfected must be inside a finger's reach
    far = [x for x in h if x['touchMin'] is None
           or x['touchMin'] > (TOUCH_TRENCH if x['trench'] else TOUCH_HELIX) + 0.02
           or x['perfMin'] is None
           or x['perfMin'] > (TOUCH_TRENCH if x['trench'] else TOUCH_HELIX) + 0.02]
    # --- cofactors: the gate sits out at the corridor edge on the side the cofactor is on, so claiming one
    # means hugging that wall as you pass. It is a bonus, never required, but it must be POSSIBLE: the gate
    # has to be inside the corridor, and the craft has to be able to swing out to it from the side chain
    # before it and back to the side chain after it, at the speed the ramp is carrying it.
    cof = a.get('cof') or []
    cof_bad, cof_tight = [], []
    for c in cof:
        v = cruise(c['s'] / max(1.0, a.get('len', 1)))
        if c['off'] + CRAFT_R > c['lim'] + 1e-6:
            cof_bad.append('%s at s=%.0f sits outside the corridor (gate %.2f + craft %.2f > limit %.2f)'
                           % (c['n'], c['s'], c['off'], CRAFT_R, c['lim']))
            continue
        for label, sOther, aimOther in (('from', c['prevS'], c['prevAim']), ('to', c['nextS'], c['nextAim'])):
            if sOther is None or aimOther is None:
                continue
            ds = abs(c['s'] - sOther)
            lateral = math.hypot(c['gate'][0] - aimOther[0], c['gate'][1] - aimOther[1])
            # the catch radius is generous, so the craft need only get within r of the gate
            need = max(0.0, lateral - c['r']) * COF_SWING
            if ds > 0 and travel(ds / v) < need:
                cof_tight.append('%s at s=%.0f: %s the side chain %.1f A away needs %.2f A across'
                                 % (c['n'], c['s'], label, ds, need))
    for i in range(len(cof)):
        for j in range(i + 1, len(cof)):
            if abs(cof[i]['s'] - cof[j]['s']) < 9.0 - 1e-6:
                cof_bad.append('%s and %s are %.1f A apart on the rail - both cannot be flown'
                               % (cof[i]['n'], cof[j]['n'], abs(cof[i]['s'] - cof[j]['s'])))
    gaps = sorted(x['clear'] for x in sh)
    ming = gaps[0] if gaps else None
    print(f"{fid:7} {len(h):>6} {len(unreachable):>11} "
          f"{(str(bands[0]) + '–' + str(bands[-1])) if bands else '-':>14} {len(noperfect):>10} "
          f"{len(far):>9} {len(slow):>9} {len(flatout):>8} {len(sh):>6} {('%.2f' % ming) if ming is not None else '-':>9} "
          f"{(('%d ok' % len(cof)) if cof and not cof_bad and not cof_tight else ('%d BAD' % len(cof)) if cof else '-'):>9}")
    if unreachable:
        fails.append(f"{fid}: {len(unreachable)} side chains cannot be reached inside the corridor: "
                     + ', '.join(str(x['res']) for x in unreachable[:6]))
    if ming is not None and ming < CRAFT_R:
        fails.append(f"{fid}: a sheet passage has no gap for the craft (widest clearance {ming:.2f} Å < {CRAFT_R} Å)")
    if far:
        fails.append(f"{fid}: {len(far)} side chains lie beyond a finger's reach on a phone: "
                     + ', '.join(str(x['res']) for x in far[:6]))
    for m in cof_bad:
        fails.append(f"{fid}: cofactor {m}")
    for m in cof_tight:
        fails.append(f"{fid}: cofactor {m}")
    if flatout:
        fails.append(f"{fid}: {len(flatout)} side chains unreachable at the game's own top speed — a speed "
                     f"bonus has escaped the MAX_CRUISE cap: "
                     + ', '.join('res %d' % t[0] for t in flatout[:6]))
    if noperfect:
        warns.append(f"{fid}: {len(noperfect)} side chains cannot be passed through the middle (no perfect)")
    if tight:
        fails.append(f"{fid}: {len(tight)} side chains cannot be reached at the speed the ramp carries you: "
                     + ', '.join('res %d (%.1f Å apart, %.1f Å across)' % t for t in tight[:4]))
print()
for w in warns:
    print('warn ', w)
for f in fails:
    print('FAIL ', f)
print('\n' + ('FAIR: every side chain reachable at the speed you actually fly, every sheet passable,\n'
              '      every cofactor gate inside the corridor and swingable from the side chains either side'
              if not fails else 'UNFAIR'))
sys.exit(1 if fails else 0)
