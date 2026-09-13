#!/usr/bin/env python3
"""Run Fold Flyer headless: drive frame() at 60 Hz under virtual time, read the JSON status from the title.
usage: headless_run.py [--fold N] [--seconds S] [--autopilot] [--keys 'left:0.5-2.0,boost:1-3'] [--shot out.png --shot-at T]
"""
import argparse, json, os, subprocess, sys, tempfile, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHROME = glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell'))

ap = argparse.ArgumentParser()
ap.add_argument('--fold', type=int, default=0)
ap.add_argument('--seconds', type=float, default=30)
ap.add_argument('--autopilot', action='store_true')
ap.add_argument('--keys', default='')
ap.add_argument('--shot', default='')
ap.add_argument('--shot-at', type=float, default=-1)
ap.add_argument('--tr', action='store_true', help='dump the trench placement counters')
ap.add_argument('--surfprobe', action='store_true', help='dump window.surfProbe()')
ap.add_argument('--audit', action='store_true', help='dump window.flyerAudit() instead of the status')
ap.add_argument('--shot-res', type=int, default=-1, help='freeze and screenshot when the craft reaches this residue index')
ap.add_argument('--size', default='1280,800')
ap.add_argument('--dump-dom', action='store_true')
ap.add_argument('--eval', default='', help='JS to run before the first frame')
ap.add_argument('--draw-all', action='store_true', help='render every frame (slow); default renders only the screenshot frame')
a = ap.parse_args()

# key schedule: name:start-end,...
sched = []
for item in filter(None, a.keys.split(',')):
    name, rng = item.split(':')
    s, e = rng.split('-')
    sched.append((name, float(s), float(e)))

# The SHIPPED shell is tools/bundle_template.html — index.html is a bare dev page with no intro card,
# no brake button and a different touchbar. Testing against index.html means every diagnostic and every
# screenshot describes a page no player ever sees. Build from the template, exactly as bundle.py does.
html = open(os.path.join(ROOT, 'tools', 'bundle_template.html')).read()
inline = ''.join(open(os.path.join(ROOT, js)).read() + '\n'
                 for js in ['parse.js', 'ss.js', 'rail.js', 'cartoon.js', 'gl.js', 'folds.js', 'game.js'])
shot_frame = int(round((a.shot_at if a.shot_at >= 0 else a.seconds) * 60))
total_frames = int(round(a.seconds * 60))
# All of this lands inside the template's single <script>, so it must be plain JS with no script tags.
# The prelude has to run before game.js reads window.__headless.
prelude = """
window.__headless = true; window.MARATHON = false;
window.requestAnimationFrame = function() { return 0; };
(function () { var el = document.getElementById('intro'); if (el) el.hidden = true; })();
"""
driver = f"""
(function() {{
  var N = {total_frames}, SHOT = {shot_frame}, i = 0, SHOT_RES = {a.shot_res}, frozen = false;
  var sched = {json.dumps(sched)};
  {a.eval}
  window.__tr = {'true' if a.tr else 'false'};
  window.loadFoldIndex({a.fold});
  window.setAutopilot({'true' if a.autopilot else 'false'});
  function step() {{
    var t = i / 60;
    for (var k = 0; k < sched.length; k++) {{
      var s = sched[k];
      if (Math.abs(t - s[1]) < 1e-6) window.pressKey(s[0], true);
      if (Math.abs(t - s[2]) < 1e-6) window.pressKey(s[0], false);
    }}
    if (frozen) {{ if (!window.__drewFrozen) {{ window.frame(0, false); window.__drewFrozen = true; }} i++; if (i < N) setTimeout(step, 1000 / 60); return; }} // draw the frozen frame once
    window.frame(1 / 60, {'false' if a.draw_all else 'true'} && (i + 1) !== SHOT && (i + 1) !== N);
    if (SHOT_RES >= 0 && window.flyerStatus().res >= SHOT_RES) frozen = true;
    i++;
    if (i < N) setTimeout(step, 1000 / 60);
    else {{ if ({'true' if a.surfprobe else 'false'}) document.title = JSON.stringify(window.surfProbe()); else if ({'true' if a.audit else 'false'}) document.title = JSON.stringify((window.__tr ? window.TR : window.flyerAudit())); var d = document.createElement('pre'); d.id = 'final'; d.textContent = document.title; document.body.appendChild(d); }}
  }}
  setTimeout(step, 0);
}})();
"""
page = html.replace('/*__GAME__*/', prelude + inline + driver)
tmp = os.path.join(tempfile.gettempdir(), 'flyer_headless_%d_%d.html' % (a.fold, os.getpid()))
open(tmp, 'w').write(page)

if not CHROME:
    sys.exit('no headless_shell found')
budget = int(shot_frame * 1000 / 60 + 500)
cmd = [CHROME[0], '--headless', '--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
       '--window-size=' + a.size, '--virtual-time-budget=%d' % budget]
if a.shot:
    cmd.append('--screenshot=' + a.shot)
if not a.shot or a.dump_dom:
    cmd.append('--dump-dom')
cmd.append('file://' + tmp)
out = subprocess.run(cmd, capture_output=True, text=True, timeout=1500)
os.unlink(tmp)
dom = out.stdout
if a.shot and not a.dump_dom:
    print('screenshot written to', a.shot)
else:
    import re
    m = re.search(r'<title>(.*?)</title>', dom, re.S)
    title = m.group(1) if m else ''
    title = title.replace('&quot;', '"').replace('&amp;', '&')
    try:
        st = json.loads(title)
        co = st.get('camOff') or []
        if co:
            n = len(co)
            for thr in (22, 28, 35):
                st['off%d' % thr] = round(100.0 * sum(1 for x in co if x > thr) / n, 2)
        for key, tag in (('camTurn', 'camTurn'), ('railTurn', 'railTurn'), ('camOff', 'camOff'), ('camRoll', 'camRoll')):
            ct = st.pop(key, None)
            if ct:
                ct.sort(); n = len(ct)
                st[tag + 'Mean'] = round(sum(ct) / n); st[tag + 'P95'] = ct[int(n * 0.95)]; st[tag + 'Max'] = ct[-1]
        print(json.dumps(st))
    except Exception:
        print('TITLE:', title[:500])
        print(out.stderr[-2000:])
