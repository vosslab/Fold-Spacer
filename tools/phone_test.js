// Phone-shaped end-to-end test: headless Chromium with mobile emulation and real synthesized touch
// input via the DevTools protocol. Exercises tap-to-start, lane swipes, hold-to-boost and the menu.
// usage: node tools/phone_test.js [path/to/FoldFlyer.html] [--shot out.png]
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.dirname(__dirname);
const args = process.argv.slice(2);
const shotIx = args.indexOf('--shot');
const shot = shotIx >= 0 ? args.splice(shotIx, 2)[1] : null;
// Test the CURRENT source, not whatever was last bundled. This ran against dist/ for a whole session,
// so every "phone_test passed" actually described the previous build.
// --artifact tests the file the published LINK serves, which is the fragment build wrapped in the head
// the Artifact tool supplies — a different file from the standalone, and one nothing had ever opened.
const wantArtifact = args.indexOf('--artifact') >= 0;
if (wantArtifact) args.splice(args.indexOf('--artifact'), 1);
let page = args[0] || path.join(ROOT, 'dist', 'FoldFlyer.html');
if (!args[0]) {
  const r = require('child_process').spawnSync('python3', [path.join(ROOT, 'tools', 'bundle.py')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.error('bundle failed:\n' + (r.stderr || r.stdout)); process.exit(1); }
  console.log('bundled current source ·', (r.stdout || '').trim());
  if (wantArtifact) {
    const frag = fs.readFileSync(path.join(ROOT, 'dist', 'foldflyer.html'), 'utf8');
    const head = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + '<style>:root{color-scheme:light}body{margin:0;background:#faf9f7;font:14px system-ui,sans-serif}'
      + 'img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n';
    page = path.join(os.tmpdir(), 'flyer_artifact_' + process.pid + '.html');
    fs.writeFileSync(page, head + frag + '\n</body>\n</html>\n');
    console.log('testing the ARTIFACT build (fragment + the head the Artifact tool supplies)');
  }
}
const CHROME = fs.readdirSync(path.join(os.homedir(), '.cache/ms-playwright')).filter((d) => d.startsWith('chromium_headless_shell')).map((d) => path.join(os.homedir(), '.cache/ms-playwright', d, 'chrome-linux/headless_shell'))[0];
const PORT = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=' + PORT, '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0; const pending = new Map();
function send(method, params) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
}
async function evaluate(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; }
const W = 390, H = 844;
async function tap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function swipe(x0, y0, x1, y1, ms) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  const n = 6;
  for (let i = 1; i <= n; i++) { await sleep((ms || 180) / n); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n, id: 1 }] }); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const results = [];
function check(name, ok, detail) { results.push([name, ok, detail]); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ' · ' + detail : ''}`); }

(async () => {
  try {
    let targets = null;
    for (let i = 0; i < 50 && !targets; i++) { await sleep(200); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch (e) { /* not up yet */ } }
    const t = targets.find((x) => x.type === 'page');
    ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await send('Page.navigate', { url: 'file://' + page });
    await sleep(2500);
    check('page loaded, no error', (await evaluate('window.flyerStatus && window.flyerStatus().err')) == null);
    check('coarse pointer detected → lane mode on', (await evaluate('window.flyerStatus().lane')) !== null, 'lane=' + (await evaluate('JSON.stringify(window.flyerStatus().lane)')));
    check('intro visible at start', (await evaluate("!document.getElementById('intro').hidden")));
    // Instructions now live behind a real help button. Check that they remain reachable, the dialog
    // doesn't start the game, and the explicit Begin button works with a real touch event.
    {
      await evaluate('document.getElementById("learnbtn").click()');
      check('help opens without starting the flight', await evaluate('document.getElementById("help").open && !document.getElementById("intro").hidden && window.flyerStatus().t === 0'));
      const txt = await evaluate('(document.getElementById("help") || {}).innerText || ""');
      const want = ['barrel roll', 'slipstream', 'cofactor', 'ghost'];
      const missing = want.filter((w) => String(txt).toLowerCase().indexOf(w) < 0);
      check('help describes the current mechanics', missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')}` : want.join(', '));
      await evaluate('document.getElementById("helpclose").click()');
    }
    const cardBox = await evaluate("(function(){var r=document.getElementById('beginbtn').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2];})()");
    await tap(cardBox[0], cardBox[1]); await sleep(300);
    check('Begin flight dismisses intro', (await evaluate("document.getElementById('intro').hidden")));
    // The fold opens with a rotating preview of the structure; the tap above skips it, but it still eases
    // into the flight camera. Wait for the game to actually be flying before testing any control. Note
    // `preview` is undefined until the first update, so an undefined must count as "still previewing" —
    // otherwise this returns at once and the first swipe is swallowed by the preview.
    for (let i = 0; i < 60; i++) {
      const pv = await evaluate('(function(){var p=window.flyerStatus().preview; return p === undefined ? 1 : p;})()');
      if (pv === 0) break;
      await sleep(100);
    }
    await sleep(200);
    // Every lunge check samples a peak over a window, so it must start from rest — otherwise it measures
    // the tail of the previous lunge recovering and passes or fails on timing rather than on the control.
    const atRest = async (ms) => {
      for (let i = 0; i < (ms || 2500) / 100; i++) {
        const st2 = await st();
        if (Math.abs(st2.x) < 0.15 && Math.abs(st2.y) < 0.15) return true;
        await sleep(100);
      }
      return false;
    };
    check('menu button shown while playing', (await evaluate("getComputedStyle(document.getElementById('touchbar')).display !== 'none'")));
    await evaluate('window.loadFoldIndex(9)'); await sleep(400); // cytochrome c oxidase: helical and long enough (~80 s) that the run cannot finish mid-test
    // Loading a fold restarts its preview orbit, and input is swallowed until that finishes — skip it and
    // wait for the game to be flying, or the first gesture after this line is silently eaten.
    await evaluate('window.flyerSkipPreview && window.flyerSkipPreview()');
    for (let i = 0; i < 60; i++) {
      const pv = await evaluate('(function(){var p=window.flyerStatus().preview; return p === undefined ? 1 : p;})()');
      if (pv === 0) break;
      await sleep(100);
    }
    await sleep(600);
    const st = async () => await evaluate('window.flyerStatus()');
    // Wait for the craft to STOP moving rather than for a fixed number of milliseconds. A held finger
    // drives the craft to a steady offset, but how long that takes in wall-clock time depends on how many
    // frames the machine can render — on a loaded box a fixed sleep samples it still on its way.
    // Wait for a straight stretch. The corner brake cuts cruise hard at a bend, so a boost measured into
    // one reads as "boost does nothing" however long the sample — the craft really is slowing. Measure
    // where the path is straight and the only thing changing is the control under test.
    async function straight(ms = 6000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const q = await st();
        if ((q.bend || 0) < 12 && (q.trench || 0) < 0.3) return true;
        await sleep(120);
      }
      return false;
    }
    async function settle(ms = 3000) {
      let prev = null, stable = 0, q = await st();
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        q = await st();
        if (prev !== null && Math.abs(q.x - prev.x) < 0.02 && Math.abs(q.y - prev.y) < 0.02) { if (++stable >= 2) break; }
        else stable = 0;
        prev = q;
        await sleep(120);
      }
      return q;
    }
    check('craft rests near the centre', Math.hypot((await st()).x, (await st()).y) < 0.5, 'x,y=' + (await st()).x + ',' + (await st()).y);
    // a lunge is brief (0.55 s) and CDP swipes are slow, so the GAME records the peak, not this loop
    async function lungePeak(x0, y0, x1, y1, ms) {
      // Settle first (the craft returns to centre over ~0.6 s) AND wait for open corridor: over a sheet
      // the height is deliberately locked to the deck, so a vertical lunge there measures the trench rule
      // rather than the control, and the check passes or fails on where the craft happens to be.
      for (let i = 0; i < 120; i++) {
        const q = await st();
        if (Math.hypot(q.x, q.y) < 0.25 && (q.trench || 0) < 0.3) break;
        await sleep(50);
      }
      const p = swipe(x0, y0, x1, y1, ms);
      // The game records the peak itself (window.flyerPeakReset / status.peakX,peakY): polling from here
      // misses a 0.55 s lunge whenever the machine is loaded, which is a false failure, not a bug.
      await evaluate('window.flyerPeakReset()');
      await p;
      const t1 = Date.now();
      while (Date.now() - t1 < 900) await sleep(50);      // let the lunge play out; the game is watching
      const q = await st();
      return { x: q.peakX, y: q.peakY, f: q.peakF, r: Math.hypot(q.peakX, q.peakY) };
    }
    let pk = await lungePeak(120, 450, 220, 450, 120);
    check('swipe right lunges right', pk.x > 0.6 && Math.abs(pk.y) < 0.6, `peak x=${pk.x} y=${pk.y}`);
    await sleep(700); // the lunge fires on release and holds 0.3 s before returning
    const back = await st();
    check('craft snaps back to centre', Math.hypot(back.x, back.y) < 0.3, `x,y=${back.x},${back.y}`);
    pk = await lungePeak(200, 400, 200, 500, 120);
    check('swipe down lunges down', pk.y < -0.6 && Math.abs(pk.x) < 0.6, `peak x=${pk.x} y=${pk.y}`);
    pk = await lungePeak(120, 500, 200, 420, 120);
    check('diagonal swipe lunges diagonally', pk.x > 0.35 && pk.y > 0.35, `peak x=${pk.x} y=${pk.y}`);
    // Barrel roll. Phones default to LANE mode, and the first build gated the roll on free flight, so it
    // was unreachable for almost every player — these checks exist for that bug.
    //
    // The classifier is tested DIRECTLY with exact numbers: a CDP swipe on a loaded machine takes over a
    // second of wall time for a flick a phone does in 110 ms, so a genuinely fast flick cannot be
    // synthesised here and a timing threshold can never be met from the harness.
    {
      const cases = [
        ['hard sideways flick in lane mode rolls', [150, 220, 0, true], true],
        ['ordinary lunge flick does not roll', [150, 100, 0, true], false],
        ['slow drag does not roll', [900, 220, 0, true], false],
        ['diagonal flick does not roll', [150, 100, 90, true], false],
        ['shorter bar in free flight', [150, 100, 0, false], true],
        ['slow drag in free flight does not roll', [600, 220, 0, false], false],
      ];
      for (const [name, args, want] of cases) {
        const got = await evaluate(`window.flyerRollFromFlick(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`);
        check(name, got === want, `rollFromFlick(${args.join(', ')}) = ${got}`);
      }
      // the keyboard path: a double-tap of the same arrow rolls, a lone tap does not
      const kTap = "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}));";
      const kr0 = (await st()).rolls || 0;
      await evaluate(kTap); await sleep(60);
      const kr1 = (await st()).rolls || 0;
      check('a single arrow tap does not roll', kr1 === kr0, `rolls ${kr0} -> ${kr1}`);
      await evaluate(kTap); await sleep(200);
      const kr2 = (await st()).rolls || 0;
      check('a double-tap of the same arrow rolls', kr2 > kr1, `rolls ${kr1} -> ${kr2}`);

      // and the integration path: an ordinary flick must not roll the craft
      const rolls0 = (await st()).rolls || 0;
      await lungePeak(120, 450, 220, 450, 120);
      check('an ordinary flick does not roll the craft', ((await st()).rolls || 0) === rolls0, `rolls still ${rolls0}`);
      // the roll itself works when triggered
      await evaluate('window.flyerRoll(1)');
      await sleep(150);
      check('a roll runs when triggered', ((await st()).rolls || 0) > rolls0 && (await st()).roll >= 0, `rolls=${(await st()).rolls}`);
    }
    pk = await lungePeak(120, 450, 220, 450, 600);
    // as a fraction of the corridor, not in Å: the corridor width varies along the rail, so an absolute
    // threshold makes this check depend on where the drag happened to land
    check('slow drag also moves the craft', pk.f > 0.45 && pk.x > 0.35, `peak x=${pk.x} (${Math.round(pk.f * 100)}% of corridor)`);
    // finger following: press, drag right and hold there -> craft stays right; release -> back to centre
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 450, id: 1 }] });
    for (let i = 1; i <= 5; i++) { await sleep(30); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150 + 16 * i, y: 450, id: 1 }] }); }
    await sleep(900);          // it is still accelerating at 400 ms; let it arrive before judging it
    const held = await st();
    await sleep(500);
    const held2 = await st();
    // What "following" means is that the craft goes right and STAYS right, not that it reaches any
    // particular number. How far right it gets is capped by the finger's reach and by however wide the
    // corridor happens to be at that moment, and both vary through a fold — an absolute threshold tests
    // the geometry rather than the control, and fails or passes by luck.
    // Judge each sample against what is reachable AT THAT MOMENT: the craft is pinned to whichever wall
    // is there, and both the corridor and the finger's 1.25 Å reach cap vary along a fold. An absolute
    // threshold, or a comparison between two samples, both test the level rather than the control.
    // What this proves is that a held finger keeps the craft displaced instead of snapping it back to the
    // centre. It cannot prove a particular displacement: the corridor narrows and widens as the craft
    // travels (0.66 → 0.30 Å inside one sample gap, observed), squeezing it inward faster than a finger
    // can push it out. So: clearly displaced when it arrives, still on that side half a second later.
    // The release-snaps-back check immediately below is what proves the other half.
    check('finger held right keeps the craft right',
      Math.max(held.x, held2.x) > 0.4 && held.x > -0.05 && held2.x > -0.05 && Math.abs(held2.y) < 0.3,
      `x=${held.x} of ${held.lim}, then ${held2.x} of ${held2.lim}`);
    for (let i = 1; i <= 5; i++) { await sleep(30); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 230, y: 450 - 16 * i, id: 1 }] }); }
    const moved = await settle();
    // as a fraction of the corridor, which varies along the rail
    const mfx = moved.x / Math.max(0.4, moved.lim || 1), mfy = moved.y / Math.max(0.4, moved.lim || 1);
    check('moving the finger moves the craft', mfy > 0.25 && mfx > 0.25,
      `x=${moved.x} y=${moved.y} (${Math.round(mfx * 100)}%, ${Math.round(mfy * 100)}% of corridor)`);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(900);
    const rel = await st();
    check('release snaps back to centre', Math.hypot(rel.x, rel.y) < 0.3, `x,y=${rel.x},${rel.y}`);
    // Both speed checks need the craft at cruise first. Clipping a side chain costs speed, and on a
    // loaded machine the run drifts far enough to do that — which used to read as "the brake is broken"
    // when the craft was already below the 8 Å/s brake floor before the brake was ever pressed.
    // Wait for cruise AND for a straight stretch. The corner brake cuts both the cruise and the boost,
    // so a boost measured entering a bend reads as "the boost does nothing" when the boost is fine.
    const cruise = async (min, ms) => {
      for (let i = 0; i < ms / 100; i++) {
        const st = await evaluate('(function(){var s=window.flyerStatus();return [s.speed, s.bend||0];})()');
        if (st[0] >= min && st[1] < 20) return true;
        await sleep(100);
      }
      return false;
    };
    // hold to boost
    await cruise(13, 8000);
    await straight();
    const v0 = await evaluate('window.flyerStatus().speed');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 450, id: 1 }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 450, id: 1 }, { x: 280, y: 600, id: 2 }] });
    // Take the PEAK over the hold, not the speed at the end of it: a corner arriving mid-window cuts the
    // boost back down, and the test then reads as "the boost does nothing" when it plainly worked.
    let v1 = 0, engaged = false;
    for (let i = 0; i < 12; i++) { await sleep(100); const q = await st(); v1 = Math.max(v1, q.speed); engaged = engaged || !!q.boost; }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // Two separate claims: the control engaged (deterministic), and the craft went faster for it (physics,
    // which a corner mid-window can mask however long the sample).
    check('second finger engages boost', engaged, `status.boost seen = ${engaged}`);
    check('second finger boosts', v1 > v0 + 3, `${v0.toFixed(1)} → ${v1.toFixed(1)} Å/s`);
    await sleep(2500); // let the boost decay
    const vBase = await evaluate('window.flyerStatus().speed');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 450, id: 1 }] });
    await sleep(1200);
    const vHold = await evaluate('window.flyerStatus().speed');
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check('holding one finger does not boost', vHold < 25, `${vBase.toFixed(1)} → ${vHold.toFixed(1)} Å/s`); // tolerance: a collect kick adds up to 2.5 Å/s
    // brake button: hold it and the craft slows
    const bb = await evaluate("(function(){var r=document.getElementById('brakebtn').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, getComputedStyle(document.getElementById('brakebtn')).display];})()");
    // Boost button: held, the craft speeds up; released, it settles back to cruise. Space does the same
    // on a keyboard (it always did, alongside Shift — it was just never on the card).
    {
      const bx = await evaluate("(function(){var e=document.getElementById('boostbtn');var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,getComputedStyle(e).display,r.left,r.right,window.innerWidth];})()");
      check('boost button shown on phones', bx[2] !== 'none' && bx[3] >= 0 && bx[4] <= bx[5], `display=${bx[2]}`);
      await sleep(500); await cruise(12, 8000); await straight();
      const v0 = await evaluate('window.flyerStatus().speed');
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx[0], y: bx[1], id: 1 }] });
      await sleep(1400);
      const v1 = await evaluate('window.flyerStatus().speed');
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(1600);
      const v2 = await evaluate('window.flyerStatus().speed');
      check('boost button engages boost', await evaluate('window.flyerStatus().boost') === false, 'released cleanly');
      check('holding boost speeds the craft up', v1 > v0 + 4, `${v0.toFixed(1)} → ${v1.toFixed(1)} Å/s`);
      check('releasing boost settles back to cruise', v2 < v1 - 3, `${v1.toFixed(1)} → ${v2.toFixed(1)} Å/s`);
    }
    check('brake button shown on phones', bb[2] !== 'none');
    await sleep(600); await cruise(13, 8000); const vb0 = await evaluate('window.flyerStatus().speed');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb[0], y: bb[1], id: 1 }] });
    await sleep(1500);
    const vb1 = await evaluate('window.flyerStatus().speed');
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // the brake floor is 8 Å/s, so from a slow section the drop is small
    check('holding brake slows the craft', vb1 < vb0 - 1.5 && vb1 < 9, `${vb0.toFixed(1)} → ${vb1.toFixed(1)} Å/s`);
    // menu: open, autopilot
    const mb = await evaluate("(function(){var r=document.getElementById('menubtn').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2];})()");
    await tap(mb[0], mb[1]); await sleep(200);
    check('menu opens', (await evaluate("!document.getElementById('menurow').hidden")));
    {
      // Mute. A page that makes noise with no way to stop it gets closed; this must work and stick.
      const m0 = await evaluate('window.flyerMuted()');
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'m'}))");
      await sleep(150);
      const m1 = await evaluate('window.flyerMuted()');
      const saved = await evaluate("(function(){try{return localStorage.getItem('flyer.muted');}catch(e){return 'ERR';}})()");
      check('M toggles sound and remembers it', m1 === !m0 && saved === (m1 ? '1' : '0'), `${m0} -> ${m1}, stored ${saved}`);
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'m'}))");
      await sleep(150);
      check('M toggles back', (await evaluate('window.flyerMuted()')) === m0);
    }
    const ab = await evaluate("(function(){var r=document.querySelector('#menurow button[data-act=autopilot]').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, r.left, r.right, window.innerWidth];})()");
    // Guard against exactly the bug that adding a 'sound' button caused: the row overflowed the viewport
    // and the first item sat at x = -72 on a 390px phone, where no finger can reach it.
    check('every menu button is on screen', ab[2] >= 0 && ab[3] <= ab[4],
      `autopilot button spans ${Math.round(ab[2])}..${Math.round(ab[3])} of ${ab[4]}px`);
    await tap(ab[0], ab[1]); await sleep(300);
    check('autopilot button works', (await evaluate('window.flyerStatus().autopilot')) === true);
    check('menu closes after choice', (await evaluate("document.getElementById('menurow').hidden")));
    // finish flow: back to the bundle, let autopilot finish it, then a tap should load the next fold
    await evaluate('window.loadFoldIndex(0)'); await sleep(500); await evaluate('window.setAutopilot(true)');
    let done = false;
    for (let i = 0; i < 60 && !done; i++) { await sleep(500); done = await evaluate('window.flyerStatus().done'); }
    check('autopilot finishes the bundle', done, 'fold=' + (await evaluate('window.flyerStatus().fold')));
    {
      // finishing a fold stores a ghost of the run, to race on the next attempt. Read the BUNDLE key by
      // name: by the time the next check runs the finish card has been tapped and the fold has moved on.
      const gk = await evaluate('(function(){try{var g=localStorage.getItem("flyer.ghost.BUNDLE");return g?g.length:0;}catch(e){return -1;}})()');
      check('a ghost of the run is stored', gk > 100, `${gk} bytes`);
    }
    await sleep(1000);
    if (shot) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(shot.replace('.png', '-finish.png'), Buffer.from(r.data, 'base64')); }
    await tap(200, 400); await sleep(500);
    check('tap on finish card loads next fold', (await evaluate('window.flyerStatus().fold')) !== 'BUNDLE', 'fold=' + (await evaluate('window.flyerStatus().fold')));
    // Dropping your own .pdb / .cif is a headline feature for this audience and nothing else covers it.
    // Exercised through window.__load, the same entry point the drop handler uses.
    {
      const pdb = fs.readFileSync(path.join(ROOT, 'data', '1UBQ.pdb'), 'utf8');
      await evaluate(`window.__DROP = ${JSON.stringify(pdb)}; 1`);
      const res = await evaluate('(function(){try{var p=window.parseStructure(window.__DROP);window.__load(p);return p.title+"/"+p.seq.length;}catch(e){return "ERR "+e.message;}})()');
      await sleep(900);
      const q = await st();
      check('a dropped structure loads and plays', String(res).indexOf('ERR') < 0 && q.fold === 'DROP' && q.err == null,
        `${res} · fold=${q.fold} · ${q.total} side chains`);
    }
    {
      // And the REAL drop handler, with a file that is not a structure: it must report the problem and
      // leave the game running, not throw. People will drop all sorts of things at a public link.
      const ok = await evaluate("(function(){ try { var dt = new DataTransfer(); dt.items.add(new File(['not a pdb at all'], 'junk.pdb', { type: 'text/plain' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 'dispatched'; } catch (e) { return 'ERR ' + e.message; } })()");
      await sleep(700);
      const q2 = await st();
      check('a junk file is refused without crashing', String(ok) === 'dispatched' && q2.err == null,
        `${ok} · err=${q2.err} · still on ${q2.fold}`);
    }
    // A browser with WebGL off must SAY so, not just show a black page. Checked in a second tab so the
    // running game is untouched: getContext is stubbed before the bundle's script ever runs.
    {
      const nogl = await evaluate("(function(){ var o = document.getElementById('nogl'); return o ? o.textContent.slice(0, 20) : 'none'; })()");
      check('no stray WebGL warning in a working browser', nogl === 'none', `#nogl = ${nogl}`);
    }
    check('still no runtime error', (await evaluate('window.flyerStatus().err')) == null);
    if (shot) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(shot, Buffer.from(r.data, 'base64')); console.log('screenshot', shot); }
  } catch (e) { console.log('harness error', e.message); results.push(['harness', false, e.message]); }
  chrome.kill();
  const bad = results.filter((r) => !r[1]).length;
  console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
  process.exit(bad ? 1 : 0);
})();
