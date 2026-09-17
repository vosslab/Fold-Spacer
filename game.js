// Fold Spacer — game loop: blocks, player physics, camera, assist/autopilot, scoring, effects, HUD.
(function () {
  'use strict';
  const SC = 7;                       // world units per Å
  const A = (x) => x * SC;            // Å -> world
  const BG = [5 / 255, 8 / 255, 18 / 255];
  const TXT = 'rgb(231,237,242)';
  const ELEM_COL = { H: 'rgb(235,186,118)', E: 'rgb(142,199,182)', C: 'rgb(143,156,179)' };
  const ELEM_NAME = { H: 'α-helix', E: 'β-strand', C: 'coil' };
  const SIDE_LEN = { G: 0, A: 1.5, S: 2.4, C: 2.6, T: 2.6, P: 2.4, V: 2.6, D: 3.0, N: 3.0, L: 3.6, I: 3.6, M: 4.2, E: 3.9, Q: 3.9, H: 4.4, K: 5.2, R: 6.0, F: 4.8, Y: 5.6, W: 5.8 };
  const VIOLET = [190 / 255, 140 / 255, 255 / 255], RED = [255 / 255, 110 / 255, 96 / 255];
  // Clustal X residue colours (as in Jalview's "Clustal" scheme)
  const hex = (h) => [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255];
  const CLUSTAL_GROUPS = [
    ['AILMFWV', '#80A0F0', 'hydrophobic'], ['KR', '#F01505', 'positive'], ['DE', '#C048C0', 'negative'],
    ['NQST', '#15C015', 'polar'], ['C', '#F08080', 'cysteine'], ['G', '#F09048', 'glycine'], ['P', '#C0C000', 'proline'], ['HY', '#15A4A4', 'aromatic'],
  ];
  const CLUSTAL = {};
  for (const [aas, h] of CLUSTAL_GROUPS) for (const aa of aas) CLUSTAL[aa] = hex(h);
  let scheme = 'clustal'; // or 'class'
  function resColour(aa) { return scheme === 'clustal' ? (CLUSTAL[aa] || [0.8, 0.8, 0.8]) : classColour(aa); }
  function classColour(aa) {
    if ('FYWH'.includes(aa)) return VIOLET;
    if ('KR'.includes(aa)) return [120 / 255, 190 / 255, 255 / 255];
    if ('DE'.includes(aa)) return [255 / 255, 120 / 255, 110 / 255];
    if ('STNQC'.includes(aa)) return [200 / 255, 205 / 255, 220 / 255];
    return [230 / 255, 200 / 255, 120 / 255];
  }
  const V = window.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // tuning
  const BASE_SPEED = 15, RAMP_SPEED = 6, COMBO_SPEED = 0.3, BOOST_ADD = 12, BRAKE_SPEED = 8;
  const LAT_ACC = 44, LAT_DAMP = 3.2; // lateral agility: terminal lateral speed = LAT_ACC / LAT_DAMP ≈ 13.75 Å/s
  const MAX_CRUISE = BASE_SPEED + RAMP_SPEED + COMBO_SPEED * 12;
  const FLIP_SCORE = 100, HELIX_BONUS = 500, ASSIST_GAIN = 0.3;
  // inward helix side chains are collected by touching them: distance from the stem (Å)
  const COLLECT_R = 0.35, PERFECT_R = 0.3, CRAFT_R = 0.24;
  const TRENCH_CATCH = 0.40; // a sheet target is caught from further out: the road is wide and the craft small // perfect: the pass goes through the middle of the side chain; craft radius for touching atoms
  // Inward side chains point at the coil's centre and reach as far in as they can while still leaving the
  // craft a guaranteed-clear channel down the axis. Nothing invisible: what you can touch is exactly what
  // you can see, and flying straight down the middle touches nothing.
  // SAFE_R is the radius of that channel, measured to the atom surfaces; it clears the craft's touch
  // radius (CRAFT_R, 0.24 Å) and its wingtips (0.28 Å) with ~0.07 Å to spare. Each side chain's reach is
  // solved against the real rail path (see buildBlocks), not a cross-section, so a bend cannot close it.
  const SAFE_R = 0.35;
  const INWARD_LEN = 1.3; // fallback where the local radius is unknown
  const TOUCH_REACH = 1.25; // the furthest a finger can send the craft (the trench slot allows more)
  const TRENCH_HALF = 2.4, TRENCH_H = 1.5; // the trench slot's half width and the flight height above the sheet
  const FLIP_T = 0.45; // seconds for the fast knock-into-place animation
  const WALL_MARGIN = 0.55;  // Å kept between the craft and the ribbon (playable radius = R - this)
  const CAM_FOLLOW = 0.2;   // how much of the sideways offset the camera follows (less = bigger apparent movement)
  const TUNE = window.TUNE = { gain: 3.0, horizon: 12, fwdRate: 3.6, minTurn: 0.3, bendStart: 18, bendSpan: 80, lookCoil: 3.5, slew: 85, upWorld: 0.7, vignette: 1 };
  // comfort: slew = max camera turn rate (°/s); upWorld = how much the camera up leans on world up (kills roll); vignette darkens the periphery while turning

  // ---------------------------------------------------------------- setup
  const glCanvas = document.getElementById('gl');
  const hudCanvas = document.getElementById('hud');
  const hud = hudCanvas.getContext('2d');
  let renderer;
  const status = { fold: '', t: 0, s: 0, len: 0, fixed: 0, total: 0, score: 0, done: false, err: null, frames: 0 };
  const HEADLESS = /headless/.test(location.search) || window.__headless === true;
  window.onerror = (msg, src, line) => { status.err = `${msg} @${line}`; return false; };
  try { renderer = createRenderer(glCanvas); } catch (e) { status.err = String(e); }
  // Without a renderer the page is simply black, and a player on an old device or with WebGL turned off
  // has no idea why. Say so, in the card they are already looking at.
  if (!renderer && !HEADLESS) {
    const card = document.querySelector('#intro .card') || document.getElementById('intro') || document.body;
    const msg = document.createElement('p');
    msg.id = 'nogl';
    msg.style.cssText = 'color:rgb(255,110,96);font:14px ui-monospace,Menlo,monospace;line-height:1.5;margin:0';
    msg.textContent = 'This needs WebGL, and this browser will not give it to us. Try a different browser, '
      + 'or turn on hardware acceleration in its settings.';
    if (card.firstChild) card.insertBefore(msg, card.firstChild); else card.appendChild(msg);
    const intro = document.getElementById('intro');
    if (intro) { intro.hidden = false; intro.style.cursor = 'default'; }
  }

  // ---------------------------------------------------------------- state
  let fold = null, foldIdx = 0, titleCardT = 0;
  let previewC = [0, 0, 0], previewR = 1, previewA0 = 0;
  let introPose = null, introBlend = 0;
  let seq = '', names = [], nums = [], ca = null, sc = null, ss = '', hw = null, rail = null;
  let postMesh = null;
  let ribbonGeom = null, glows = []; // glows: { i (residue), age }
  let ghostPose = null;
  let ribbonMesh = null, ghostMesh = null, gliderMesh = null, gliderGlowMesh = null, fxMesh = null, ghostDirty = true;
  let blocks = [], totalHelix = 0, animating = false;
  let MARATHON = window.MARATHON !== false; // a run carries on into the next fold with score and combo
  let paused = !HEADLESS && !!document.getElementById('intro'); // the run starts when the player taps or clicks the intro
  let carry = null; // { score, combo, folds }
  const P = { s: 0, x: 0, y: 0, vx: 0, vy: 0, lane: 0, speed: 0, fixed: 0, missed: 0, perfect: 0, helices: 0, cofs: 0, kick: 0, wasBoost: false, groove: 0, grooveBest: 0, rolls: 0, rollT: 0, rollDir: 0, rollCool: 0, t: 0, done: false, base: 0, runFolds: 1,
    score: 0, combo: 0, bestCombo: 0, helixNote: 0, shake: 0, boostGlow: 0, lastElem: 'C', rank: '', slow: 0, flashT: 0, flashCol: [1, 1, 1], fovKick: 0, comboPop: 0 };
  const cam = { pos: [0, 0, 0], fwd: [0, 0, 1], up: [0, 1, 0], fov: 76, off: [0, A(0.85)] };
  const keys = {};
  let autopilot = false;
  let flash = { text: '', t: 0 };
  // First-time hints. The intro card already carries more than anyone reads before their first flight, so
  // the three newest mechanics teach themselves in play instead: each fires once, the first time the
  // player is in a position to use it. They survive a restart but not a reload, which is the right scope
  // for a game people open once from a link.
  const taught = {};
  function teach(key, text, secs) {
    if (taught[key] || P.done || P.preview > 0) return;
    taught[key] = 1; flash = { text, t: secs || 3.4 };
  }
  let pops = [];        // { p: world pos, text, age, col }
  let sparks = [];      // { p, v, age, life, col, size }
  let rings = [];       // { c, axis, age, life, col }
  let dust = [];        // { s, x, y, size }
  let lastNow = 0;
  let best = { time: null, score: null };
  // Ghost of your best run on this fold. Sampled at GHOST_HZ as (s, x, y) — rail position and cross-section
  // offset, not world coordinates, so it stays correct if the rail is ever rebuilt. Quantised to integers
  // and stored as one string: 1M56 is 933 Å and 98 s long, which is 1960 samples, about 12 kB.
  const GHOST_HZ = 20;
  let ghostTrace = null, ghostRec = null, ghostNext = 0, ghostCraftMesh = null, ghostCraftGlow = null;

  function bestKey(k) { return 'flyer.' + k + '.' + (fold ? fold.id : '?'); }
  function encodeTrace(a) { return a.join(','); }
  function decodeTrace(str) {
    const parts = str.split(',');
    if (parts.length < 6 || parts.length % 3) return null;
    const out = new Int32Array(parts.length);
    for (let i = 0; i < parts.length; i++) { const v = parseInt(parts[i], 10); if (!isFinite(v)) return null; out[i] = v; }
    return out;
  }
  function loadBest() {
    best = { time: null, score: null };
    ghostTrace = null;
    try {
      const t = localStorage.getItem(bestKey('best')), sc = localStorage.getItem(bestKey('score'));
      best.time = t ? parseFloat(t) : null; best.score = sc ? parseInt(sc, 10) : null;
      const g = localStorage.getItem(bestKey('ghost'));
      if (g) ghostTrace = decodeTrace(g);
    } catch (e) { /* no storage */ }
  }
  function saveBest() {
    try {
      if (best.time === null || P.t < best.time) { best.time = P.t; localStorage.setItem(bestKey('best'), String(P.t)); }
      const fs = P.score - P.base;
      const isBest = best.score === null || fs > best.score;
      if (isBest) { best.score = fs; localStorage.setItem(bestKey('score'), String(fs)); }
      // The ghost follows the best SCORE — that is the run worth chasing. It also SEEDS itself whenever
      // there is no ghost yet, so a player who already has a score from before this existed still gets
      // something to race on their next completion instead of waiting to beat an old number.
      if (ghostRec && ghostRec.length >= 6) {
        let haveGhost = false;
        try { haveGhost = !!localStorage.getItem(bestKey('ghost')); } catch (e) { /* no storage */ }
        if (isBest || !haveGhost) {
          localStorage.setItem(bestKey('ghost'), encodeTrace(ghostRec));
          ghostTrace = Int32Array.from(ghostRec);
        }
      }
    } catch (e) { /* no storage */ }
  }

  // ---------------------------------------------------------------- sound
  const sound = createFlightAudio();
  let soundFocused = true;
  // Muting. This is a game people open from a link — at work, on a train, next to someone asleep — and
  // a page that starts making noise with no way to stop it gets closed. Remembered across sessions.
  let muted = false;
  try { muted = localStorage.getItem('flyer.muted') === '1'; } catch (e) { /* no storage */ }
  function setMuted(on) {
    muted = !!on;
    try { localStorage.setItem('flyer.muted', muted ? '1' : '0'); } catch (e) { /* no storage */ }
    syncSound();
    flash = { text: muted ? 'sound off' : 'sound on', t: 1.6 };
  }
  window.flyerMuted = () => muted;
  function syncSound() { sound.play(!HEADLESS && !muted && !paused && soundFocused && !document.hidden); }
  window.addEventListener('blur', () => { soundFocused = false; syncSound(); });
  window.addEventListener('focus', () => { soundFocused = true; syncSound(); });
  document.addEventListener('visibilitychange', syncSound);
  window.flyerSoundStatus = () => sound.state();
  function beep(freq, dur, type, gain, slide, delay) { sound.tone(freq, dur, type, gain, slide, delay); }
  function ensureSound() {
    // Called only from user-input handlers. Rendering / collecting must never create or resume audio.
    if (!HEADLESS && !muted) sound.unlock();
    syncSound();
  }

  // ---------------------------------------------------------------- fold loading
  function expandFold(f) {
    let num = f.num;
    if (!num && f.runs) { num = []; for (const [st, c] of f.runs) for (let k = 0; k < c; k++) num.push(st + k); }
    const sc = f.sc ? f.sc.map((r) => r.map((x) => x / 10)) : null;
    const cof = f.cof ? f.cof.map((c) => ({ n: c.n, name: c.name, metal: c.metal, a: c.a.map((x) => x / 10), b: c.b })) : null;
    return { id: f.id, title: f.title, seq: f.seq, num, ca: f.ca.map((x) => x / 10), sc, cof, meta: f.meta || null }; // stored as 0.1 Å integers
  }

  // Graft template side chains onto a Cα-only chain, using the local Cα frame at each residue.
  function graftSideChains(caA, sq, ssStr) {
    const T = window.SC_TEMPLATES; if (!T) return null;
    const out = [];
    const c = (k) => [caA[3 * k], caA[3 * k + 1], caA[3 * k + 2]];
    for (let i = 0; i < sq.length; i++) {
      if (i === 0 || i === sq.length - 1) { out.push([]); continue; }
      const tpl = (ssStr[i] === 'H' ? T.H : T.C)[sq[i]];
      if (!tpl) { out.push([]); continue; }
      const prev = c(i - 1), cur = c(i), next = c(i + 1);
      const t = V.norm(V.sub(next, prev));
      let b = V.perp(V.sub(V.add(prev, next), V.scale(cur, 2)), t);
      if (V.len(b) < 1e-3) { out.push([]); continue; }
      b = V.norm(b); const n = V.cross(t, b);
      const rel = [];
      for (let k = 0; k < tpl.length; k += 3) {
        const q = V.add(V.add(V.scale(t, tpl[k]), V.scale(b, tpl[k + 1])), V.scale(n, tpl[k + 2]));
        rel.push(q[0], q[1], q[2]);
      }
      out.push(rel);
    }
    return out;
  }

  function loadFold(f) {
    fold = f;
    seq = f.seq; nums = f.num; ca = f.ca; sc = f.sc || null;
    names = [...seq].map((c) => AA1[c] || 'UNK');
    ss = psea(ca);
    if (!sc) sc = graftSideChains(ca, seq, ss); // Cα-only input: template side chains
    hw = helixWeight(ss);
    rail = buildRail(ca, hw, ss, window.RAILOPT || undefined);
    if (renderer) {
      // Phone fill-rate is precious: spend geometry on the round profile, retain the measured five
      // samples per residue there, and use the finer longitudinal contour on a larger desktop view.
      ribbonGeom = buildRibbon(ca, ss, rail.axis, { subdivisions: TOUCH || window.innerWidth < 640 ? 5 : 8 });
      ribbonGeom.spatial = true;
      ribbonMesh = renderer.upload(ribbonGeom, ribbonMesh);
    }
    buildRibbonGrid(); buildRibFrames(); // surfaceDist is a weak diagnostic; ribbonPenetration is the reliable one
    computePar();
    buildBlocks(); pruneUnfair(); arrangeLaneObstacles(); sphereLOD = blocks.length > 500 ? ICO_LOW : ICO; buildChunks();
    buildCofactors();
    buildMinimap();
    {
      let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let k = 0; k < ca.length / 3; k++) for (let c = 0; c < 3; c++) {
        const v = ca[3 * k + c] * SC; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v;
      }
      previewC = [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2);
      previewR = 0.5 * Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      const n0 = rail.nodeAt(0);
      previewA0 = Math.atan2(n0.p[2] - previewC[2], n0.p[0] - previewC[0]) - 1.0;
    }
    status.fold = f.id; status.len = rail.length / SC; status.total = totalHelix;
    loadBest();
    reset();
  }

  // Where the flight camera sits on its very first frame. The preview blends into exactly this, so the
  // hand-over is continuous — the flight code assigns cam.pos outright, so anything else is a jump.
  function flightStartPose() {
    const n0 = rail.nodeAt(0);
    const aspect = clamp((window.innerWidth || 1280) / Math.max(1, window.innerHeight || 800), 0.4, 2);
    const portraitPull = aspect < 1 ? 1 + (1 - aspect) * 0.85 : 1;
    const cn = rail.nodeAt(-A(3.2 * portraitPull));
    const pos = V.add(cn.p, V.scale(cn.u, A(0.85)));
    const look = V.sub(rail.nodeAt(A(10.5)).p, V.scale(n0.u, A(0.2)));
    return { pos, fwd: V.norm(V.sub(look, pos)), up: n0.u.slice() };
  }
  // A slow orbit of the whole fold before the run, so you can see where you are about to race.
  function previewPose(frac) {
    const c = previewC, R = previewR;
    const ang = previewA0 + frac * 2.0;
    const tv = Math.tan(76 * Math.PI / 360);
    const asp = (window.innerWidth || 1280) / Math.max(1, window.innerHeight || 800);
    const dist = R / Math.min(tv, tv * asp) * 0.92;
    const pos = [c[0] + Math.cos(ang) * dist, c[1] + R * 0.22, c[2] + Math.sin(ang) * dist];
    return { pos, fwd: V.norm(V.sub(c, pos)), up: [0, 1, 0] };
  }
  function reset() {
    sound.reset(); landmarkFocus = null; status.landmark = null;
    releaseInputs();
    P.keyActive = false;
    P.camPrevPos = null; P.camRot = undefined; P.camSc = undefined; P.camBk = undefined;
    P.duck = undefined; P.duckDir = null; P.camBackS = undefined; P.deckLift = undefined;
    Object.assign(P, { s: 0, x: 0, y: 0, vx: 0, vy: 0, lane: 0, speed: 0, fixed: 0, missed: 0, perfect: 0, helices: 0, cofs: 0, kick: 0, wasBoost: false, groove: 0, grooveBest: 0, rolls: 0, rollT: 0, rollDir: 0, rollCool: 0, t: 0, done: false,
      score: 0, combo: 0, bestCombo: 0, helixNote: 0, shake: 0, boostGlow: 0, lastElem: ss[0], rank: '', base: 0, runFolds: 1, slow: 0, flashT: 0, flashCol: [1, 1, 1], fovKick: 0, comboPop: 0 });
    glows = [];
    if (renderer && ribbonGeom) renderer.updateColours(ribbonMesh, ribbonGeom.col, 0);
    if (carry) { P.score = carry.score; P.base = carry.score; P.combo = carry.combo; P.runFolds = carry.folds; carry = null; }
    if (window.foldSpacerLaneEngine) window.foldSpacerLaneEngine.setLane(0);
    for (const b of blocks) { if (b.type === 'H') { b.f = 0; b.anim = false; b.judged = false; b.collided = false; b.minD = Infinity; b.side = 0; b.perfect = false; } b.passed = false; }
    for (const c of cofs) { c.locked = false; c.judged = false; c.announced = false; c.minD = 1e9; }
    ghostRec = []; ghostNext = 0;
    animating = true;
    rebuildBlockMesh();
    updateChunks();
    const n0 = rail.nodeAt(0);
    cam.pos = V.add(n0.p, V.scale(n0.u, A(0.4)));
    cam.fwd = n0.t.slice(); cam.up = n0.u.slice(); cam.fov = 76; cam.off = [0, A(0.85)]; P.camTurn = 0;
    pops = []; sparks = []; rings = []; ghostDirty = true;
    if (mini) { mini.lit.getContext('2d').clearRect(0, 0, mini.lit.width, mini.lit.height); mini.litTo = -1; }
    dust = []; for (let i = 0; i < 140; i++) dust.push(spawnDust(Math.random() * A(45)));
    P.preview = PREVIEW_T;
    titleCardT = 4.5;
    flash = { text: 'Three lanes | dodge the pulsing side chains', t: 6 };
  }

  // ---------------------------------------------------------------- fold minimap
  // The Cα trace projected onto its two principal axes (as in Fold Racer). Kept quiet: no frame,
  // the whole fold as a faint thin trace, and the part already flown lit in element colours.
  let mini = null;
  function pca2(pts) {
    const n = pts.length; let c = [0, 0, 0];
    for (const p of pts) c = V.add(c, p); c = V.scale(c, 1 / n);
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (const p of pts) { const d = V.sub(p, c); xx += d[0] * d[0]; xy += d[0] * d[1]; xz += d[0] * d[2]; yy += d[1] * d[1]; yz += d[1] * d[2]; zz += d[2] * d[2]; }
    const mv = (v) => [xx * v[0] + xy * v[1] + xz * v[2], xy * v[0] + yy * v[1] + yz * v[2], xz * v[0] + yz * v[1] + zz * v[2]];
    let e1 = [1, 0.3, 0.2], e2 = [0.2, 1, 0.3];
    for (let k = 0; k < 60; k++) e1 = V.norm(mv(e1));
    for (let k = 0; k < 60; k++) e2 = V.norm(V.perp(mv(e2), e1));
    if (!isFinite(e2[0]) || V.len(e2) < 0.5) e2 = V.norm(V.cross(e1, Math.abs(e1[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    return { c, e1, e2 };
  }
  function buildMinimap() {
    const n = ca.length / 3, pts = [];
    for (let i = 0; i < n; i++) pts.push([ca[3 * i], ca[3 * i + 1], ca[3 * i + 2]]);
    const pc = pca2(pts), xs = [], ys = [];
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const p of pts) { const d = V.sub(p, pc.c), x = V.dot(d, pc.e1), y = V.dot(d, pc.e2); xs.push(x); ys.push(y); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    const span = Math.max(maxx - minx, maxy - miny, 1e-6), pad = 0.06, sc = (1 - 2 * pad) / span;
    const ox = pad + (span - (maxx - minx)) * 0.5 * sc, oy = pad + (span - (maxy - miny)) * 0.5 * sc;
    const mp = [];
    for (let i = 0; i < n; i++) mp.push([ox + (xs[i] - minx) * sc, 1 - (oy + (ys[i] - miny) * sc)]);
    // faint base trace, drawn once
    const SZ = 256, cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ;
    const c = cv.getContext('2d');
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 2.2; c.strokeStyle = 'rgba(150,158,190,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const dist = i ? Math.hypot(ca[3 * i] - ca[3 * i - 3], ca[3 * i + 1] - ca[3 * i - 2], ca[3 * i + 2] - ca[3 * i - 1]) : 0; if (!i || dist > 5.5) c.moveTo(mp[i][0] * SZ, mp[i][1] * SZ); else c.lineTo(mp[i][0] * SZ, mp[i][1] * SZ); }
    c.stroke();
    mini = { pts: mp, base: cv, litTo: -1, lit: null };
    // lit layer, filled incrementally as the run progresses
    const lv = document.createElement('canvas'); lv.width = SZ; lv.height = SZ; mini.lit = lv;
  }
  function litMinimapTo(cur) {
    if (!mini || cur <= mini.litTo) return;
    const SZ = mini.lit.width, c = mini.lit.getContext('2d'), mp = mini.pts;
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = Math.max(1, mini.litTo + 1); i <= cur; i++) {
      const dist = Math.hypot(ca[3 * i] - ca[3 * i - 3], ca[3 * i + 1] - ca[3 * i - 2], ca[3 * i + 2] - ca[3 * i - 1]);
      if (dist > 5.5) continue; // chain break
      const e = ss[i];
      c.strokeStyle = e === 'H' ? 'rgba(255,179,71,0.95)' : e === 'E' ? 'rgba(127,212,193,0.95)' : 'rgba(190,196,222,0.9)';
      c.lineWidth = e === 'H' ? 3.2 : e === 'E' ? 2.8 : 2.2;
      c.beginPath(); c.moveTo(mp[i - 1][0] * SZ, mp[i - 1][1] * SZ); c.lineTo(mp[i][0] * SZ, mp[i][1] * SZ); c.stroke();
    }
    mini.litTo = cur;
  }
  function drawMinimap(mx, my, MS) {
    if (!mini || !rail) return;
    const cur = clamp(Math.round(rail.nodeAt(P.s).res), 0, mini.pts.length - 1);
    if (cur < mini.litTo) { mini.lit.getContext('2d').clearRect(0, 0, mini.lit.width, mini.lit.height); mini.litTo = -1; } // restart
    litMinimapTo(cur);
    const halo = hud.createRadialGradient(mx + MS / 2, my + MS / 2, MS * 0.2, mx + MS / 2, my + MS / 2, MS * 0.72);
    halo.addColorStop(0, 'rgba(5,8,18,0.55)'); halo.addColorStop(1, 'rgba(5,8,18,0)');
    hud.fillStyle = halo; hud.fillRect(mx - MS * 0.25, my - MS * 0.25, MS * 1.5, MS * 1.5);
    hud.drawImage(mini.base, mx, my, MS, MS);
    hud.drawImage(mini.lit, mx, my, MS, MS);
    // Cofactors on the map. They are the only thing on a fold worth planning a line for, and without a
    // mark the first you know of one is the ring of pips a second before it.
    for (const cf of cofs) {
      const ri = clamp(Math.round(rail.nodeAt(cf.s).res), 0, mini.pts.length - 1);
      const m = mini.pts[ri], cc = COF_COL[cf.n] || [0.9, 0.6, 0.4];
      const px = mx + m[0] * MS, py = my + m[1] * MS;
      const col = (a) => `rgba(${Math.round(cc[0] * 255)},${Math.round(cc[1] * 255)},${Math.round(cc[2] * 255)},${a})`;
      if (cf.locked) {                                   // claimed: a filled dot
        hud.fillStyle = col(0.95); hud.beginPath(); hud.arc(px, py, 3.4, 0, Math.PI * 2); hud.fill();
      } else {                                           // still out there: a ring, pulsing gently
        hud.strokeStyle = col(0.55 + 0.35 * Math.sin(P.t * 3)); hud.lineWidth = 1.6;
        hud.beginPath(); hud.arc(px, py, 4.2, 0, Math.PI * 2); hud.stroke();
      }
    }
    const q = mini.pts[cur];
    hud.fillStyle = 'rgba(219,230,255,0.35)'; hud.beginPath(); hud.arc(mx + q[0] * MS, my + q[1] * MS, 5, 0, Math.PI * 2); hud.fill();
    hud.fillStyle = 'rgb(219,230,255)'; hud.beginPath(); hud.arc(mx + q[0] * MS, my + q[1] * MS, 2.2, 0, Math.PI * 2); hud.fill();
  }

  // ---------------------------------------------------------------- blocks
  // Reach: extend the broken side chain as far toward the player as it can go while every atom surface and
  // the stem stay SAFE_R clear of the rail over ±2 Å of arc, which is the line a player flying dead centre
  // actually takes. Solved once per side chain at load, so a bend can never close the gap.
  // Can a player cross dx Å sideways in the ds Å of flight between two side chains? Checked at the speed
  // the game actually carries you at that point in the fold, not at base speed: the ramp alone takes cruise
  // to 21 Å/s, where the same gap allows barely half the sideways movement.
  function crossable(ds, dx, progress) {
    const v = BASE_SPEED + RAMP_SPEED * clamp(progress || 0, 0, 1);
    const t = ds / v, vt = LAT_ACC / LAT_DAMP;
    return vt * (t - (1 - Math.exp(-LAT_DAMP * t)) / LAT_DAMP) >= dx;
  }
  function solveReach(caW, inw, atoms, real, tangent, Lvis, s, startLen, safeR) {
    const SAFE = safeR === undefined ? SAFE_R : safeR;
    let inLen = clamp(startLen, 0.6, 8.0);
    const probe = [];
    for (let k = -8; k <= 8; k++) probe.push(rail.nodeAt(s + k * A(0.25)).p);
    const tmp = { atoms, real, tan: tangent, Lvis, ca: caW };
    const clear = (L) => {
      const sa = V.add(caW, V.scale(inw, A(0.5))), se = V.add(caW, V.scale(inw, A(L)));
      for (const rp of probe) if (segDist(rp, sa, se) < A(SAFE + 0.2)) return false;
      if (!atoms) return true;
      const { pts, shrink } = posedAtoms(tmp, inw, L);
      const need = A(SAFE + ATOM_R * shrink);
      for (const q of pts) for (const rp of probe) if (V.len(V.sub(rp, q)) < need) return false;
      return true;
    };
    while (inLen > 0.6 && !clear(inLen)) inLen -= 0.05;
    return inLen;
  }
  // Fairness: the clearance solver can retract a side chain past the corridor wall, leaving it visible but
  // impossible to reach. Require a craft position inside the reachable set that both collects it and passes
  // through its middle. In a helix that set is a radius out from the axis; in a trench it is the slot.
  function fairlyReachable(nb, caW, inw, atoms, bonds, real, tangent, L, Lvis, inLen, trench, aim) {
    const probeB = { type: 'H', f: 0, judged: false, atoms, bonds, real, inw, tan: tangent, ca: caW, L, Lvis, inLen };
    const sa = V.add(caW, V.scale(inw, A(0.5))), se = V.add(caW, V.scale(inw, A(inLen)));
    const limA = (nb.R - A(WALL_MARGIN)) / SC;
    const dirOut = V.norm(V.perp(V.sub(caW, nb.p), nb.t));
    let okTouch = false, okPerfect = false, best = Infinity;
    const reachCap = trench ? TRENCH_HALF - 0.15 : TOUCH_REACH;   // a phone must be able to get there too
    for (let k = 0; k <= 60; k++) {
      const sl = -(nb.slotL || TRENCH_HALF), sr = (nb.slotR || TRENCH_HALF);
      const p = trench ? V.add(nb.p, V.scale(nb.r, A(sl + (sr - sl) * k / 60)))
                       : V.add(nb.p, V.scale(dirOut, A(limA * 0.95 * k / 60)));
      const relR = V.sub(p, nb.p);
      if (Math.hypot(V.dot(relR, nb.r), V.dot(relR, nb.u)) / SC > reachCap) continue;
      if (touchDist(p, probeB) < A(trench ? TRENCH_CATCH : CRAFT_R)) okTouch = true;
      const d = segDist(p, sa, se);
      if (d < A(PERFECT_R)) okPerfect = true;
      if (aim && d < best) { // the cross-section offset that passes closest to this side chain's middle
        best = d;
        const rel = V.sub(p, nb.p);
        aim.x = V.dot(rel, nb.r) / SC; aim.y = V.dot(rel, nb.u) / SC;
      }
    }
    return okTouch && okPerfect;
  }

  const TR = window.TR = { strand: 0, shortSC: 0, notTrench: 0, face: 0, spacing: 0, tooShort: 0, unreach: 0, made: 0, lens: [] };
  function buildBlocks() {
    Object.assign(TR, { strand: 0, shortSC: 0, notTrench: 0, face: 0, spacing: 0, tooShort: 0, unreach: 0, made: 0, lens: [] });
    blocks = []; totalHelix = 0;
    const n = ca.length / 3;
    const c3 = (i) => [ca[3 * i], ca[3 * i + 1], ca[3 * i + 2]];
    let lastHelix = -10, seg = 0, inHelix = false, lastPhi = null, lastS = 0, lastTrench = -10, tseg = 0, lastTrenchRun = -10, lastAimX = 0, lastTrenchS = 0;
    for (let i = 1; i < n - 1; i++) {
      if ((hw[i] > 0.6) !== inHelix) { inHelix = hw[i] > 0.6; if (inHelix) seg++; else lastPhi = null; }
      const L = SIDE_LEN[seq[i]] || 0;
      if (!L) continue;
      const prev = c3(i - 1), cur = c3(i), next = c3(i + 1);
      let real = V.norm(V.sub(cur, V.scale(V.add(prev, next), 0.5)));
      const tangent = V.norm(V.sub(next, prev));
      const caW = V.scale(cur, SC);
      // real side-chain atoms (Å, relative to Cα) when the structure has them
      let atoms = null, bonds = null, Lvis = L;
      if (sc && sc[i] && sc[i].length >= 3) {
        atoms = []; for (let k = 0; k < sc[i].length; k += 3) atoms.push([sc[i][k], sc[i][k + 1], sc[i][k + 2]]);
        const cen = atoms.reduce((a, q) => V.add(a, q), [0, 0, 0]).map((x) => x / atoms.length);
        if (V.len(cen) > 0.3) real = V.norm(cen);
        Lvis = Math.max(...atoms.map((q) => V.len(q)));
        bonds = [];
        for (let a = 0; a < atoms.length; a++) {
          if (V.len(atoms[a]) < 1.75) bonds.push([-1, a]);            // Cα–Cβ
          for (let b2 = a + 1; b2 < atoms.length; b2++) if (V.len(V.sub(atoms[a], atoms[b2])) < 1.95) bonds.push([a, b2]);
        }
      }
      const s = rail.resNode(i).s;
      // is this Cα actually on the coil around the rail? (helix ends drift off the de-coiled axis)
      const nb = rail.resNode(i);
      const rel = V.sub(caW, nb.p);
      const alongT = V.dot(rel, nb.t);
      const radial = Math.hypot(V.len(rel) ** 2 - alongT ** 2 > 0 ? Math.sqrt(V.len(rel) ** 2 - alongT ** 2) : 0);
      const onCoil = radial > A(1.6) && radial < A(2.75) && Math.abs(alongT) < A(1.3); // < 2.75: the stem's middle stays inside the 1.7 Å corridor
      if (hw[i] > 0.6 && onCoil) {
        if (hw[i] < 0.82 || L < 3.0 || i - lastHelix < 4 || s < A(8)) continue; // helix must be established (rail on the axis) // 8 Å runway before the first one
        // fairness: from the previous side chain's stem, can a player at top cruise speed reach this one?
        const relB = V.sub(caW, nb.p);
        const phi = Math.atan2(V.dot(relB, nb.u), V.dot(relB, nb.r));
        if (lastPhi !== null) {
          const ds = (s - lastS) / SC, t = ds / MAX_CRUISE;
          const vt = LAT_ACC / LAT_DAMP, reach = vt * (t - (1 - Math.exp(-LAT_DAMP * t)) / LAT_DAMP); // damped lateral travel from rest in t
          const chord = 2 * 1.2 * Math.abs(Math.sin((phi - lastPhi) / 2));                             // between stem points at 1.2 Å
          if (reach < chord * 1.25) continue;                                                            // not fairly reachable: leave this one in place
        }
        const gap = lastPhi === null ? null : { ds: +((s - lastS) / SC).toFixed(1), dphi: +(((phi - lastPhi) * 180 / Math.PI + 540) % 360 - 180).toFixed(0) };
        let inw = V.perp(V.sub(nb.p, caW), tangent); // point at the rail the player flies, not the raw axis (they differ near helix ends)
        inw = V.len(inw) < 1e-6 ? V.scale(real, -1) : V.norm(inw);
        let inLen = solveReach(caW, inw, atoms, real, tangent, Lvis, s, radial / SC - 0.35);
        const aim = {};
        if (!fairlyReachable(nb, caW, inw, atoms, bonds, real, tangent, L, Lvis, inLen, false, aim)) continue;
        lastHelix = i; lastPhi = phi; lastS = s;
        blocks.push({ type: 'H', i, s, ca: caW, real, inw, tan: tangent, L, Lvis, atoms, bonds, hwid: 0.55, f: 0, anim: false, passed: false, judged: false, minD: Infinity, seg, perfect: false, gap, inLen, aim, radial: +(radial / SC).toFixed(2), hwv: +hw[i].toFixed(2) });
        totalHelix++;
      } else {
        // Established sheets only. On a sheet the side chains alternate faces: the ones on the face you fly
        // over stand up in the trench as obstacles, and the ones that belong on the far face are the broken
        // ones, bent up into the trench beside the flight line for you to knock back down.
        if (ss[i] !== 'E') continue; TR.strand++;
        if (L < 2.4) { TR.shortSC++; continue; }   // a bent side chain stretches, so shorter ones still reach
        if (!(rail.tw && rail.tw[i] >= 0.7)) { TR.notTrench++; continue; }
        // Every long side chain on the sheet is a collectable: the ones standing in the trench are knocked
        // over to the far face, the ones already on the far face are the ones bent up into your path. On a
        // sheet you collect, you never collide.
        const upS = nb.sheetN ? V.norm(V.perp(nb.sheetN, tangent)) : nb.u;
        const face = V.dot(real, upS);                        // + : toward the flight side, - : through the sheet
        const realT = face > 0 ? V.norm(V.sub(real, V.scale(upS, 2 * face))) : real; // where it belongs: the far face
        if (i - lastTrench < 1) { TR.spacing++; continue;      // a target on every strand residue: the weave needs a rhythm
        } else {
          // Aim the broken side chain at a point on the slot the player actually flies, 1.1 Å to the side
          // it already leans toward, and reach a little past it so its middle is crossable.
          const rel0 = V.sub(caW, nb.p);
          const cx = V.dot(rel0, nb.r) / SC;
          const lean = V.dot(real, nb.r) >= 0 ? 1 : -1;      // the side it already leans toward, tried first
          const maxStretch = 1.05 * Lvis; // never stretch a side chain past its own length: it reads as rubber
          let inw = null, inLen = 0, tooShort = true; const aim = {};
          // A weave, not the shortest path. Picking the nearest side made consecutive targets nearly
          // collinear, so the trench needed almost no steering. Aim for a real lateral step instead, and
          // let the crossable test below reject any that is too far to reach in time.
          // Aim at slot positions, not at each residue's own offset: tying the target to where the side
          // chain happens to sit put consecutive ones almost in line, so the trench needed no steering.
          // Prefer the position about WEAVE across from the last one, which is a slalom.
          const WEAVE = 2.2;
          const cand = [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5]
            .map((tx0) => [tx0, Math.abs(Math.abs(tx0 - lastAimX) - WEAVE)])
            .sort((a2, b2) => a2[1] - b2[1]);
          const slotLo = -(nb.slotL || TRENCH_HALF) + 0.4, slotHi = (nb.slotR || TRENCH_HALF) - 0.4;
          if (slotHi <= slotLo) { TR.unreach++; continue; }
          for (const [tx0] of cand) {
            const tx = clamp(tx0, slotLo, slotHi);
            const target = V.add(nb.p, V.scale(nb.r, A(tx)));
            const d = V.norm(V.perp(V.sub(target, caW), tangent));
            // it must climb out of the deck, not lie along it: a shallow one is buried in the sheet
            if (V.dot(d, nb.u) < 0.45) continue;
            const need = V.len(V.sub(target, caW)) / SC;
            if (need + 0.3 > maxStretch) continue;            // this side chain cannot reach the flight line
            tooShort = false;
            // 6 Å apart: closer than that and the crossing time only allows ~1 Å, which is no weave at all
            if (lastTrench > 0 && ((s - lastTrenchS) / SC < 6.0 || !crossable((s - lastTrenchS) / SC, Math.abs(tx - lastAimX), s / rail.length))) continue;
            const len = solveReach(caW, d, atoms, realT, tangent, Lvis, s, Math.min(need + 0.5, maxStretch), TRENCH_CATCH + 0.15);
            if (fairlyReachable(nb, caW, d, atoms, bonds, realT, tangent, L, Lvis, len, true, aim)) { inw = d; inLen = len; break; }
          }
          if (!inw) { if (tooShort) TR.tooShort++; else TR.unreach++; continue; }
          lastTrench = i; lastTrenchS = s; lastAimX = aim.x === undefined ? 0 : aim.x;
          if (tseg === 0 || i - lastTrenchRun > 6) tseg++;
          lastTrenchRun = i;
          blocks.push({ type: 'H', i, s, ca: caW, real: realT, inw, tan: tangent, L, Lvis, atoms, bonds, hwid: 0.55, f: 0, anim: false, passed: false, judged: false, minD: Infinity, seg: -tseg, perfect: false, gap: null, inLen, aim, trench: true });
          totalHelix++; TR.made++;
        }
      }
    }
  }

  // Flip animation, f in [0,1] over FLIP_T seconds: a short grab (compress + white flash),
  // then a hinge swing about the backbone tangent with an elastic overshoot into the real position.
  const GRAB = 0.15;
  function swingU(f) {
    if (f <= GRAB) return 0;
    const g = (f - GRAB) / (1 - GRAB);
    return 1 - Math.exp(-4.2 * g) * Math.cos(2.6 * Math.PI * g); // ~20 % overshoot, two wobbles
  }
  function rotAbout(v, k, a) { // Rodrigues
    const c = Math.cos(a), sn = Math.sin(a), kv = V.dot(k, v), kx = V.cross(k, v);
    return [v[0] * c + kx[0] * sn + k[0] * kv * (1 - c), v[1] * c + kx[1] * sn + k[1] * kv * (1 - c), v[2] * c + kx[2] * sn + k[2] * kv * (1 - c)];
  }
  // Second pass, once every obstacle is known: re-aim each broken side chain at a spot that both passes
  // through its middle and is clear of the sheet side chains standing beside it. One with no such spot
  // would cost a hit to collect, so it is dropped rather than left as a trap.
  function pruneUnfair() {
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k];
      if (b.type !== 'H') continue;
      const nb = rail.nodeAt(b.s);
      const [sa, se] = blockSeg(b);
      const limA = (nb.R - A(WALL_MARGIN)) / SC;
      const dirOut = V.norm(V.perp(V.sub(b.ca, nb.p), nb.t));
      let bestX = null, bestY = 0, bestD = Infinity;
      const reachCap = b.trench ? TRENCH_HALF - 0.15 : TOUCH_REACH;
      for (let j = 0; j <= 60; j++) {
        const t = j / 60;
        const sl = -(nb.slotL || TRENCH_HALF), sr = (nb.slotR || TRENCH_HALF);
        const p = b.trench ? V.add(nb.p, V.scale(nb.r, A(sl + (sr - sl) * t)))
                           : V.add(nb.p, V.scale(dirOut, A(limA * 0.95 * t)));
        const relR = V.sub(p, nb.p);
        if (Math.hypot(V.dot(relR, nb.r), V.dot(relR, nb.u)) / SC > reachCap) continue;
        const d = segDist(p, sa, se);
        if (d >= A(PERFECT_R) || d >= bestD) continue;
        const rel = V.sub(p, nb.p);
        bestD = d; bestX = V.dot(rel, nb.r) / SC; bestY = V.dot(rel, nb.u) / SC;
      }
      if (bestX === null) { blocks.splice(k, 1); totalHelix--; }
      else b.aim = { x: bestX, y: bestY };
    }
  }

  function laneSpacingAt(node) {
    const circular = Math.max(A(0.45), node.R - A(WALL_MARGIN + CRAFT_R + 0.08));
    const trench = A(Math.max(0.45, Math.min(1.15,
      Math.min(node.slotL || TRENCH_HALF, node.slotR || TRENCH_HALF) - 0.35)));
    const mix = clamp(((node.trench || 0) - 0.3) / 0.4, 0, 1);
    return Math.min(A(1.05), circular * (1 - mix) + trench * mix);
  }

  function arrangeLaneObstacles() {
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k];
      if (b.type !== 'H') continue;
      const node = rail.nodeAt(b.s), spacing = laneSpacingAt(node);
      const first = ((b.i * 7 + Math.abs(b.seg || 0)) % 3) - 1;
      const order = [first, first === 0 ? -1 : 0, first === 1 ? -1 : 1];
      let placed = false;
      for (const lane of order) {
        const target = V.add(node.p, V.scale(node.r, lane * spacing));
        const offset = V.perp(V.sub(target, b.ca), b.tan);
        const need = V.len(offset) / SC;
        if (need > Math.max(0.65, 1.05 * b.Lvis)) continue;
        b.lane = lane;
        b.inw = V.norm(offset);
        b.inLen = Math.max(0.65, need);
        b.aim = { x: lane * spacing / SC, y: 0 };
        b.theta = undefined;
        placed = true;
        break;
      }
      if (!placed) { blocks.splice(k, 1); totalHelix--; }
    }
  }

  function blockDir(b) {
    if (b.f <= GRAB) return b.inw;
    if (b.f >= 1) return b.real;
    if (b.theta === undefined) {
      const rp = V.norm(V.perp(b.real, b.tan));
      b.realP = rp;
      b.theta = Math.atan2(V.dot(V.cross(b.inw, rp), b.tan), V.dot(b.inw, rp));
    }
    const u = swingU(b.f);
    let d = rotAbout(b.inw, b.tan, b.theta * u);
    const g = (b.f - GRAB) / (1 - GRAB);
    if (g > 0.7) d = V.lerp(d, b.real, (g - 0.7) / 0.3); // settle onto the true side-chain direction
    return V.norm(d);
  }
  // One length for the whole side chain, in Å and in the same units as Lvis, so the stem, the atoms and
  // the collision test can never disagree about how far it reaches.
  function blockLen(b) {
    const inLen = b.inLen || INWARD_LEN;
    if (b.f >= 1) return b.Lvis;
    if (b.f <= 0) return inLen;
    if (b.f <= GRAB) return inLen - 0.25 * (b.f / GRAB);       // compress on impact
    const u = swingU(b.f);
    return Math.max(0.8, inLen + (b.Lvis - inLen) * u);         // stretch out with overshoot
  }
  function blockSeg(b) { const d = blockDir(b); return [V.add(b.ca, V.scale(d, A(0.5))), V.add(b.ca, V.scale(d, A(blockLen(b))))]; }
  const PALE = [1, 0.82, 0.76];
  function blockColour(b) {
    if (b.f <= 0) return V.lerp(resColour(seq[b.i]), [0.94, 0.97, 1], 0.34 + 0.24 * Math.sin(P.t * 2 * Math.PI * 1.6 + b.s * 0.01)); // keep the target's colour and curvature throughout its pulse
    const WHITE = [1, 1, 1];
    if (b.f <= GRAB) return V.lerp(resColour(seq[b.i]), WHITE, 0.5 + 0.5 * b.f / GRAB);
    const g = (b.f - GRAB) / (1 - GRAB);
    const target = resColour(seq[b.i]);
    if (b.perfect) return g < 0.3 ? V.lerp(WHITE, [1, 0.85, 0.45], g / 0.3) : V.lerp([1, 0.85, 0.45], target, (g - 0.3) / 0.7);
    return V.lerp(WHITE, target, Math.min(1, g / 0.5));
  }


  // ---- ball-and-stick geometry
  const ICO = (() => { // unit icosphere, one subdivision: 42 verts, 80 faces
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(V.norm);
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const mid = new Map();
    const m = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (!mid.has(k)) { mid.set(k, v.length); v.push(V.norm(V.add(v[a], v[b]))); } return mid.get(k); };
    const f2 = [];
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca_ = m(c, a); f2.push([a, ab, ca_], [b, bc, ab], [c, ca_, bc], [ab, bc, ca_]); }
    return { v, f: f2 };
  })();
  const CYL_N = 6;
  const ICO_LOW = (() => { // plain icosahedron for very large folds
    const t = (1 + Math.sqrt(5)) / 2;
    const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(V.norm);
    const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    return { v, f };
  })();
  let sphereLOD = ICO;
  function pushSphere(g, c, r, col) {
    const base = g.pos.length / 3;
    for (const q of sphereLOD.v) { g.pos.push(c[0] + q[0] * r, c[1] + q[1] * r, c[2] + q[2] * r); g.nrm.push(q[0], q[1], q[2]); g.col.push(col[0], col[1], col[2]); }
    for (const [a, b, c2] of sphereLOD.f) g.idx.push(base + a, base + b, base + c2);
  }
  function pushCylinder(g, a, b, r, col) {
    const d = V.norm(V.sub(b, a));
    const e1 = V.norm(V.perp(Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], d)), e2 = V.cross(d, e1);
    const base = g.pos.length / 3;
    for (let i = 0; i < CYL_N; i++) {
      const an = i / CYL_N * Math.PI * 2, n = V.add(V.scale(e1, Math.cos(an)), V.scale(e2, Math.sin(an)));
      for (const p of [a, b]) { g.pos.push(p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r); g.nrm.push(n[0], n[1], n[2]); g.col.push(col[0], col[1], col[2]); }
    }
    for (let i = 0; i < CYL_N; i++) {
      const i0 = base + 2 * i, i1 = base + 2 * ((i + 1) % CYL_N);
      g.idx.push(i0, i0 + 1, i1 + 1, i0, i1 + 1, i1);
    }
  }
  // rotation carrying unit vector a onto unit vector b (about b.tan when antiparallel)
  function rotBetween(a, b, fallbackAxis) {
    const ax = V.cross(a, b), sn = V.len(ax), cs = V.dot(a, b);
    if (sn < 1e-5) return cs > 0 ? null : { k: fallbackAxis, a: Math.PI };
    return { k: V.scale(ax, 1 / sn), a: Math.atan2(sn, cs) };
  }
  // Atom positions of a side chain in a given pose (world units), plus the atom size factor.
  function posedAtoms(b, dir, len) {
    const rot = rotBetween(b.real, dir, b.tan);
    const scale = len / b.Lvis;                          // uniform: a crumpled side chain keeps its proportions
    const shrink = Math.max(0.8, Math.min(1, scale));    // atoms shrink far less than the geometry (never above ATOM_R, so the channel guarantee holds)
    const pts = b.atoms.map((q) => { let v = V.scale(q, scale * SC); if (rot) v = rotAbout(v, rot.k, rot.a); return V.add(b.ca, v); });
    return { pts, shrink };
  }
  // visual stem length for the current animation state
  function visLen(b) { return blockLen(b); }
  // distance (world units) from a point to the nearest atom surface of a side chain; falls back to the stem for stick side chains
  const ATOM_R = 0.4;
  function touchDist(p, b) {
    const [a, e] = blockSeg(b);
    let best = segDist(p, a, e) - A(0.2);                     // the stem cylinder
    if (!b.atoms) return best;
    const { pts, shrink } = posedAtoms(b, blockDir(b), visLen(b));
    for (const q of pts) best = Math.min(best, V.len(V.sub(p, q)) - A(ATOM_R * shrink));
    return best;
  }
  // Draw one side chain in a given pose: direction `dir`, stem length `len` (Å), colour.
  function pushSideChain(g, b, dir, len, col, ghost) {
    const rAtom = A(ghost ? 0.32 : ATOM_R), rBond = A(ghost ? 0.15 : 0.27); // thicker bonds read as more substantial without widening the silhouette
    if (b.atoms) {
      const { pts, shrink } = posedAtoms(b, dir, len);
      for (const p of pts) pushSphere(g, p, rAtom * shrink, col);
      for (const [i, j] of b.bonds) pushCylinder(g, i < 0 ? b.ca : pts[i], pts[j], rBond * shrink, col);
      if (b.atoms.length && !b.bonds.some(([i]) => i < 0)) pushCylinder(g, b.ca, pts[0], rBond, col); // ensure a stem
    } else {
      // schematic: a stick with a round head
      const tip = V.add(b.ca, V.scale(dir, A(len)));
      pushCylinder(g, b.ca, V.add(b.ca, V.scale(dir, A(Math.max(0.6, len - 0.3)))), rBond, col);
      pushSphere(g, tip, A(ghost ? 0.36 : 0.45), col);
    }
  }
  // ---- cofactors: heme, NADH and metal sites, drawn where they really sit and claimed by a flyby
  const COF_COL = { HEM: [1.00, 0.34, 0.28], HEA: [1.00, 0.42, 0.22], HEC: [1.00, 0.34, 0.28],
                    NAI: [0.40, 0.78, 0.95], NAD: [0.40, 0.78, 0.95], FAD: [0.98, 0.83, 0.30], FMN: [0.98, 0.83, 0.30],
                    CU: [0.95, 0.55, 0.25], CUA: [0.95, 0.55, 0.25], FE: [0.85, 0.45, 0.25], FE2: [0.85, 0.45, 0.25],
                    MN: [0.70, 0.45, 0.85], MG: [0.45, 0.85, 0.60], ZN: [0.65, 0.72, 0.80] };
  let cofs = [], cofMesh = null, landmarkFocus = null;
  function buildCofactors() {
    const __t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    cofs = [];
    // The per-frame status block is behind the preview's early return, so without this the previous
    // fold's cofactors are still reported for the whole 3.2 s orbit of the next one.
    status.cof = []; status.cofs = 0;
    const list = fold && fold.cof;
    // Always re-upload, even with nothing to draw: an empty mesh has count 0 and draw() skips it, whereas
    // leaving the previous fold's mesh in place would draw its cofactors into this fold.
    if (!renderer) return;                       // no WebGL: the page shows a message instead of a game
    if (!list || !list.length) { cofMesh = uploadGeom(newGeom(), cofMesh); return; }
    // Place the most substantial cofactor first: where two sit close together on the rail the big one is
    // the landmark worth flying for, and a lone metal ion beside a heme is clutter.
    const order = list.slice().sort((x, y) => y.a.length - x.a.length);
    for (const c of order) {
      const pts = [];
      for (let k = 0; k < c.a.length; k += 3) pts.push([c.a[k] * SC, c.a[k + 1] * SC, c.a[k + 2] * SC]);
      const cen = pts.reduce((a, q) => V.add(a, q), [0, 0, 0]).map((x) => x / pts.length);
      // closest approach: search the nodes, then the gate point at the corridor edge on that side
      let best = 1e9, node = null;
      for (const nd of rail.nodes) for (const q of pts) { const d = V.len(V.sub(nd.p, q)); if (d < best) { best = d; node = nd; } }
      if (!node) continue;
      // A cofactor is 7-13 A across, so it stays beside the tunnel for a stretch and the gate does not
      // have to sit at closest approach. Put it where it does NOT fight a side chain: the oracle takes
      // whichever target is nearer along the rail, and a gate 1 A from a side chain simply loses, which
      // is how the first build left the myoglobin and bacterioferritin hemes unclaimable.
      let bestS = node.s, bestGap = -1;
      for (let q = -A(4); q <= A(4) + 1e-6; q += A(0.5)) {
        const sq = node.s + q;
        if (sq < A(2) || sq > rail.length - A(2)) continue;
        const nq = rail.nodeAt(sq);
        let near2 = 1e9;
        for (const p2 of pts) near2 = Math.min(near2, V.len(V.sub(nq.p, p2)));
        if (near2 / SC > best / SC + 3) continue;                 // drifted too far from the cofactor
        let gap = 1e9;
        for (const b of blocks) if (b.type === 'H') gap = Math.min(gap, Math.abs(b.s - sq));
        // and away from a gate already placed: two cofactors 0.3 A apart on the rail fight each other
        // exactly as a gate and a side chain do (bacterioferritin's heme and its Mn site).
        for (const o of cofs) gap = Math.min(gap, Math.abs(o.s - sq));
        if (gap > bestGap) { bestGap = gap; bestS = sq; }
      }
      node = rail.nodeAt(bestS);
      const rel = V.sub(cen, node.p);
      let dx = V.dot(rel, node.r), dy = V.dot(rel, node.u);
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const lim = Math.max(node.R - A(WALL_MARGIN), A(CRAFT_R + 0.06)) / SC;
      // How far out the gate can sit is not a constant. It has to be swingable from the side chain before
      // it and back to the one after, at the speed the ramp is carrying the craft there — the fairness
      // audit checks exactly this, and the first build failed it on 256B, whose opening heme sits 2.9 Å
      // from a side chain. So start at the corridor edge and pull the gate in until the swing fits.
      const vHere = BASE_SPEED + RAMP_SPEED * clamp(bestS / rail.length, 0, 1);   // must match fairness.py's cruise()
      const travel = (t) => { const vt = LAT_ACC / LAT_DAMP; return vt * (t - (1 - Math.exp(-LAT_DAMP * t)) / LAT_DAMP); };
      let prevB = null, nextB = null;
      for (const b of blocks) {
        if (b.type !== 'H') continue;
        if (b.s <= bestS && (!prevB || b.s > prevB.s)) prevB = b;
        if (b.s > bestS && (!nextB || b.s < nextB.s)) nextB = b;
      }
      const swingOK = (o) => {
        for (const b of [prevB, nextB]) {
          if (!b || !b.aim) continue;
          const ds = Math.abs(b.s - bestS) / SC;
          if (ds <= 0) continue;
          const need = Math.max(0, Math.hypot(dx * o - b.aim.x, dy * o - b.aim.y) - COF_R) * COF_SWING;
          if (travel(ds / vHere) * COF_HEAD < need) return false;
        }
        return true;
      };
      let off = lim * COF_GATE;
      while (off > 0.3 && !swingOK(off)) off -= 0.05;
      if (off <= 0.3 && !swingOK(off)) continue;   // no gate on this cofactor is flyable; skip it
      // Two gates closer than this cannot both be flown: the craft cannot cross the corridor and come
      // back in the rail distance between them. Keep the first (the more substantial) and drop the other.
      if (cofs.some((o) => Math.abs(o.s - bestS) < A(COF_SEP))) continue;
      cofs.push({ n: c.n, name: c.name || c.n, metal: !!c.metal, pts, bonds: c.b || [], cen,
                  s: node.s, dx, dy, off, lim, near: +(best / SC).toFixed(2), locked: false, minD: 1e9, judged: false });
    }
    cofs.sort((a, b) => a.s - b.s);
    // Nearby ribbon residues, not a new mesh or a fullscreen effect. Computed once per fold.
    for (const c of cofs) {
      c.resonance = [];
      for (let i = 0; i < seq.length - 1; i++) {
        const d = V.len(V.sub([ca[3*i]*SC, ca[3*i+1]*SC, ca[3*i+2]*SC], c.cen)) / SC;
        if (d < 10) c.resonance.push({ i, d });
      }
      c.resonance.sort((a,b) => a.d-b.d);
      // Carry a little of the ripple ahead along the ribbon too: at speed a pulse confined to the
      // cofactor's pocket would already be behind the lens when it became visible.
      const lead = new Map();
      for (let ahead = 0; ahead <= 18; ahead += 3) {
        const i = Math.round(rail.nodeAt(c.s+A(ahead)).res);
        if (i >= 0 && i < seq.length-1 && !lead.has(i)) lead.set(i, { i, d: ahead });
      }
      for (const r of c.resonance) if (!lead.has(r.i) && lead.size < 28) lead.set(r.i, r);
      c.resonance = Array.from(lead.values());
    }
    // one mesh for all of them: they never animate, only their colour changes, and there are at most three
    const g = newGeom();
    for (const c of cofs) {
      const col = COF_COL[c.n] || [0.8, 0.8, 0.8];
      const rA = A(c.metal ? 0.85 : 0.38), rB = A(0.26);
      for (const q of c.pts) pushSphere(g, q, rA, col);
      for (const [i, j] of c.bonds) pushCylinder(g, c.pts[i], c.pts[j], rB, col);
      c.geomEnd = g.idx.length;
    }
    cofMesh = uploadGeom(g, cofMesh);
    status.cofMs = +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - __t0).toFixed(1);
  }
  // the gate point for a cofactor, in world units
  function cofGate(c) {
    const nd = rail.nodeAt(c.s);
    return V.add(nd.p, V.add(V.scale(nd.r, A(c.dx * c.off)), V.scale(nd.u, A(c.dy * c.off))));
  }

  const newGeom = () => ({ pos: [], nrm: [], col: [], idx: [] });
  const uploadGeom = (g, m) => renderer.upload({ pos: new Float32Array(g.pos), nrm: new Float32Array(g.nrm), col: new Float32Array(g.col), idx: new Uint32Array(g.idx) }, m);
  function floatWriter(data) {
    return { data, length: 0, push(x, y, z) { this.data[this.length++] = x; this.data[this.length++] = y; this.data[this.length++] = z; } };
  }

  // ---- chunked side-chain meshes: only chunks that change (animation, pulse near the player) rebuild
  const CHUNK = 20;
  let chunks = [];
  function buildChunks() {
    // the previous fold's chunk meshes are about to be dropped; give their GL buffers back first
    if (renderer && renderer.dispose) for (const c of chunks) renderer.dispose(c.mesh);
    chunks = [];
    for (let lo = 0; lo < blocks.length; lo += CHUNK) {
      const hi = Math.min(blocks.length, lo + CHUNK);
      chunks.push({ lo, hi, mesh: null, dirty: true, s0: blocks[lo].s, s1: blocks[hi - 1].s });
    }
  }
  function rebuildChunk(c) {
    if (!renderer) return;
    const g = newGeom();
    c.ranges = []; c.poses = [];
    for (let k = c.lo; k < c.hi; k++) {
      const b = blocks[k], start = g.col.length;
      pushSideChain(g, b, blockDir(b), visLen(b), blockColour(b), false);
      c.ranges.push([start, g.col.length]); c.poses.push(b.f);
    }
    c.mesh = uploadGeom(g, c.mesh);
    c.colours = new Float32Array(g.col);
    c.positions = new Float32Array(g.pos); c.normals = new Float32Array(g.nrm);
    c.writers = c.ranges.map(([start, end]) => ({ pos: floatWriter(c.positions.subarray(start, end)),
      nrm: floatWriter(c.normals.subarray(start, end)), col: { push() {} }, idx: { push() {} } }));
    renderer.updateBounds(c.mesh, c.positions);
    c.dirty = false; c.colourTime = P.t; c.colourScheme = scheme;
  }
  function updateChunks() {
    for (const c of chunks) {
      if (c.dirty) { rebuildChunk(c); continue; }
      // Same ball-and-stick formulas, but only the moving chain writes its existing
      // vertex span. Topology and the other nineteen chains never need re-uploading.
      let moved = false;
      for (let k = c.lo; k < c.hi; k++) {
        const j = k - c.lo, b = blocks[k];
        if (b.f === c.poses[j]) continue;
        const g = c.writers[j]; g.pos.length = g.nrm.length = 0;
        pushSideChain(g, b, blockDir(b), visLen(b), blockColour(b), false);
        renderer.updatePose(c.mesh, g.pos.data, g.nrm.data, c.ranges[j][0] / 3);
        c.poses[j] = b.f; moved = true;
      }
      if (moved) renderer.updateBounds(c.mesh, c.positions);
      if (!moved && c.colourTime === P.t && c.colourScheme === scheme) continue;
      let need = moved || c.colourScheme !== scheme;
      if (!need && c.s1 > P.s - A(6) && c.s0 < P.s + A(40)) {
        for (let k = c.lo; k < c.hi && !need; k++) { const b = blocks[k]; if (b.type === 'H' && (!b.judged || (b.anim && b.f < 1))) need = true; }
      } else if (!need) {
        for (let k = c.lo; k < c.hi && !need; k++) { const b = blocks[k]; if (b.anim && b.f < 1) need = true; }
      }
      if (need && renderer) {
        for (let k = c.lo; k < c.hi; k++) {
          const col = blockColour(blocks[k]), [start, end] = c.ranges[k - c.lo];
          for (let j = start; j < end; j += 3) {
            c.colours[j] = col[0]; c.colours[j + 1] = col[1]; c.colours[j + 2] = col[2];
          }
        }
        renderer.updateColours(c.mesh, c.colours, 0);
        c.colourTime = P.t; c.colourScheme = scheme;
      }
    }
  }
  function rebuildBlockMesh() { for (const c of chunks) c.dirty = true; }

  // faint ghosts of where the unflipped side chains belong
  function rebuildGhostMesh() {
    if (!renderer) return;
    const g = newGeom();
    for (const b of blocks) {
      if (b.type !== 'H' || b.judged) continue;
      if (b.trench) continue; // its fixed position is under the road, so there is nothing useful to ghost
      pushSideChain(g, b, b.real, b.Lvis, resColour(seq[b.i]), true);
    }
    ghostMesh = uploadGeom(g, ghostMesh);
    ghostDirty = false;
  }

  function segDist(p, a, b) {
    const ab = V.sub(b, a), ap = V.sub(p, a);
    const t = clamp(V.dot(ap, ab) / Math.max(1e-9, V.dot(ab, ab)), 0, 1);
    return V.len(V.sub(p, V.add(a, V.scale(ab, t))));
  }
  // ---------------------------------------------------------------- the craft
  // Ported from Fold Racer's carFaces: long and low, a wide delta plane, twin nacelles with the
  // engines, a low canopy, a fin, and the accent colour on the wings and a spine stripe.
  // Local frame: x across (r), y up (u), z forward (t). Units are model units × sc.
  function craftFaces(o, t, u, r, accent, sc) {
    const P = (dx, dy, dz) => V.add(V.add(V.add(o, V.scale(r, dx * sc)), V.scale(u, dy * sc)), V.scale(t, dz * sc));
    const body = [224, 231, 232], side = [185, 199, 205], dark = [88, 105, 119], glass = [31, 48, 62], lite = [239, 241, 233];
    const RB = [P(-5, 0, -12), P(5, 0, -12)], RT = [P(-3.2, 2.8, -12), P(3.2, 2.8, -12)],
      MB = [P(-5.6, 0, 2), P(5.6, 0, 2)], MT = [P(-3.6, 3.0, 2), P(3.6, 3.0, 2)],
      FB = [P(-3.4, 0, 12), P(3.4, 0, 12)], FT = [P(-2.0, 2.0, 12), P(2.0, 2.0, 12)], N = P(0, 0.8, 22);
    const accD = side, accG = body;
    const F = [
      { v: [RT[0], RT[1], MT[1], MT[0]], c: body }, { v: [MT[0], MT[1], FT[1], FT[0]], c: body }, { v: [FT[0], FT[1], N], c: lite },
      { v: [RB[0], RT[0], MT[0], MB[0]], c: side }, { v: [MB[0], MT[0], FT[0], FB[0]], c: side }, { v: [FB[0], FT[0], N], c: lite },
      { v: [RB[1], MB[1], MT[1], RT[1]], c: side }, { v: [MB[1], FB[1], FT[1], MT[1]], c: side }, { v: [FB[1], N, FT[1]], c: lite },
      { v: [RB[0], MB[0], MB[1], RB[1]], c: dark }, { v: [MB[0], FB[0], FB[1], MB[1]], c: dark }, { v: [FB[0], N, FB[1]], c: dark },
      { v: [RB[0], RB[1], RT[1], RT[0]], c: dark },
      { v: [P(-0.8, 2.86, -11), P(0.8, 2.86, -11), P(0.6, 3.06, 2), P(-0.6, 3.06, 2)], c: body },
      { v: [P(-0.6, 3.06, 2), P(0.6, 3.06, 2), P(0.35, 2.06, 11.5), P(-0.35, 2.06, 11.5)], c: body },
      { v: [P(-1.6, 3.0, -3), P(1.6, 3.0, -3), P(1.1, 4.3, -0.5), P(-1.1, 4.3, -0.5)], c: glass },
      { v: [P(-1.1, 4.3, -0.5), P(1.1, 4.3, -0.5), P(0.8, 2.2, 7), P(-0.8, 2.2, 7)], c: [49, 72, 84] },
      { v: [P(-1.6, 3.0, -3), P(-1.1, 4.3, -0.5), P(-0.8, 2.2, 7)], c: glass }, { v: [P(1.6, 3.0, -3), P(0.8, 2.2, 7), P(1.1, 4.3, -0.5)], c: glass },
      { v: [P(-5.6, 0.9, 2), P(-11.5, 1.1, -8.5), P(-5, 1.1, -12)], c: accG }, { v: [P(-5.6, 0.7, 2), P(-5, 0.9, -12), P(-11.5, 0.9, -8.5)], c: accD },
      { v: [P(5.6, 0.9, 2), P(5, 1.1, -12), P(11.5, 1.1, -8.5)], c: accG }, { v: [P(5.6, 0.7, 2), P(11.5, 0.9, -8.5), P(5, 0.9, -12)], c: accD },
      { v: [P(0, 2.8, -12), P(0, 6.4, -11.2), P(0, 2.9, -5.5)], c: side }, { v: [P(0, 2.8, -12), P(0, 2.9, -5.5), P(0, 6.4, -11.2)], c: body },
    ];
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const xo = 7.4 * sgn, xi = 9.6 * sgn;
      F.push({ v: [P(xo, 0.6, -12), P(xi, 0.6, -12), P(xi, 0.6, -1), P(xo, 0.6, -1)], c: dark });
      F.push({ v: [P(xo, 2.4, -12), P(xo, 2.4, -1), P(xi, 2.4, -1), P(xi, 2.4, -12)], c: body });
      F.push({ v: [P(xo, 0.6, -12), P(xo, 0.6, -1), P(xo, 2.4, -1), P(xo, 2.4, -12)], c: side });
      F.push({ v: [P(xi, 0.6, -12), P(xi, 2.4, -12), P(xi, 2.4, -1), P(xi, 0.6, -1)], c: side });
      F.push({ v: [P(xo, 0.6, -1), P(xi, 0.6, -1), P((xo + xi) / 2, 1.9, 3.5)], c: lite });
      F.push({ v: [P(xo, 2.4, -1), P((xo + xi) / 2, 1.9, 3.5), P(xi, 2.4, -1)], c: lite });
      F.push({ v: [P(xo, 0.6, -12), P(xo, 2.4, -12), P(xi, 2.4, -12), P(xi, 0.6, -12)], c: dark });
      F.push({ v: [P(xo + 0.3 * sgn, 0.9, -12.2), P(xi - 0.3 * sgn, 0.9, -12.2), P(xi - 0.3 * sgn, 2.1, -12.2), P(xo + 0.3 * sgn, 2.1, -12.2)], c: engineCol, glow: true });
    }
    return F;
  }
  let engineCol = [255, 160, 70];
  const CRAFT_SC = A(0.024); // model unit -> world: 34 units long ≈ 0.8 Å, wings ±0.28 Å
  function placeCraft(mesh, o, t, u, r) {
    const m = mesh.model || (mesh.model = new Float32Array(16));
    for (let j = 0; j < 3; j++) { m[j] = r[j]; m[4 + j] = u[j]; m[8 + j] = t[j]; m[12 + j] = o[j]; }
    m[15] = 1;
  }
  function updateEngines(mesh) {
    const old = mesh.engineColour;
    if (old && old[0] === engineCol[0] && old[1] === engineCol[1] && old[2] === engineCol[2]) return;
    mesh.engineColour = engineCol.slice();
    for (const w of mesh.engineWrites) {
      for (let j = 0; j < w.col.length; j++) w.col[j] = engineCol[j % 3] / 255;
      renderer.updateColours(mesh, w.col, w.first);
    }
  }
  function buildCraft(o, t, u, r, accent) {
    if (!gliderMesh) {
      const centre = [0, 1.6 * CRAFT_SC, 0];
      const F = craftFaces([0, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], accent, CRAFT_SC);
      const lit = newGeom(), glow = newGeom();
      for (const f of F) {
        let cen = [0, 0, 0]; for (const q of f.v) cen = V.add(cen, q); cen = V.scale(cen, 1 / f.v.length);
        let n = V.norm(V.cross(V.sub(f.v[1], f.v[0]), V.sub(f.v[2], f.v[0])));
        if (V.dot(n, V.sub(cen, centre)) < 0) n = V.scale(n, -1);
        const g = f.glow ? glow : lit, col = [f.c[0] / 255, f.c[1] / 255, f.c[2] / 255];
        const base = g.pos.length / 3;
        for (const q of f.v) { g.pos.push(q[0], q[1], q[2]); g.nrm.push(n[0], n[1], n[2]); g.col.push(col[0], col[1], col[2]); }
        for (let k = 1; k < f.v.length - 1; k++) g.idx.push(base, base + k, base + k + 1);
      }
      gliderMesh = uploadGeom(lit, gliderMesh);
      gliderGlowMesh = uploadGeom(glow, gliderGlowMesh);
      gliderGlowMesh.engineWrites = [{ first: 0, col: new Float32Array(glow.col.length) }];
    }
    placeCraft(gliderMesh, o, t, u, r); gliderGlowMesh.model = gliderMesh.model;
    updateEngines(gliderGlowMesh);
  }

  // The ghost craft, built the same way but into its own buffers so the two can be drawn in one frame.
  function buildGhostCraft(o, t, u, r, accent) {
    if (!ghostCraftMesh) {
      const centre = [0, 1.6 * CRAFT_SC, 0];
      const F = craftFaces([0, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], accent, CRAFT_SC);
      const lit = newGeom(), engineWrites = [];
      for (const f of F) {
        let cen = [0, 0, 0]; for (const q of f.v) cen = V.add(cen, q); cen = V.scale(cen, 1 / f.v.length);
        let n = V.norm(V.cross(V.sub(f.v[1], f.v[0]), V.sub(f.v[2], f.v[0])));
        if (V.dot(n, V.sub(cen, centre)) < 0) n = V.scale(n, -1);
        const col = [f.c[0] / 255, f.c[1] / 255, f.c[2] / 255];
        const base = lit.pos.length / 3;
        if (f.glow) engineWrites.push({ first: base, col: new Float32Array(f.v.length * 3) });
        for (const q of f.v) { lit.pos.push(q[0], q[1], q[2]); lit.nrm.push(n[0], n[1], n[2]); lit.col.push(col[0], col[1], col[2]); }
        for (let k = 1; k < f.v.length - 1; k++) lit.idx.push(base, base + k, base + k + 1);
      }
      ghostCraftMesh = uploadGeom(lit, ghostCraftMesh);
      ghostCraftMesh.engineWrites = engineWrites;
    }
    placeCraft(ghostCraftMesh, o, t, u, r); updateEngines(ghostCraftMesh);
  }

  // Where the ghost was at time tq, as {s, x, y} in world units. Linear between samples.
  function ghostAt(tq) {
    if (!ghostTrace || ghostTrace.length < 6) return null;
    const n = ghostTrace.length / 3;
    const f = tq * GHOST_HZ;
    if (f >= n - 1) return null;                       // the ghost has finished: stop drawing it
    const i = Math.max(0, Math.floor(f)), k = f - i, j = Math.min(n - 1, i + 1);
    const g = (q, c) => ghostTrace[3 * q + c];
    return {
      s: A((g(i, 0) + (g(j, 0) - g(i, 0)) * k) / 10),
      x: A((g(i, 1) + (g(j, 1) - g(i, 1)) * k) / 100),
      y: A((g(i, 2) + (g(j, 2) - g(i, 2)) * k) / 100),
    };
  }

  // ---------------------------------------------------------------- impact juice
  function impact(p, node, col, perfect, resIdx) {
    // reward cues only: no freeze, no shake, no screen flash (those read as damage)
    P.flashT = 1; P.flashCol = col;                  // craft accent flares gold for a moment
    P.fovKick = perfect ? 4.5 : 3;                   // a small surge forward
    P.speed += perfect ? 2.5 : 1.5;
    P.comboPop = 1;
    // shock ring facing the camera at the point of contact, plus a second slower one
    rings.push({ c: p.slice(), axis: cam.fwd.slice(), age: 0, life: 0.28, col: [1, 0.86, 0.5], r0: 0.2, r1: 1.2, w: 0.045 });
    burst(p, node.t, col, perfect ? 10 : 6, perfect ? 9 : 6);
    for (let k = -1; k <= 1; k++) glows.push({ i: resIdx + k, age: 0, life: 0.55, strength: k === 0 ? 1 : 0.6 });
    // Collection notes are harmonised with the score by sound.hit(), at the scoring event.
  }
  // the ribbon glows white around a hit residue and fades back to its element colour
  let glowScratch = new Float32Array(0);
  function updateGlows(dt) {
    if (!renderer || !ribbonGeom || !glows.length) return;
    const RING = ribbonGeom.ringSize, SUB = ribbonGeom.subdivisions, n = seq.length;
    const touched = new Map();
    for (const g of glows) {
      g.age += dt;
      const i = g.i; if (i < 0 || i >= n - 1) continue;
      if (g.age < 0) continue; // a cofactor's ripple has not reached this residue yet
      const k = Math.max(0, 1 - g.age / g.life) * g.strength;
      if (!touched.has(i) || k > touched.get(i).k) touched.set(i, { k, col: g.col || [1, 0.86, 0.5] });
    }
    for (const [i, glow] of touched) {
      const v0 = i * SUB * RING, cnt = SUB * RING;
      if (glowScratch.length !== cnt * 3) glowScratch = new Float32Array(cnt * 3);
      const out = glowScratch;
      for (let j = 0; j < out.length; j++) {
        const base = ribbonGeom.col[v0 * 3 + j];
        out[j] = base + (glow.col[j % 3] * ribbonGeom.ao[v0 + Math.floor(j / 3)] - base) * glow.k;
      }
      renderer.updateColours(ribbonMesh, out, v0);
    }
    glows = glows.filter((g) => g.age < g.life + 0.05);
  }

  // ---------------------------------------------------------------- effects
  function quadStream() {
    return { count: 0, capacity: 0, pos: null, nrm: null, col: null, idx: null };
  }
  const effectStream = quadStream(), postStream = quadStream();
  function appendQuad(g, c, ax, ay, colour, alpha) {
    if (g.count === g.capacity) {
      const capacity = Math.max(64, g.capacity * 2);
      for (const key of ['pos', 'nrm', 'col']) {
        const data = new Float32Array(capacity * 12);
        if (g[key]) data.set(g[key]); g[key] = data;
      }
      g.idx = new Uint32Array(capacity * 6);
      for (let i = 0; i < capacity; i++) g.idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      g.capacity = capacity;
    }
    const base = g.count++ * 12;
    for (let j = 0; j < 3; j++) {
      // Preserve the old vector operation order, including Float32 rounding at upload.
      g.pos[base + j] = (c[j] - ax[j]) - ay[j];
      g.pos[base + 3 + j] = (c[j] - ax[j]) + ay[j];
      g.pos[base + 6 + j] = (c[j] + ax[j]) + ay[j];
      g.pos[base + 9 + j] = (c[j] + ax[j]) - ay[j];
      for (let v = 0; v < 12; v += 3) { g.nrm[base + v + j] = cam.fwd[j]; g.col[base + v + j] = colour[j] * alpha; }
    }
  }
  const emptyFloat = new Float32Array(0), emptyIndex = new Uint32Array(0);
  function uploadQuads(g, mesh) {
    const n = g.count * 12;
    return renderer.upload({ pos: g.pos ? g.pos.subarray(0, n) : emptyFloat,
      nrm: g.nrm ? g.nrm.subarray(0, n) : emptyFloat, col: g.col ? g.col.subarray(0, n) : emptyFloat,
      idx: g.idx || emptyIndex, indexCount: g.count * 6, stream: true, capacityBytes: g.capacity * 48 }, mesh);
  }
  function spawnDust(ahead) {
    const ang = Math.random() * Math.PI * 2, rad = A(1.5 + Math.random() * 6);
    return { s: P.s + ahead, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, size: A(0.015 + Math.random() * 0.025) };
  }
  function burst(p, dir, col, n, speed) {
    for (let i = 0; i < n; i++) {
      const rnd = V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
      const v = V.scale(V.norm(V.add(V.scale(dir, 1.2), rnd)), A(speed * (0.6 + Math.random() * 0.8)));
      sparks.push({ p: p.slice(), v, age: 0, life: 0.22 + Math.random() * 0.18, col, size: A(0.028 + Math.random() * 0.028) });
    }
  }
  function pop(p, text, col) {
    // One stable acknowledgement; scores still accumulate normally through a burst of collections.
    pops = [{ text, age: 0, col: col || TXT, dx: 0 }];
  }

  function buildFx(dt) {
    if (!renderer) return;
    effectStream.count = postStream.count = 0;
    const right = V.norm(V.cross(cam.fwd, cam.up)), up = cam.up;
    const quad = (c, ax, ay, colr, alpha) => {
      const dcam = V.len(V.sub(c, cam.pos));
      alpha *= clamp((dcam - A(0.5)) / A(1.2), 0, 1); // fade anything right on the lens
      if (alpha < 0.02) return;
      // Cap the on-screen size: close to the deck a world-sized quad becomes a slab across the road. Scale
      // both axes by the same factor so a streak stays a streak instead of collapsing into a square.
      const maxHalf = dcam * 0.014, big = Math.max(V.len(ax), V.len(ay));
      if (big > maxHalf) { const k = maxHalf / big; ax = V.scale(ax, k); ay = V.scale(ay, k); }
      appendQuad(effectStream, c, ax, ay, colr, alpha);
    };
    // dust streaks: stretched along the rail tangent by speed
    const stretch = A(P.speed) * 0.035;
    const dustCol = [150 / 255, 158 / 255, 190 / 255];
    for (const d of window.NODUST ? [] : dust) {
      if (d.s < P.s - A(2)) Object.assign(d, spawnDust(A(30) + Math.random() * A(20)));
      if (d.s > rail.length || P.speed < 2) continue;
      const nd = rail.nodeAt(d.s);
      const c = V.add(nd.p, V.add(V.scale(nd.r, d.x), V.scale(nd.u, d.y)));
      const ax = V.scale(nd.t, d.size * 0.5 + stretch), ay = V.scale(V.norm(V.cross(nd.t, V.sub(c, cam.pos))), d.size);
      const dist = V.len(V.sub(c, cam.pos));
      const trDust = clamp((((nd.trench || 0) - 0.3) / 0.4), 0, 1); // over a road the deck carries the speed, not motes
      quad(c, ax, ay, dustCol, (0.15 + 0.4 * clamp(1 - dist / A(30), 0, 1)) * clamp(P.speed / 12, 0, 1) * clamp(1 - (P.camTurn || 0) / 120, 0.3, 1) * (1 - 0.9 * trDust));
    }
    // sparks
    for (const sp of sparks) {
      sp.age += dt;
      const drag = Math.exp(-3 * dt);
      for (let j = 0; j < 3; j++) { sp.p[j] += sp.v[j] * dt; sp.v[j] *= drag; }
      const a = 1 - sp.age / sp.life;
      if (sp.streak) { // exhaust: stretched along its motion
        const d = V.norm(sp.v), side = V.norm(V.cross(d, V.sub(sp.p, cam.pos)));
        quad(sp.p, V.scale(d, sp.size * 2.5), V.scale(side, sp.size * a), sp.col, 0.9 * a + 0.1);
      } else quad(sp.p, V.scale(right, sp.size * a), V.scale(up, sp.size * a), sp.col, 0.9 * a + 0.1);
    }
    let alive = 0;
    for (const sp of sparks) if (sp.age < sp.life) sparks[alive++] = sp;
    sparks.length = alive;
    // Target posts on a sheet. The fixed position of a sheet side chain is under the road, so there is no
    // forward cue without these: each uncollected one gets a lit post standing on the deck. They are drawn
    // through the geometry, because on a curved sheet your own road is hidden behind the wall ahead.
    const pquad = (c, ax, ay, colr, alpha) => {
      // same discipline as the effect quads: fade out on the lens and never grow past a fixed screen size,
      // or a post you are about to reach becomes a staircase across the view
      const dcam = V.len(V.sub(c, cam.pos));
      alpha *= clamp((dcam - A(1.2)) / A(2.5), 0, 1);
      if (alpha < 0.02) return;
      const maxHalf = dcam * 0.02, big = Math.max(V.len(ax), V.len(ay));
      if (big > maxHalf) { const k2 = maxHalf / big; ax = V.scale(ax, k2); ay = V.scale(ay, k2); }
      appendQuad(postStream, c, ax, ay, colr, alpha);
    };
    for (const b of blocks) {
      if (b.type !== 'H' || b.judged || !b.trench) continue;
      const ds = b.s - P.s;
      if (ds < -A(1) || ds > A(30)) continue;
      const nb = rail.nodeAt(b.s), am = b.aim || { x: 0, y: 0 };
      const foot = V.add(V.add(nb.p, V.scale(nb.r, A(am.x))), V.scale(nb.u, A(-TRENCH_H + 0.3)));
      const col = resColour(seq[b.i]);
      const near = clamp(1 - ds / A(30), 0.3, 1);
      const puls = 0.85 + 0.15 * Math.sin(P.t * 6 - ds / A(4)); // a pulse that runs up the trench toward you
      // one elongated bar, not a stack of billboards: a column of separate squares always reads as a staircase
      const h = A(0.55), c0 = V.add(foot, V.scale(nb.u, h));
      pquad(c0, V.scale(right, A(0.09)), V.scale(nb.u, h), col, near * puls);
    }
    // Cofactor gates: a ring of pips at the gate point, drawn through the geometry like the sheet posts,
    // because the gate sits out at the corridor edge where the wall ahead usually hides it. The ring
    // tightens as you close on it, so the cue reads as "come here", not as another collectable.
    for (const c of cofs) {
      if (c.judged) continue;
      const ds = c.s - P.s;
      if (ds < -A(0.8) || ds > A(COF_WIN * 6)) continue;
      const gp = cofGate(c);
      const nb = rail.nodeAt(c.s);
      const col = COF_COL[c.n] || [0.9, 0.6, 0.4];
      const near = clamp(1 - ds / A(COF_WIN * 6), 0.25, 1);
      const puls = 0.75 + 0.25 * Math.sin(P.t * 7 - ds / A(3));
      const rr = A(COF_R) * (1 + 1.6 * clamp(ds / A(COF_WIN * 2), 0, 1));   // wide far off, tight on arrival
      for (let k = 0; k < 8; k++) {
        const an = k / 8 * Math.PI * 2;
        const q = V.add(gp, V.add(V.scale(nb.r, Math.cos(an) * rr), V.scale(nb.u, Math.sin(an) * rr)));
        pquad(q, V.scale(nb.r, A(0.07)), V.scale(nb.u, A(0.07)), col, near * puls);
      }
    }
    postMesh = uploadQuads(postStream, postMesh);
    fxMesh = uploadQuads(effectStream, fxMesh);
  }

  // ---------------------------------------------------------------- input
  const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down' };
  const STEER_CODES = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down' };
  const heldKeys = new Map();
  function clearKeyboard() {
    heldKeys.clear();
    for (const k of Object.keys(keys)) keys[k] = false;
    P.keyReach = 0; // no stale ramp on the next press; the spring still settles after release
    tapLast.d = ''; tapLast.t = 0;
  }
  function releaseInputs() {
    clearKeyboard();
    touch.id = touch.boostId = null; touch.dx = touch.dy = 0;
    touch.boost = touch.hold = false; lunge.active = false;
  }
  window.addEventListener('blur', releaseInputs);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseInputs(); lastNow = 0; } });
  // Any input ends the preview early — it eases out over PREVIEW_BLEND rather than cutting.
  const skipPreview = () => { if (P.preview > PREVIEW_BLEND) P.preview = PREVIEW_BLEND; };
  function startRoll(dir) {
    if (P.rollT > 0 || P.rollCool > 0 || P.done || P.preview > 0) return false;
    P.rollT = ROLL_T; P.rollDir = dir; P.rollCool = ROLL_T + ROLL_COOL; P.rolls++; P.rollScored = false;
    teach('roll', 'barrel roll · walls only graze you while you are over');
    beep(300, 0.12, 'sawtooth', 0.025); beep(460, 0.16, 'sawtooth', 0.02, null, 0.09);
    return true;
  }
  // Whether a released flick is a barrel roll. Pure, and exported, because it is the one piece of input
  // handling that cannot be tested through synthesised touch: a CDP swipe on a loaded machine takes over
  // a second of wall time for a flick a phone does in 110 ms, so the time limit can never be met from the
  // harness. Tested directly with exact numbers instead.
  //
  // In LANE mode (the phone default) the finger is not steering, so the LENGTH of the flick separates a
  // lunge from a roll and the time limit only rules out a slow deliberate drag. In FREE flight the finger
  // IS steering, so a roll must be a flick-and-release and the time limit is the real test.
  function rollFromFlick(ms, dx, dy, lane) {
    if (Math.abs(dx) <= Math.abs(dy) * 1.4) return false;
    return lane ? (ms < 420 && Math.abs(dx) >= 140) : (ms < 250 && Math.abs(dx) >= 70);
  }
  window.flyerRollFromFlick = rollFromFlick;
  window.flyerRoll = startRoll;
  // The test harness used to poll for the craft's peak excursion during a swipe. A lunge lasts 0.55 s, so
  // on a loaded machine the poll simply misses it and reports a failure that is not there — this cost a
  // whole session once. Record the peak in the GAME, where every frame is seen, and let the test read it.
  window.flyerPeakReset = () => { P.peakX = 0; P.peakY = 0; P.peakR = 0; P.peakF = 0; };
  window.flyerSkipPreview = skipPreview;
  const tapLast = { d: '', t: 0 };
  window.addEventListener('keydown', (e) => { skipPreview();
    ensureSound();
    if (e.key === 'p' || e.key === 'P') { if (!e.repeat) autopilot = !autopilot; e.preventDefault(); return; }
    const direction = STEER_CODES[e.code] || ARROWS[e.key];
    if (direction) {
      const lanes = window.foldSpacerLaneEngine;
      if (lanes) {
        if (!e.repeat && (direction === 'left' || direction === 'right')) {
          P.lane = lanes.shift(direction === 'left' ? -1 : 1);
          autopilot = false;
          beep(440 + (P.lane + 1) * 70, 0.04, 'square', 0.012);
        }
        e.preventDefault();
        return;
      }
      // Track physical keys separately: releasing D must not cancel a still-held Right arrow.
      const token = e.code || e.key;
      if (!e.repeat && !heldKeys.has(token) && !keys[direction]) {
        const d = direction, now = performance.now();
        if ((d === 'left' || d === 'right') && tapLast.d === d && now - tapLast.t < 320) { startRoll(d === 'right' ? 1 : -1); tapLast.t = 0; }
        else { tapLast.d = d; tapLast.t = now; }
      }
      heldKeys.set(token, direction); keys[direction] = true;
      autopilot = false; lunge.active = false; e.preventDefault(); }
    if (e.key === 'Shift' || e.key === ' ') { heldKeys.set(e.code || e.key, 'boost'); keys.boost = true; e.preventDefault(); }
    if (e.key === 'Control') { heldKeys.set(e.code || e.key, 'brake'); keys.brake = true; e.preventDefault(); }
    if (e.repeat) return;
    if (e.key === 'r' || e.key === 'R') reset();
    if (e.key === 'c' || e.key === 'C') { scheme = scheme === 'clustal' ? 'class' : 'clustal'; ghostDirty = true; flash = { text: scheme === 'clustal' ? 'side chains coloured by Clustal X residue type' : 'side chains coloured by chemical class', t: 2 }; }
    if (e.key === 'm' || e.key === 'M') { setMuted(!muted); if (!muted) ensureSound(); }
    if (e.key === 'n' || e.key === 'N') nextFold(P.done);
    if (e.key === 'Enter' && P.done) nextFold(true);
  });
  window.addEventListener('keyup', (e) => {
    const token = e.code || e.key;
    const direction = heldKeys.get(token) || STEER_CODES[e.code] || ARROWS[e.key];
    heldKeys.delete(token);
    if (direction) keys[direction] = Array.from(heldKeys.values()).includes(direction);
  });
  // touch: drag anywhere to steer (virtual stick around the first touch point), a second finger boosts
  const touch = { id: null, x0: 0, y0: 0, dx: 0, dy: 0, boost: false, boostId: null, t0: 0, hold: false, swiped: false };
  // lunge mode (Temple Run in a tube): the craft rests in the centre; a swipe snaps it toward that side
  // of the coil, holds a moment, and it springs back. Swipe toward a side chain as you reach it.
  let laneMode = true;
  const LUNGE = { hold: 0.3, wOut: 26, wFollow: 20, wBack: 12, px: 70 };
  // Trench driving, after Fold Racer: a bend throws you at the outside wall with -v²k, your steering is a
  // limited force against it, grip damps what is left, and the wall costs speed rather than bouncing you.
  const CORNER = 0.35, CORNER_CAP = 0.45; // share of the corner load applied, and of the steering it may eat
  // Walls do not bite. The corridor and the trench slot still CLAMP the craft — you can never fly through
  // the protein — but touching either costs nothing: no bounce, no thud, no shake, no speed penalty, no
  // broken slipstream. Set WALLS_BITE back to true to restore every penalty exactly as it was.
  //
  // Why: the corridor is an abstract tube that guarantees side chains are reachable, and it has no
  // relation to what is drawn. Measured over four folds, 78-98% of wall contacts happened with nothing
  // drawn within 0.5 A of the craft. Gating on that (WALL_SEEN) removed the phantom hits but left the
  // rule itself in place, and the ones that survived still read as arbitrary.
  const WALLS_BITE = false;
  const WALL_HIT = 0.88, WALL_SCRAPE = 1.6;
  // No punishment before the game has started. On the bundle the corridor is 1.45 Å wide and the first
  // side chain arrives at 1.0 s, so a player testing the controls reaches the wall at about 0.35 s and is
  // met with a shake, a beep and a speed penalty before anything has happened. For this long the wall
  // still stops the craft, silently.
  const PREVIEW_T = 3.2, PREVIEW_BLEND = 0.7;
  // Cofactors. Measured across the campaign, every heme, NADH and metal site sits 4.4-5.5 A off the rail
  // against a corridor radius of about 2 A, so none of them can be flown through or collected where they
  // stand. They are landmarks you fly PAST. The gate is therefore placed on the rail, at COF_GATE of the
  // corridor's own limit on the side the cofactor is on: to claim one you have to hug that wall as you go
  // by, which is exactly the side the structure is tight on. That trade is the mechanic.
  const COF_GATE = 0.72;     // fraction of the corridor limit where the gate sits
  const COF_R = 0.55;        // A: how close the craft must pass to the gate point
  const COF_WIN = 7;         // A of rail either side of closest approach: the run-up the marker is shown for
  // A cofactor is the rarest and riskiest thing on a fold, so it should read as a prize — but at 2000 the
  // three on 1M56 were worth about as much as all 48 of its side chains put together, which is not a
  // prize, it is the whole game. 1000 is two helix repairs and ten flips: clearly the best thing you can
  // take, and still a fold you win on side chains. Rank does not depend on score, so this moves nothing
  // but the number.
  // The corridor fit swings the lens around the tangent to dodge geometry. Measured over a whole 1M56
  // run it moved the lens more than 0.45 Å in a frame 220 times and hit the step budget 230 times — and
  // those lurches are the bumps. What it bought was ~6 frames per fold where the lens is a tenth of an
  // Å inside a ribbon, which the near-geometry fade already dissolves: screenshots at the worst frame
  // with and without are indistinguishable, and the one WITHOUT frames the craft better.
  // Set CAM_FIT back to true to restore it.
  const CAM_FIT = false;
  const CB_SLEW = 1.1;       // Å/s the camera trail may lengthen or shorten
  const DUCK_CLEAR = 0.12;   // Å of daylight to leave once out of a surface
  const DECK_MIN = 0.45;     // Å the lens must stay above a sheet deck
  const DECK_SLEW = 3.0;     // Å/s it may be lifted, or relax back
  const DUCK_SLEW = 4.5;     // Å/s the lens may be pushed out, or relax back
  const COF_SCORE = 1000;
  // Barrel roll. The HORIZON must not turn: the view roll is capped at 45 deg/s for comfort and spinning
  // the world would undo that at a stroke. So the roll is the HULL only, and it earns its place by doing
  // something: while the craft is inverted a wall bump is a graze, so a roll is how you ride out a corner
  // you took too wide. It costs nothing and cannot be spammed through the cooldown.
  const ROLL_T = 0.52;       // s for a full 360
  const ROLL_COOL = 0.85;    // s before another is allowed
  // Slipstream. The corridor edge is where the wall is and where the cofactor gates are, so flying out
  // there is already the risky line — this pays for it in the only currency a runner really wants, which
  // is speed. It builds slowly and falls away fast, so it rewards holding a line rather than clipping one.
  const GROOVE_EDGE = 0.72;  // fraction of the corridor limit that counts as riding the edge
  const GROOVE_UP = 1.3;     // s of edge-riding to reach full slipstream
  const GROOVE_DOWN = 0.55;  // s to lose it once you come off the edge
  const GROOVE_SPEED = 0.18; // top speed bonus, as a fraction of cruise
  // Precision pays in speed. A dead-centre pass gives an immediate, decaying surge, so a chain of perfects
  // feels like accelerating rather than like the same flight with a bigger number on it. It is added to
  // the player's cruise only — the autopilot flies a fixed speed, so acceptance budgets are untouched.
  const KICK_SPEED = 6;      // Å/s at full
  const KICK_DECAY = 1.25;   // s
  // A boost that just raises a number does not read as a boost. Punch the lens when it starts.
  const BOOST_KICK = 4;
  const BRAKE_TURN = 1.5;    // how much harder the craft turns while braking
  const KEY_W = 20;          // critically damped, like finger-following; acceleration is still capped
  const KEY_RAMP = 3.0;      // ramp reach, not direction: a second key / reversal responds immediately
  const COF_SWING = 1.55;    // the craft reaches a gate MOVING outward and must null that before it can
                            // come back, which the from-rest reach formula does not charge it for
  const COF_HEAD = 0.88;     // a gate placed exactly at the reach limit is neither fun nor robust
  const COF_SEP = 9;         // Å of rail two gates must be apart to both be flyable   // orbit the fold, then ease into the flight camera
  const WALL_GIVE = 1.0;    // Å the corridor may open beyond its abstract radius, where the protein allows
  const WALL_SEEN = 0.5;    // Å: how close a drawn surface must be for a stop to count as hitting something
  const WALL_GRACE = 1.6;
  const WALL_BUMP = 2.5;   // Å/s of outward speed below which touching the boundary is a graze, not a hit
  function cornerLoad(node) { // world units/s² along r
    return clamp(-P.speed * SC * (P.speed * SC) * (node.kr || 0) * CORNER, -A(LAT_ACC) * CORNER_CAP, A(LAT_ACC) * CORNER_CAP);
  }
  function gripAt(node) { // glycine runs are ice, as in the racer: less grip, softer steering
    const ri = clamp(Math.round(node.res), 0, seq.length - 1);
    let run = 0;
    for (let k = -2; k <= 2; k++) if (seq[clamp(ri + k, 0, seq.length - 1)] === 'G') run++;
    return run >= 3 ? { grip: 0.45, steer: 0.7, ice: true } : { grip: 1, steer: 1, ice: false };
  } // hold at the wall (s), spring stiffness (rad/s), px of drag for a full reach
  const lunge = { active: false, t: 0, ang: 0 };
  function laneSwipe(dirOrAngle) {
    P.keyActive = false;
    let ang = typeof dirOrAngle === 'number' ? dirOrAngle : { right: 0, up: Math.PI / 2, left: Math.PI, down: -Math.PI / 2 }[dirOrAngle];
    // snap to an upcoming inward side chain within ~35° of the swipe
    for (const b of blocks) {
      const ds = b.s - P.s;
      if (ds < -A(1) || ds > A(7) || b.type !== 'H' || b.judged) continue;
      const nb = rail.nodeAt(b.s), rel = V.sub(b.ca, nb.p);
      const phi = Math.atan2(V.dot(rel, nb.u), V.dot(rel, nb.r));
      let d = phi - ang; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 0.21) { ang = phi; } // a small nudge onto the side chain (~12°); the direction is yours
      break;
    }
    lunge.active = true; lunge.t = 0; lunge.ang = ang;
    autopilot = false;
    beep(440, 0.05, 'square', 0.015);
  }
  const TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  laneMode = true;
  const touchTarget = document.getElementById('stage') || glCanvas;
  const uiTouch = (e) => e.target && e.target.closest && e.target.closest('#intro, #help, #touchbar, #brakebtn, #boostbtn'); // let taps on UI become clicks
  // One handler set for both pointer events (preferred) and touch events (fallback).
  let doneAt = 0;
  function fingerDown(id, x, y) {
    if (P.preview > 0) return;   // the preview swallows the update, so a lunge started here would stick
    if (P.done && doneAt && performance.now() - doneAt > 800) { nextFold(true); return; }
    if (touch.id === null) { P.keyActive = false; touch.id = id; touch.x0 = x; touch.y0 = y; touch.dx = 0; touch.dy = 0; touch.t0 = performance.now(); touch.hold = false; touch.swiped = false; if (!laneMode) autopilot = false; }
    else if (touch.boostId === null) { touch.boostId = id; touch.boost = true; }
  }
  function fingerMove(id, x, y) {
    if (P.preview > 0) return;   // the preview swallows the update, so a lunge started here would stick
    if (id !== touch.id) return;
    touch.dx = x - touch.x0; touch.dy = y - touch.y0;
    if (laneMode && lunge.active && Math.hypot(touch.dx, touch.dy) > 12) lunge.active = false; // a new drag takes over from a lunge
  }
  function fingerUp(id) {
    if (P.preview > 0) return;   // the preview swallows the update, so a lunge started here would stick
    if (id === touch.id) {
      const lanes = window.foldSpacerLaneEngine;
      if (lanes && Math.abs(touch.dx) >= 24 && Math.abs(touch.dx) > Math.abs(touch.dy) * 1.2) {
        P.lane = lanes.shift(touch.dx < 0 ? -1 : 1);
        autopilot = false;
        beep(440 + (P.lane + 1) * 70, 0.04, 'square', 0.012);
      }
      // a quick flick is a lunge: it holds at the wall for a moment before springing back
      // A hard, fast, mostly sideways flick is a roll. Phones default to LANE mode, so gating this on free
      // flight — as the first build did — left the roll unreachable for almost every player. In lane mode
      // it layers on top of the lunge instead: an ordinary flick lunges, a much harder one lunges AND
      // rolls. The bar is set well above the ordinary flick so a normal lunge never triggers one.
      const flickMs = performance.now() - touch.t0;
      if (!lanes && laneMode && flickMs < 260 && Math.hypot(touch.dx, touch.dy) >= 26) laneSwipe(Math.atan2(-touch.dy, touch.dx));
      if (!lanes && rollFromFlick(flickMs, touch.dx, touch.dy, laneMode)) startRoll(touch.dx > 0 ? 1 : -1);
      touch.id = null; touch.dx = 0; touch.dy = 0; touch.hold = false;
    }
    if (id === touch.boostId) { touch.boostId = null; touch.boost = false; }
  }
  if (window.PointerEvent) {
    touchTarget.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || uiTouch(e)) return;
      ensureSound(); fingerDown(e.pointerId, e.clientX, e.clientY);
      if (e.cancelable) e.preventDefault();
    });
    touchTarget.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || uiTouch(e)) return; fingerMove(e.pointerId, e.clientX, e.clientY); if (e.cancelable) e.preventDefault(); });
    touchTarget.addEventListener('pointerup', (e) => fingerUp(e.pointerId));
    touchTarget.addEventListener('pointercancel', (e) => fingerUp(e.pointerId));
    // stop the browser from turning the gesture into a scroll or a page swipe
    touchTarget.addEventListener('touchstart', (e) => { if (!uiTouch(e) && e.cancelable) e.preventDefault(); }, { passive: false });
    touchTarget.addEventListener('touchmove', (e) => { if (!uiTouch(e) && e.cancelable) e.preventDefault(); }, { passive: false });
  } else {
    touchTarget.addEventListener('touchstart', (e) => { skipPreview();
      if (uiTouch(e)) return;
      ensureSound();
      for (const t of e.changedTouches) fingerDown(t.identifier, t.clientX, t.clientY);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    touchTarget.addEventListener('touchmove', (e) => {
      if (uiTouch(e)) return;
      for (const t of e.changedTouches) fingerMove(t.identifier, t.clientX, t.clientY);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const touchEnd = (e) => { for (const t of e.changedTouches) fingerUp(t.identifier); };
    touchTarget.addEventListener('touchend', touchEnd); touchTarget.addEventListener('touchcancel', touchEnd);
  }
  // on-screen buttons and scripted actions
  window.flyerAction = (name) => {
    ensureSound();
    if (name === 'start') { introBlend = introPose ? 0.85 : 0; paused = false; syncSound(); return; }
    if (name === 'resume') { paused = false; syncSound(); return; }
    if (name === 'pause') {
      paused = true;
      syncSound();
      releaseInputs();
      return;
    }
    if (name === 'autopilot') autopilot = !autopilot;
    else if (name === 'restart') reset();
    else if (name === 'next') nextFold(P.done);
    else if (name === 'colours') { scheme = scheme === 'clustal' ? 'class' : 'clustal'; ghostDirty = true; }
    else if (name === 'boostOn') keys.boost = true;
    else if (name === 'boostOff') keys.boost = false;
    else if (name === 'brakeOn') keys.brake = true;
    else if (name === 'brakeOff') keys.brake = false;
    else if (name === 'sound') { setMuted(!muted); if (!muted) ensureSound(); }
    else if (name === 'lanes') { laneMode = !laneMode; flash = { text: laneMode ? 'touch: drag to steer, release to snap back, flick to lunge' : 'free flight: drag to steer', t: 2.5 }; }
  };

  glCanvas.addEventListener('click', () => { skipPreview(); if (P.done && doneAt && performance.now() - doneAt > 800) nextFold(true); });
  // exposed so the drop path can be exercised in a test rather than only by a human dragging a file
  window.__load = (st) => loadFold({ id: 'DROP', title: st.title, seq: st.seq, num: st.num, ca: st.ca, sc: st.sc, meta: st.meta });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const st = parseStructure(text);
        loadFold({ id: file.name.replace(/\.(pdb|cif|ent)$/i, '').toUpperCase(), title: st.title, seq: st.seq, num: st.num, ca: st.ca, sc: st.sc, meta: st.meta });
      } catch (err) { flash = { text: 'could not read ' + file.name + ': ' + err.message, t: 4 }; }
    });
  });

  function nextFold(keep) {
    if (keep && P.done) carry = { score: P.score, combo: P.combo, folds: P.runFolds + 1 };
    foldIdx = (foldIdx + 1) % FOLDS.length; loadFold(expandFold(FOLDS[foldIdx]));
  }
  window.loadFoldIndex = (i) => { foldIdx = clamp(i, 0, FOLDS.length - 1); loadFold(expandFold(FOLDS[foldIdx])); };
  window.setAutopilot = (on) => { autopilot = !!on; };
  window.pressKey = (k, down) => { keys[k] = !!down; if (down) skipPreview(); if (['left', 'right', 'up', 'down'].includes(k)) autopilot = false; };

  // ---------------------------------------------------------------- update
  // Autopilot: aim at the stem of the next inward side chain (fly into it).
  let grazeBlock = null;
  function grazeTarget() {
    let nextH = null; grazeBlock = null;
    for (const b of blocks) {
      const ds = b.s - P.s;
      if (ds < -A(0.5) || ds > A(TUNE.horizon)) continue;
      if (b.type !== 'H' || b.judged) continue;
      nextH = b; break;
    }
    if (!nextH) return null;
    grazeBlock = nextH;
    const nb = rail.nodeAt(nextH.s);
    const rel = V.sub(nextH.ca, nb.p);
    let ex = V.dot(rel, nb.r), ey = V.dot(rel, nb.u);
    const l = Math.hypot(ex, ey) || 1; ex /= l; ey /= l;             // radial direction of the block
    const nbA = rail.nodeAt(nextH.s), a = nextH.aim || { x: 1.2, y: 0 };
    const wp = V.add(nbA.p, V.add(V.scale(nbA.r, A(a.x)), V.scale(nbA.u, A(a.y))));
    const relA = V.sub(wp, nbA.p);
    return [V.dot(relA, nbA.r), V.dot(relA, nbA.u)];
  }

  function assistTarget() {
    const node = rail.nodeAt(P.s);
    let ax = 0, ay = 0, cnt = 0;
    for (const b of blocks) {
      const ds = b.s - P.s;
      if (ds < 0 || ds > A(9)) continue;
      if (b.type === 'H' && (b.judged || autopilot)) continue;
      if (autopilot && ds > A(4)) continue; // autopilot only dodges what is imminent
      if (autopilot && grazeBlock && b.s > grazeBlock.s) continue; // ...and only what lies before the side chain it is aiming for
      const tip = V.add(b.ca, V.scale(blockDir(b), A(blockLen(b))));
      const nb = rail.nodeAt(b.s);
      const rel = V.sub(tip, nb.p);
      const bx = V.dot(rel, nb.r), by = V.dot(rel, nb.u);
      const d = Math.hypot(bx, by);
      if (d > 1.3 * nb.R || d < 1e-6) continue;
      const w = 1 - ds / A(9);
      ax -= bx / d * w; ay -= by / d * w; cnt++;
    }
    if (!cnt) return [0, 0];
    const tr = clamp(((node.trench || 0) - 0.3) / 0.4, 0, 1);
    return [ax / cnt * 0.7 * (tr > 0 ? A(TRENCH_HALF) / 0.7 : node.R), ay / cnt * 0.7 * node.R * (1 - tr)];
  }

  // Par is the time a flawless run actually takes on THIS fold, not a flat speed. The corner brake and
  // the view-rotation cap slow the craft wherever the rail bends, so a fixed 18 Å/s par is unreachable on
  // a convoluted fold — a run that collected everything, perfected everything and hit nothing was being
  // given an A because the clock said so. Integrate the speed the game will actually allow.
  let parT = 0;
  function computePar() {
    parT = 0;
    if (!rail) return;
    const step = A(0.5);
    for (let sq = 0; sq < rail.length; sq += step) {
      const tNow = rail.nodeAt(sq).t;
      const ang = (d) => Math.acos(clamp(V.dot(tNow, rail.nodeAt(sq + A(d)).t), -1, 1)) * 180 / Math.PI / d;
      const bend = Math.acos(clamp(V.dot(tNow, rail.nodeAt(sq + A(8)).t), -1, 1)) * 180 / Math.PI;
      const turnFactor = clamp(1 - (bend - TUNE.bendStart) / TUNE.bendSpan, TUNE.minTurn, 1);
      const flat = BASE_SPEED + RAMP_SPEED * clamp(sq / rail.length, 0, 1);
      let v = flat * turnFactor;
      const kDeg = Math.max(ang(1), ang(3));
      if (kDeg > 0.02) v = Math.min(v, Math.max(OMEGA_MAX / kDeg, flat * TUNE.minTurn));
      parT += (step / SC) / Math.max(1, v);
    }
  }
  window.flyerPar = () => parT;
  function rankFor() {
    const par = parT || rail.length / A(BASE_SPEED + RAMP_SPEED / 2);
    const frac = totalHelix ? P.fixed / totalHelix : 1;
    let r = frac >= 1 ? 0 : frac >= 0.85 ? 1 : frac >= 0.6 ? 2 : frac >= 0.3 ? 3 : 4;
    if (P.t > par) r++;   // par is now this fold's own ideal-line time; collecting and combo beat it
    return 'SABCD'[Math.min(4, r)];
  }

  function update(dt) {
    if (!rail) return;
    introBlend = Math.max(0, introBlend - dt);
    if (P.preview > 0) {
      P.preview = Math.max(0, P.preview - dt);
      const frac = 1 - P.preview / PREVIEW_T;
      const pv = previewPose(frac);
      if (P.preview < PREVIEW_BLEND) {          // ease into exactly where the flight camera starts
        const fs = flightStartPose();
        let k = 1 - P.preview / PREVIEW_BLEND; k = k * k * (3 - 2 * k);
        cam.pos = V.lerp(pv.pos, fs.pos, k);
        cam.fwd = V.norm(V.lerp(pv.fwd, fs.fwd, k));
        cam.up = V.norm(V.perp(V.lerp(pv.up, fs.up, k), cam.fwd));
      } else { cam.pos = pv.pos; cam.fwd = pv.fwd; cam.up = V.norm(V.perp(pv.up, cam.fwd)); }
      cam.fov = 76; cam.fovDraw = 76;
      if (titleCardT > 0) titleCardT -= dt;
      if (flash.t > 0) flash.t -= dt;
      updateGlows(dt);
      status.preview = +P.preview.toFixed(2);
      P.camPrevPos = null;                      // the step limiter must not fight the hand-over
      if (P.preview > 0) return;
    }
    status.preview = 0;
    P.t += P.done ? 0 : dt;
    P.shake *= Math.exp(-6 * dt);
    if (P.rollT > 0) P.rollT = Math.max(0, P.rollT - dt);
    P.kick = Math.max(0, P.kick - dt / KICK_DECAY);
    // record the ghost: s in 0.1 Å, x and y in 0.01 Å, as plain integers
    if (ghostRec && !P.done && P.t >= ghostNext) {
      ghostNext = P.t + 1 / GHOST_HZ;
      ghostRec.push(Math.round(P.s / SC * 10), Math.round(P.x / SC * 100), Math.round(P.y / SC * 100));
    }
    if (P.rollCool > 0) P.rollCool = Math.max(0, P.rollCool - dt);
    P.flashT = Math.max(0, P.flashT - dt * 3); P.scrape = Math.max(0, (P.scrape || 0) - dt); P.fovKick *= Math.exp(-9 * dt); P.comboPop = Math.max(0, P.comboPop - dt * 3.5);
    updateGlows(dt);
    if (flash.t > 0) flash.t -= dt;
    if (titleCardT > 0) titleCardT -= dt;
    for (const q of pops) q.age += dt;
    pops = pops.filter((q) => q.age < 1.1);

    // forward speed: ramps with progress and combo
    const progress = P.s / rail.length;
    // brake into sharp turns: how much the rail bends over the next 8 Å
    const tNow = rail.nodeAt(P.s).t, tAhead = rail.nodeAt(P.s + A(8)).t;
    const bend = Math.acos(clamp(V.dot(tNow, tAhead), -1, 1)) * 180 / Math.PI;
    const turnFactor = window.CAM_OLD ? 1 : clamp(1 - (bend - TUNE.bendStart) / TUNE.bendSpan, TUNE.minTurn, 1);   // straight: 1, sharp bend: minTurn
    P.bendAhead = bend; P.bendDir = V.sub(tAhead, tNow); // for the HUD turn indicator
    // slipstream: riding the outer corridor builds speed; coming off it, or scraping, drops it
    {
      const nEdge = rail.nodeAt(P.s);
      const limE = Math.max(nEdge.R - A(WALL_MARGIN), A(CRAFT_R + 0.06));
      const edge = limE > 0 ? Math.hypot(P.x, P.y) / limE : 0;
      // NOT gated on P.flashT: that is set to 1 by impact() on every side chain you collect, not just on
      // wall contact, so gating on it wiped the slipstream every time you scored — which is constantly.
      // A real wall hit zeroes P.groove where it happens, which is the correct and only place for it.
      const riding = !P.done && !autopilot && P.preview <= 0 && edge > GROOVE_EDGE;
      if (riding && P.groove > 0.25) teach('groove', 'slipstream · hold the edge of the corridor for speed');
      P.groove = clamp(P.groove + (riding ? dt / GROOVE_UP : -dt / GROOVE_DOWN), 0, 1);
      P.grooveBest = Math.max(P.grooveBest, P.groove);
    }
    // Side chains are PLACED against MAX_CRUISE: buildBlocks asks whether a player at that speed can cross
    // from one to the next, and drops the ones that fail. So a speed bonus that goes past it silently
    // un-places them again — measured, holding full slipstream would have cost 3-9 side chains a fold,
    // up to 40% on 1BCF, with no warning to the player. The guarantee that everything on screen is
    // reachable at the speed you are actually flying is the spine of this game and outranks a new toy.
    // The bonuses therefore carry you TO the ceiling sooner and hold you there through bends, where the
    // corner brake would otherwise have you crawling; the reward for the risky line is paid in score.
    // window.NOFUN=1 turns the movement bonuses off, so any comfort metric can be measured with and
    // without them rather than argued about.
    const gSp = window.NOFUN ? 0 : GROOVE_SPEED, kSp = window.NOFUN ? 0 : KICK_SPEED;
    const cruiseBase = BASE_SPEED + RAMP_SPEED * progress + COMBO_SPEED * Math.min(P.combo, 12);
    const cruiseFlat = Math.min(MAX_CRUISE, cruiseBase * (1 + gSp * P.groove)
      + (autopilot ? 0 : kSp * P.kick));
    const cruise = cruiseFlat * turnFactor;
    const boosting0 = keys.boost || touch.boost; // touch: a second finger boosts
    if (boosting0 && !P.wasBoost && !P.done && P.preview <= 0) {
      P.fovKick = Math.max(P.fovKick, BOOST_KICK);
      beep(160, 0.18, 'sawtooth', 0.03); beep(240, 0.22, 'sawtooth', 0.022, null, 0.06);
    }
    P.wasBoost = boosting0;
    let target = P.done ? 0 : autopilot ? 15 * turnFactor : boosting0 ? cruise + BOOST_ADD * turnFactor : keys.brake ? BRAKE_SPEED : cruise;
    if (window.ORACLE && !P.done) target *= (P.oracleEase === undefined ? 1 : P.oracleEase);
    // The view turns exactly as fast as the rail does — measured, the camera's rate sits just under the
    // path's on every fold. The bend above is averaged over 8 Å, so a short sharp kink slips through it
    // and whips the screen. Cap the rate the path itself can rotate the view, by speed, on the local turn.
    if (!P.done && !window.CAM_OLD) {
      // Read the sharpest local turn, not the average of one. 1QJ8's rail has kinks of 100–142 °/Å at
      // its hairpins; a 3 Å window averages them away and the craft arrives at full speed into a corner
      // no camera can follow.
      const ang = (d) => Math.acos(clamp(V.dot(tNow, rail.nodeAt(P.s + A(d)).t), -1, 1)) * 180 / Math.PI / d;
      const kDeg = Math.max(ang(1), ang(3));
      // The floor is a fraction of the UNREDUCED cruise. Taking it off `cruise`, which the corner brake
      // has already cut to a third, let the two compound: 1TIM crawled to 3.7 Å/s at one kink, which is
      // not easing off a corner, it is stopping.
      if (kDeg > 0.02) target = Math.min(target, Math.max(OMEGA_MAX / kDeg, cruiseFlat * TUNE.minTurn));
    }
    P.speed += (target - P.speed) * (1 - Math.exp(-2.5 * dt));
    if (!P.done && P.t > 3 && !autopilot) status.slowMin = Math.min(status.slowMin === undefined ? 99 : status.slowMin, +P.speed.toFixed(1));
    if (P.done) P.speed *= Math.exp(-4 * dt);
    P.boostGlow += (((boosting0 && !P.done) ? 1 : 0) - P.boostGlow) * Math.min(1, 4 * dt);
    P.s = Math.min(rail.length, P.s + A(P.speed) * dt);

    // lateral control
    const stick = touch.id !== null && !laneMode;
    const keyboard = keys.left || keys.right || keys.up || keys.down;
    const hands = keyboard || stick;
    let springIntegrated = false;
    if (!keyboard) P.keyReach = 0;
    const laneEngine = window.foldSpacerLaneEngine;
    if (laneEngine && !autopilot && !P.done) {
      springIntegrated = true;
      P.lane = laneEngine.getLane();
      const spacing = laneSpacingAt(rail.nodeAt(P.s));
      const targetX = laneEngine.targetX(spacing);
      const oldX = P.x, oldY = P.y;
      P.x = laneEngine.easeToward(P.x, targetX, 18, dt);
      P.y = laneEngine.easeToward(P.y, 0, 22, dt);
      if (dt > 0) { P.vx = (P.x - oldX) / dt; P.vy = (P.y - oldY) / dt; }
      P.keyActive = false;
    } else if (laneMode && !keyboard && !P.keyActive && !autopilot && !P.done) {
      springIntegrated = true;
      // lunge: a critically damped spring toward the swiped side while holding, then back to the centre
      // how far the finger can send the craft: a disc inside a helix, the full slot width in a trench
      const nodeR = rail.nodeAt(P.s);
      const trR = clamp(((nodeR.trench || 0) - 0.3) / 0.4, 0, 1);
      const ring = Math.min(A(1.25), 0.75 * (nodeR.R - A(WALL_MARGIN)));
      const ringX = ring + (A(TRENCH_HALF - 0.15) - ring) * trR, ringY = ring * (1 - trR);
      let tx = 0, ty = 0, w = LUNGE.wBack;
      if (lunge.active) {
        lunge.t += dt;
        if (lunge.t < LUNGE.hold) { tx = Math.cos(lunge.ang) * ringX; ty = Math.sin(lunge.ang) * ringY; w = LUNGE.wOut; }
        else if (lunge.t > LUNGE.hold + 0.6 && Math.hypot(P.x, P.y) < A(0.05)) lunge.active = false;
      } else if (touch.id !== null) {
        // finger following: the craft goes where the finger points, relative to where it landed
        let fx = touch.dx / LUNGE.px, fy = -touch.dy / LUNGE.px;
        const m = Math.hypot(fx, fy); if (m > 1) { fx /= m; fy /= m; }
        tx = fx * ringX; ty = fy * ringY; w = LUNGE.wFollow;
      }
      if (window.LAZY) { tx = Math.cos(P.t * 1.5) * A(window.LAZY); ty = Math.sin(P.t * 1.5) * A(window.LAZY); w = LUNGE.wFollow; } // dev: mindless circling, no aiming
      const nodeT = rail.nodeAt(P.s);
      const trD = clamp(((nodeT.trench || 0) - 0.3) / 0.4, 0, 1);
      const gp = trD > 0.5 ? gripAt(nodeT) : { grip: 1, steer: 1, ice: false };
      const load = trD > 0.5 ? cornerLoad(nodeT) * trD : 0;
      P.ice = gp.ice && trD > 0.5;
      const steps = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        // your steering is a force, not a teleport: in a bend the corner load eats into it
        let ax = (w * w * (tx - P.x) - 2 * w * P.vx) * gp.steer;
        ax = clamp(ax, -A(LAT_ACC), A(LAT_ACC)) + load;
        P.vx += ax * h;
        P.vy += (w * w * (ty - P.y) - 2 * w * P.vy) * h;
        P.x += P.vx * h; P.y += P.vy * h;
      }
      if (window.TRACE_LUNGE) (status.traj = status.traj || []).push([+P.t.toFixed(2), +(P.x / SC).toFixed(2), +(P.y / SC).toFixed(2), lunge.active ? 1 : 0, +lunge.t.toFixed(2), +(Math.hypot(P.x, P.y) / SC).toFixed(2), +(tx / SC).toFixed(2)]);
    } else if (window.CASUAL && !P.done) {
      // A deliberately imperfect player, for balance measurement. The oracle says what is POSSIBLE; this
      // says what an ordinary run looks like — reaction delay, a shaky aim, and a share of side chains
      // simply not gone for. Nothing else in the harness measures whether the game is too hard.
      const acc = A(LAT_ACC), nodeC = rail.nodeAt(P.s);
      const lag = +(window.CASUAL_LAG || 0.28), err = +(window.CASUAL_ERR || 0.30), skip = +(window.CASUAL_SKIP || 0.15);
      let tx = 0, ty = 0, have = false;
      for (const b of blocks) {
        const ds = b.s - P.s;
        if (ds < -A(0.3) || ds > A(14) || b.type !== 'H' || b.judged) continue;
        if (b.casualSkip === undefined) { let h = Math.sin(b.s * 12.9898) * 43758.5453; b.casualSkip = (h - Math.floor(h)) < skip; }
        if (b.casualSkip) continue;
        // aim at where the side chain was `lag` seconds ago in the craft's own frame: a late reaction
        const nb0 = rail.nodeAt(b.s - A(P.speed * lag)), aimA = b.aim || { x: 1.2, y: 0 };
        const mid = V.add(nb0.p, V.add(V.scale(nb0.r, A(aimA.x)), V.scale(nb0.u, A(aimA.y))));
        const relW = V.sub(mid, nodeC.p);
        let jx = Math.sin(b.s * 7.13) * err, jy = Math.cos(b.s * 3.71) * err;
        tx = V.dot(relW, nodeC.r) + A(jx); ty = V.dot(relW, nodeC.u) + A(jy); have = ds; break;
      }
      if (!have) { const [ax2, ay2] = assistTarget(); tx = ax2; ty = ay2; }
      const vdx = (tx - P.x) / 0.16, vdy = (ty - P.y) / 0.16;
      if (dt > 0) {
        P.vx += clamp((vdx - P.vx) / dt, -acc, acc) * dt;
        P.vy += clamp((vdy - P.vy) / dt, -acc, acc) * dt;
      }
      status.casual = true;
    } else if (window.ORACLE && !P.done) {
      // Oracle player: perfect knowledge, human limits (36 Å/s² per axis with the same damping).
      // Aims for the nearest point on the next inward side chain's stem; between side chains, dodges sheet side chains.
      const acc = A(LAT_ACC), nodeO = rail.nodeAt(P.s);
      let tx = 0, ty = 0, have = false;
      for (const b of blocks) {
        const ds = b.s - P.s;
        if (ds < -A(0.3) || ds > A(14) || b.type !== 'H' || b.judged) continue;
        // far away: aim by the stem's angle in its own frame (robust to rail bends between here and there);
        // close in: aim at the stem's true position in space seen from the current cross-section. Blend over the last 6 Å.
        const nb0 = rail.nodeAt(b.s), aimA = b.aim || { x: 1.2, y: 0 };
        const mid = V.add(nb0.p, V.add(V.scale(nb0.r, A(aimA.x)), V.scale(nb0.u, A(aimA.y))));
        const nb = nb0, relF = V.sub(mid, nb.p);
        const fx = V.dot(relF, nb.r), fy = V.dot(relF, nb.u);
        const relW = V.sub(mid, nodeO.p);
        const wx = V.dot(relW, nodeO.r), wy = V.dot(relW, nodeO.u);
        const wgt = clamp(1 - ds / A(6), 0, 1);
        tx = fx + (wx - fx) * wgt; ty = fy + (wy - fy) * wgt; have = ds; break;
      }
      // A cofactor gate competes with the next side chain: whichever is nearer along the rail wins. The
      // oracle exists to prove what a perfect player can reach, so if it cannot claim a cofactor the gate
      // is misplaced and the fairness check should say so.
      for (const c of cofs) {
        const ds = c.s - P.s;
        if (c.judged || ds < -A(0.3) || ds > A(14)) continue;
        // A gate is worth several side chains, so a greedy nearest-target oracle will happily trade one
        // away — which drops a flawless run from S to A. The gate is a detour taken ON THE WAY, so only
        // divert when the next side chain is far enough behind it to still be caught afterwards.
        if (have !== false && have <= ds) continue;
        const nb0 = rail.nodeAt(c.s);
        const gp = V.add(nb0.p, V.add(V.scale(nb0.r, A(c.dx * c.off)), V.scale(nb0.u, A(c.dy * c.off))));
        const relW = V.sub(gp, nodeO.p);
        tx = V.dot(relW, nodeO.r); ty = V.dot(relW, nodeO.u); have = ds;
      }
      if (!have) { const [ax2, ay2] = assistTarget(); tx = ax2; ty = ay2; }
      // Bang-bang toward a desired velocity, limited like key input. The time constant tightens as the
      // side chain comes up: a fixed 0.1 s leaves the oracle arriving a few hundredths of an angstrom
      // off, which is the whole reason it was dropping perfects it should have had. The acceleration is
      // still clamped to the human limit, so this stays a feasible line rather than a cheat.
      // The slipstream and the perfect-kick can carry the craft past the speed the fairness model
      // guarantees a crossing at, and then a side chain it should have had goes by unreachable — which is
      // exactly what happened on 1QJ8. A perfect player eases off for a crossing they cannot otherwise
      // make, so the oracle does too; this is the benchmark for "flawless", not a free ride.
      P.oracleEase = 1;
      if (have) {
        const need = Math.hypot(tx - P.x, ty - P.y) / SC;
        const vt = LAT_ACC / LAT_DAMP, tAvail = (have / SC) / Math.max(1, P.speed);
        const can = vt * (tAvail - (1 - Math.exp(-LAT_DAMP * tAvail)) / LAT_DAMP);
        if (can < need && need > 1e-3) {
          // the speed at which the same crossing does fit, as a fraction of the current one
          P.oracleEase = clamp(can / need, 0.35, 1);
        }
      }
      const tau = have ? clamp((have / SC) / Math.max(1, P.speed) * 0.45, 0.05, 0.1) : 0.1;
      const vdx = (tx - P.x) / tau, vdy = (ty - P.y) / tau;
      // frame(0) is also the frozen-render diagnostic; 0/0 there must not poison the next flight step.
      if (dt > 0) {
        P.vx += clamp((vdx - P.vx) / dt, -acc, acc) * dt;
        P.vy += clamp((vdy - P.vy) / dt, -acc, acc) * dt;
      }
      status.oracle = true;
    } else if ((hands || P.keyActive) && !autopilot && !P.done) {
      springIntegrated = true;
      P.keyActive = true;
      // A position spring for keyboard / free-touch steering, kept alive until release has settled.
      // Integrate it only here: the old common damping/position step advanced the craft a second time.
      // Acceleration remains capped at LAT_ACC; corridor, corner loads and brake advantage are intact.
      const braking = keys.brake;   // the phone brake button sets keys.brake too, via flyerAction
      if (braking && !P.done) teach('brake', 'brake · you turn harder while slowing');
      const nodeK = rail.nodeAt(P.s);
      const trK = clamp(((nodeK.trench || 0) - 0.3) / 0.4, 0, 1);
      // The finger's ring is 75% of the corridor, because a thumb needs somewhere to aim short of the
      // wall. A key is not aiming — it is a direction — so it targets the corridor limit itself, which is
      // exactly how far the old acceleration could take you. The feel changes; the reach does not.
      const ringK = Math.max(A(0.35), nodeK.R - A(WALL_MARGIN));
      const ringKX = ringK + (A(TRENCH_HALF - 0.15) - ringK) * trK, ringKY = ringK * (1 - trK);
      // Ramp only the distance. Independent axis ramps made a new diagonal take half a second,
      // and a reversal a full second. Normalising also removes the diagonal speed advantage.
      const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const ky = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      const km = Math.hypot(kx, ky) || 1;
      let tx, ty;
      if (stick) {                               // a touch device in free flight: proportional, as before
        const R0 = 60;
        tx = clamp(touch.dx / R0, -1, 1) * ringKX; ty = clamp(-touch.dy / R0, -1, 1) * ringKY;
      }
      const accK = A(LAT_ACC) * (braking ? BRAKE_TURN : 1);
      const wK = braking ? KEY_W * 1.15 : KEY_W;
      const gp = trK > 0.5 ? gripAt(nodeK) : { steer: 1, ice: false };
      const load = trK > 0.5 ? cornerLoad(nodeK) * trK : 0;
      P.ice = gp.ice && trK > 0.5;
      const stepsK = Math.max(1, Math.ceil(dt / 0.008)), hK = dt / stepsK;
      for (let i = 0; i < stepsK; i++) {
        if (!stick) {
          P.keyReach = keyboard ? Math.min(1, (P.keyReach || 0) + KEY_RAMP * hK) : 0;
          tx = kx / km * P.keyReach * ringKX; ty = ky / km * P.keyReach * ringKY;
        }
        let ax = (wK * wK * (tx - P.x) - 2 * wK * P.vx) * gp.steer;
        ax = clamp(ax, -accK, accK) + load;
        let ay = wK * wK * (ty - P.y) - 2 * wK * P.vy;
        ay = clamp(ay, -accK, accK);
        P.vx += ax * hK; P.vy += ay * hK;
        P.x += P.vx * hK; P.y += P.vy * hK;
      }
      if (!hands && Math.hypot(P.x, P.y) < A(0.02) && Math.hypot(P.vx, P.vy) < A(0.1)) P.keyActive = false;
    } else if (!P.done) {
      const gz = autopilot ? grazeTarget() : null;
      let [tx, ty] = assistTarget();
      let g = ASSIST_GAIN;
      if (autopilot) {
        g = TUNE.gain;
        if (gz) { tx = gz[0]; ty = gz[1]; }
      }
      P.vx += (tx - P.x) * g * 4 * dt * 2;
      P.vy += (ty - P.y) * g * 4 * dt * 2;
    }
    if (!springIntegrated) {
      const nodeT = rail.nodeAt(P.s), trD = clamp(((nodeT.trench || 0) - 0.3) / 0.4, 0, 1);
      const gp = trD > 0.5 ? gripAt(nodeT) : { grip: 1, steer: 1, ice: false };
      P.ice = gp.ice && trD > 0.5;
      if (trD > 0.5 && !autopilot && !window.ORACLE) P.vx += cornerLoad(nodeT) * trD * dt;
      P.vx /= (1 + LAT_DAMP * gp.grip * dt); P.vy /= (1 + LAT_DAMP * dt);
      P.x += P.vx * dt; P.y += P.vy * dt;
    }

    // corridor
    const node = rail.nodeAt(P.s);
    const trench = clamp(((node.trench || 0) - 0.3) / 0.4, 0, 1); // 1 over a β-sheet: trench run, left/right only
    if (trench > 0) {
      const k = Math.min(1, 12 * dt) * trench;
      P.y += (0 - P.y) * k; P.vy *= 1 - k;                    // height locked over the sheet
      const half = A(P.x >= 0 ? (node.slotR || TRENCH_HALF) : (node.slotL || TRENCH_HALF));
      if (Math.abs(P.x) > half) {
        const sgn = Math.sign(P.x);
        P.x = sgn * half;
        const vout = P.vx * sgn;
        // Only call it a collision if the player can see what they hit. Measured over four folds, 78–98 %
      // of wall contacts happened with no drawn surface within 0.5 Å — the corridor is an abstract tube,
      // so the craft was being shaken and slowed by nothing at all.
      const atSurface = ribbonClear(V.add(node.p, V.add(V.scale(node.r, P.x), V.scale(node.u, P.y))), 0, 0) < WALL_SEEN;
      if (WALLS_BITE && vout > A(WALL_BUMP) && P.flashT < 0.75 && P.t > WALL_GRACE && atSurface) {   // leaning on the wall costs speed, as in the racer
          if (!P.scrape) {
            P.speed *= WALL_HIT; beep(90, 0.12, 'sawtooth', 0.04);
            P.shake = Math.max(P.shake, 0.2); P.shakeDir = V.scale(node.r, -sgn);
            P.shakeT0 = P.t; P.shakeSign = -sgn;
            (status.wall = status.wall || []).push({ kind: 'slot', res: Math.round(node.res), x: +(P.x / SC).toFixed(2), half: +(half / SC).toFixed(2), t: +P.t.toFixed(1) });
          }
          P.speed = Math.max(8, P.speed * (1 - WALL_SCRAPE * dt));
          P.vx *= 0.3; P.scrape = 0.12; P.scrapeSide = sgn;
        } else if (vout > 0) P.vx *= 0.3;                      // a graze: stop drifting outward, say nothing
      }
    }
    // The corridor is R minus a safety margin, but on a few nodes R itself is so small that the margin
    // eats it entirely: 1LDG 32–33 and 1M56 48–49 leave 0.10–0.22 Å for a craft of 0.24. The ship cannot
    // fit, so those residues scrape whatever the player does. Never let it close below the hull.
    const limBase = Math.max(node.R - A(WALL_MARGIN), A(CRAFT_R + 0.06));
    const rr = Math.hypot(P.x, P.y);
    // Then let it out to where the protein actually is. The corridor is an abstract tube that guarantees
    // side chains are reachable; it has no relation to what is drawn, which is why a stop could happen
    // with nothing within 5 Å. When the craft is pressed against it, march outward and give it whatever
    // room the drawn surface allows, up to WALL_GIVE. The corridor can only widen, never shrink, so every
    // aim point stays exactly as reachable as before.
    let lim = limBase;
    if (rr > limBase * 0.85 && trench < 1) {
      const ux = P.x / (rr || 1), uy = P.y / (rr || 1);
      for (let e = 0.2; e <= WALL_GIVE + 1e-6; e += 0.2) {
        const rad = limBase + A(e);
        const p = V.add(node.p, V.add(V.scale(node.r, ux * rad), V.scale(node.u, uy * rad)));
        if (ribbonClear(p, 0, 0) < CRAFT_R + 0.45) break;
        lim = rad;
      }
    }
    if (rr > lim && trench < 1) {
      const nx = P.x / rr, ny = P.y / rr;
      P.x = nx * lim; P.y = ny * lim;
      const vout = P.vx * nx + P.vy * ny;
      // Touching the boundary is not the same as hitting it. Every outward nudge used to bounce at 2.4×
      // and beep, so the corridor's own pinch points rang the collision 11–16 times a run with the
      // player doing nothing wrong. Only a real push into the wall counts.
      // A side chain's aim point sits near the corridor edge, so reaching one often touches the boundary
      // at the same instant it is collected. Collecting must never look like crashing: for a moment
      // after a pickup the boundary still stops the craft, but silently.
      // Only call it a collision if the player can see what they hit. Measured over four folds, 78–98 % of
      // wall contacts happened with no drawn surface within 0.5 Å — the corridor is an abstract tube, so
      // the craft was being stopped, shaken and slowed by nothing at all, in open space.
      const seenR = ribbonClear(V.add(node.p, V.add(V.scale(node.r, P.x), V.scale(node.u, P.y))), 0, 0);
      if (WALLS_BITE && vout > A(WALL_BUMP) && P.flashT < 0.75 && P.t > WALL_GRACE && seenR < WALL_SEEN && P.rollT <= 0) {
        P.vx -= 2.4 * vout * nx; P.vy -= 2.4 * vout * ny; beep(180, 0.06, 'triangle', 0.03);
        P.groove = 0;
        P.shake = Math.max(P.shake, 0.12); P.shakeDir = [-nx * node.r[0] - ny * node.u[0], -nx * node.r[1] - ny * node.u[1], -nx * node.r[2] - ny * node.u[2]];
        P.shakeT0 = P.t; P.shakeSign = nx >= 0 ? -1 : 1;
        (status.wall = status.wall || []).push({ kind: 'radial', res: Math.round(node.res), r: +(rr / SC).toFixed(2), lim: +(lim / SC).toFixed(2), t: +P.t.toFixed(1),
          // how far is the craft from anything the player can actually SEE at the moment it is stopped?
          seen: +seenR.toFixed(2) });
      } else if (vout > 0) { P.vx -= vout * nx; P.vy -= vout * ny; }   // a graze, or a pickup: shed the outward drift, silently
    }
    const pos3 = V.add(node.p, V.add(V.scale(node.r, P.x), V.scale(node.u, P.y)));
    gliderPos = pos3;
    // CAMPEN: how deep is the LENS inside a drawn surface, and how far would it have to move toward the
    // rail to get out? That distance is what a correction would cost — compare it with the fit's lurches.
    if (!P.done && window.CAMPEN && P.t > 0.5) {
      const W = status.campen = status.campen || { n: 0, inN: 0, worst: 0, duckSum: 0, duckMax: 0 };
      W.n++;
      if (!ribbonClearAtLeast(cam.pos, 0.05)) {
        W.inN++;
        // how much must the lens offset shrink toward the rail before it is clear?
        const nd = rail.nodeAt(P.s - A(CBs));
        let duck = 0;
        for (let f = 0.95; f >= 0.05; f -= 0.05) {
          const q = V.add(nd.p, V.add(V.scale(nd.r, cam.off[0] * f), V.scale(nd.u, cam.off[1] * f)));
          if (ribbonClearAtLeast(q, 0.35)) { duck = 1 - f; break; }
          duck = 1;
        }
        const oLenA = Math.hypot(cam.off[0], cam.off[1]) / SC;
        W.duckSum += duck * oLenA; W.duckMax = Math.max(W.duckMax, +(duck * oLenA).toFixed(2));
      }
    }
    // WALLCHK: how far is the CRAFT inside the drawn ribbon, every frame, over the whole run. The
    // corridor is an abstract tube; WALL_GIVE opens it outward to the real surface but never closes it
    // in, so wherever the ribbon intrudes into the tube the craft flies straight through it.
    if (!P.done && window.WALLCHK && P.t > 0.5) {
      const pen = ribbonPenetration(pos3, Math.round(rail.nodeAt(P.s).res), +(window.WALLSKIP === undefined ? 4 : window.WALLSKIP)).depth;
      const W = status.wallchk = status.wallchk || { n: 0, inN: 0, deep: 0, worst: 0, worstAt: null, hist: [0,0,0,0,0] };
      W.n++;
      if (pen > 0) {
        W.inN++;
        if (pen > 0.15) W.deep++;
        const bin = Math.min(4, Math.floor(pen / 0.15));
        W.hist[bin]++;
        if (pen > W.worst) { W.worst = +pen.toFixed(3); W.worstAt = { res: Math.round(rail.nodeAt(P.s).res), t: +P.t.toFixed(1),
          x: +(P.x / SC).toFixed(2), y: +(P.y / SC).toFixed(2), lim: +(Math.max(rail.nodeAt(P.s).R - A(WALL_MARGIN), A(CRAFT_R + 0.06)) / SC).toFixed(2) }; }
      }
    }
    if (!P.done && window.CLIPCHK && P.t > 1 && (status.frames % 4 === 0)) {
      const nd0 = rail.nodeAt(P.s);
      const ri0 = Math.round(nd0.res);
      // side chains count too: flying through a tryptophan is far more visible than grazing the backbone
      // split intended contact (an uncollected target you are meant to fly into) from the rest
      const sideDepth = (p, wantJudged, tag) => {
        let worst = 0, who = null;
        for (const b of blocks) {
          if (Math.abs(b.s - P.s) > A(3)) continue;
          const judged = b.judged;
          if (judged !== wantJudged) continue;
          const { pts, shrink } = b.atoms ? posedAtoms(b, blockDir(b), visLen(b)) : { pts: [], shrink: 1 };
          for (const q of pts) { const d = A(ATOM_R * shrink) - V.len(V.sub(p, q)); if (d > worst) { worst = d; who = b; } }
        }
        if (tag && who && worst / SC > (status.sideWorst ? status.sideWorst.d : 0)) {
          status.sideWorst = { d: +(worst / SC).toFixed(2), res: nums[who.i], aa: seq[who.i], type: who.type,
            trench: !!who.trench, f: +who.f.toFixed(2), anim: !!who.anim, ds: +((who.s - P.s) / SC).toFixed(1),
            craftX: +(P.x / SC).toFixed(2), craftY: +(P.y / SC).toFixed(2) };
        }
        return worst / SC;
      };
      status.intendedWorst = Math.max(status.intendedWorst || 0, +sideDepth(pos3, false).toFixed(2));
      const sc = { d: -Math.max(ribbonPenetration(pos3, ri0, nd0.hw > 0.5 ? 6 : 0).depth, sideDepth(pos3, true, 1)) };
      const cc = { d: -Math.max(ribbonPenetration(cam.pos, ri0, nd0.hw > 0.5 ? 6 : 0).depth, sideDepth(cam.pos, true)) };
      const rec = (tag, v) => {
        const key = tag + 'Worst';
        if (status[key] === undefined || v.d < status[key].d) status[key] = { d: +v.d.toFixed(2), ss: nd0.elem, res: Math.round(nd0.res), trench: +(nd0.trench || 0).toFixed(2), x: +(P.x / SC).toFixed(2) };
        if (v.d < 0) status[tag + 'In'] = (status[tag + 'In'] || 0) + 1;
        status[tag + 'N'] = (status[tag + 'N'] || 0) + 1;
      };
      rec('craft', sc); rec('cam', cc);
      {
        const cl = ribbonClear(cam.pos, 0, 0);
        if (status.camClear === undefined || cl < status.camClear) {
          status.camClear = +cl.toFixed(2);
          status.camClearAt = { res: Math.round(nd0.res), ss: nd0.elem };
        }
        status.camTight = (status.camTight || 0) + (cl < 0.5 ? 1 : 0);
        if (window.CAMTRACE) {
          // is the CRAFT's own position any better than the lens's? If not, no camera placement can help
          (status.camTrace = status.camTrace || []).push([Math.round(nd0.res), +cl.toFixed(2),
            +ribbonClear(pos3, 0, 0).toFixed(2), +ribbonClear(rail.nodeAt(P.s).p, 0, 0).toFixed(2)]);
        }
      }
      // Does ribbon geometry sit between the camera and the craft? A screen filled with one helix wall is
      // just as unplayable as the camera being inside it, and the depth test alone never reports it.
      {
        let occ = 0, deep = 0;
        for (let k = 0; k <= 10; k++) {
          const f = k / 10, q = V.add(cam.pos, V.scale(V.sub(pos3, cam.pos), f));
          const d = ribbonPenetration(q, ri0, 2).depth;
          if (d > 0) { occ++; if (d > deep) deep = d; }
        }
        status.occN = (status.occN || 0) + 1;
        if (occ > 0) {
          status.occIn = (status.occIn || 0) + 1;
          if (!status.occWorst || occ > status.occWorst.n)
            status.occWorst = { n: occ, deep: +deep.toFixed(2), res: Math.round(nd0.res), ss: nd0.elem };
        }
      }
    }
    if (!P.done && window.CLEARCHK && P.t > 1) { // dev: closest approach to any Cα once under way
      let m = 1e9;
      for (let k = 0; k < ca.length / 3; k++) {
        const d = V.len(V.sub(pos3, [ca[3 * k] * SC, ca[3 * k + 1] * SC, ca[3 * k + 2] * SC])) / SC;
        if (d < m) m = d;
      }
      if (status.minClear === undefined || m < status.minClear) {
        status.minClear = +m.toFixed(2);
        const nd0 = rail.nodeAt(P.s);
        status.minAt = { res: Math.round(nd0.res), ss: nd0.elem, trench: +(nd0.trench || 0).toFixed(2),
          x: +(P.x / SC).toFixed(2), y: +(P.y / SC).toFixed(2), R: +(nd0.R / SC).toFixed(2) };
      }
    }

    // element change resets the helix note ladder
    if (node.elem !== P.lastElem) { P.lastElem = node.elem; P.helixNote = 0; if (node.elem === 'E' && trench > 0.5 && !P.trenchHinted) { P.trenchHinted = true; flash = { text: 'β-sheet · trench run: weave left and right to collect them all', t: 2.5 }; } }
    sound.advance(dt, P.groove);
    if (!P.done) { P.tAll = (P.tAll || 0) + dt; if ((node.trench || 0) > 0.5) P.tTrench = (P.tTrench || 0) + dt; }
    status.trenchFrac = P.tAll ? +(P.tTrench / P.tAll).toFixed(2) : 0;

    // Side-chain obstacles: contact is a collision; passing cleanly scores.
    animating = false;
    for (const b of blocks) {
      const ds = b.s - P.s;
      if (ds < -A(4) || ds > A(4)) continue;
      const [a, e] = blockSeg(b);
      if (b.type === 'H') {
        if (!b.judged && Math.abs(ds) < A(1.5)) {
          const d = segDist(pos3, a, e);                   // distance to the stem line (for 'perfect')
          const dt2 = touchDist(pos3, b);                  // distance to the nearest atom surface
          b.minD = Math.min(b.minD, d);
          const catchR = b.trench ? TRENCH_CATCH : CRAFT_R;
          if ((dt2 < A(catchR) || d < A(COLLECT_R)) && !P.done) {
            b.judged = true; b.collided = true; b.anim = true; ghostDirty = true;
            if (window.AIMLOG) (status.aimLog = status.aimLog || []).push({ res: nums[b.i],
              aim: b.aim ? [+b.aim.x.toFixed(2), +b.aim.y.toFixed(2)] : null,
              at: [+(P.x / SC).toFixed(2), +(P.y / SC).toFixed(2)], ds: +(ds / SC).toFixed(2),
              d: +(d / SC).toFixed(2), f: +b.f.toFixed(2), sp: +P.speed.toFixed(1) });
            P.missed++; P.combo = 0;
            P.speed = Math.max(BRAKE_SPEED, P.speed * 0.72);
            pop(pos3, `${names[b.i]} ${nums[b.i]} | collision`, 'rgb(255,110,96)');
            burst(V.add(b.ca, V.scale(b.inw, A(1.0))), b.real, resColour(seq[b.i]), 5, 5);
            rings.push({ c: b.ca.slice(), axis: b.tan, age: 0, life: 0.4, col: resColour(seq[b.i]) });
            sound.miss();
            impact(pos3, node, RED, true, b.i);
            (status.misses = status.misses || []).push({ res: nums[b.i], lane: b.lane,
              speed: +P.speed.toFixed(1), x: +(P.x / SC).toFixed(2) });
          }
        }
        if (!b.judged && P.s > b.s + A(1.0)) {
          b.judged = true; P.fixed++; P.combo++; P.bestCombo = Math.max(P.bestCombo, P.combo); ghostDirty = true;
          const mult = 1 + Math.floor(P.combo / 5), pts = FLIP_SCORE * mult;
          P.score += pts;
          pop(pos3, `clean +${pts}${mult > 1 ? ' x' + mult : ''}`, 'rgb(127,212,193)');
          sound.hit(P.combo % 5 === 0); P.helixNote++;
          const mates = blocks.filter((o) => o.type === 'H' && o.seg === b.seg);
          if (mates.every((o) => o.judged && !o.collided)) {
            P.helices++; P.score += HELIX_BONUS;
            pop(pos3, `${b.trench ? 'sheet' : 'helix'} cleared +${HELIX_BONUS}`, 'rgb(255,179,71)');
          }
        }
        if (b.anim && b.f < 1) {
          // One uniform rate through grab and swing. Rushing the grab 3.5× was tried, to cut a measured
          // 0.1 Å overlap between the hull and an already-collected side chain, and it spoils the
          // animation: the knock reads as a twitch instead of a hit. The overlap is not worth it.
          b.f = Math.min(1, b.f + dt / FLIP_T); animating = true;
          if (b.f > GRAB && b.f < 0.75 && Math.random() < 0.25) { // a few trailing sparks, not one per frame
            const tip = V.add(b.ca, V.scale(blockDir(b), A(blockLen(b))));
            sparks.push({ p: tip, v: V.scale(V.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), A(1.5)), age: 0, life: 0.22, col: blockColour(b), size: A(0.035) });
          }
        }
      }
    }
    updateChunks(); // rebuild moving poses; update only colours for nearby pulses
    if (ghostDirty) rebuildGhostMesh();

    // finish
    if (!P.done && P.s >= rail.length - 1e-6) {
      P.done = true; doneAt = performance.now();
      const bonus = Math.max(0, Math.round((rail.length / A(BASE_SPEED) - P.t) * 25));
      P.score += bonus;
      P.rank = rankFor();
      saveBest();
      flash = { text: '', t: 0 };
      sound.finish();
    }
    // ---- cofactors: claimed by passing close to the gate, which sits out at the corridor edge on the
    // side the cofactor is on. Judged once, on the way past, like a side chain.
    for (const c of cofs) {
      const ds = c.s - P.s;
      // Every encounter gets a two-note invitation, including repeated kinds on another fold.
      // Pips now appear with it. Neither the camera nor the gate's position/timing is changed.
      if (!c.announced && !c.judged && !P.done && ds > 0 && ds < A(COF_WIN * 6)) {
        c.announced = true;
        landmarkFocus = { c, phase: 'approach', start: P.t, points: 0 };
        sound.landmark(c.n, false);
      }
      if (!c.judged && (ds < -A(2.5) || P.done)) c.judged = true;
      if (c.judged || Math.abs(ds) > A(2.5)) continue;
      const gp = cofGate(c);
      const d = V.len(V.sub(pos3, gp));
      if (d < c.minD) c.minD = d;
      if (d < A(COF_R) && !P.done) {
        c.judged = true; c.locked = true;
        const mult = 1 + Math.floor(P.combo / 5), pts = COF_SCORE * mult;
        P.score += pts; P.cofs++;
        landmarkFocus = { c, phase: 'collected', start: P.t, points: pts };
        burst(c.cen, V.norm(V.sub(c.cen, gp)), COF_COL[c.n] || [0.9, 0.6, 0.4], 10, 9);
        rings.push({ c: gp, axis: rail.nodeAt(c.s).t, age: 0, life: 0.6, col: COF_COL[c.n] || [0.9, 0.6, 0.4] });
        P.fovKick = Math.max(P.fovKick, 3);
        sound.landmark(c.n, true);
        const col = COF_COL[c.n] || [0.9, 0.6, 0.4];
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        for (const r of c.resonance) glows.push({ i: r.i, age: still ? 0 : -r.d * 0.045,
          life: 1.25, strength: 0.32, col });
      }
    }
    if (landmarkFocus && ((landmarkFocus.phase === 'approach' && landmarkFocus.c.judged) ||
      (landmarkFocus.phase === 'collected' && P.t-landmarkFocus.start > 2.2) || P.done)) landmarkFocus = null;

    // camera: banked, shaken, wider on boost
    // camera rides the rail exactly 3.2 Å behind (no lag along the chain); only the lateral offset is smoothed
    const trenchNow = clamp(((rail.nodeAt(P.s).trench || 0) - 0.3) / 0.4, 0, 1);
    // hold the sheet horizon through the gap between two sheets, so a turn does not snap the world upright
    P.trenchHold = Math.max(trenchNow, (P.trenchHold || 0) - dt * 0.7);
    const trenchC = P.trenchHold;
    // In a hairpin the point 3.2 Å back along the rail is around the corner, which is how the camera loses
    // the craft. Shorten the trail as the path bends so the camera stays on the craft's own side of the turn.
    // A portrait phone has a much narrower horizontal field than the landscape window this was tuned on,
    // so the same trail distance makes the craft fill the screen. Pull back in proportion.
    const aspect = clamp((window.innerWidth || 1280) / Math.max(1, window.innerHeight || 800), 0.4, 2);
    const portraitPull = aspect < 1 ? 1 + (1 - aspect) * 0.85 : 1;
    const CB = window.DEBUG_CAM ? window.DEBUG_CAM.back : (3.2 - 1.0 * clamp((P.bendAhead - 25) / 55, 0, 1)) * portraitPull, CU = window.DEBUG_CAM ? window.DEBUG_CAM.up : 0.7 - 0.15 * trenchC; // behind and above the craft, low over a sheet
    // CB shortens by up to 1 Å as the path bends, so a bend arriving quickly slides the seat a full
    // angstrom along the rail. With the fit off this is the largest remaining source of lens lurch:
    // pinning it outright takes the >0.45 Å steps from 78 to 12. Slew it instead of jumping.
    P.camBackS = P.camBackS === undefined ? CB : P.camBackS + clamp(CB - P.camBackS, -CB_SLEW * dt, CB_SLEW * dt);
    const CBs = P.camBackS;
    const k6 = Math.min(1, 6 * dt);
    cam.off = [cam.off[0] + (CAM_FOLLOW * P.x - cam.off[0]) * k6, cam.off[1] + (CAM_FOLLOW * P.y + A(CU) - cam.off[1]) * k6];
    // A helix ribbon is only 0.4 Å thick, so a lens 0.1 Å off its face is outside the geometry and still
    // fills the whole screen. Moving the camera to dodge that was tried and is worse: every seat at a
    // hairpin is as tight as the last, and ducking either buries the lens in the ship or whips the view.
    // The renderer fades the ribbon out as it comes onto the lens instead, which costs the shot nothing.
    nearFadeNow = trenchC > 0.25 ? NEAR_FADE_T : NEAR_FADE;
    nearSolidNow = trenchC > 0.25 ? NEAR_SOLID_T : NEAR_SOLID;
    const cn = rail.nodeAt(P.s - A(CBs));
    const seatAt = (ox, oy, back) => {
      const q = back === undefined ? cn : rail.nodeAt(P.s - A(back));
      return V.add(q.p, V.add(V.scale(q.r, ox), V.scale(q.u, oy)));
    };
    // Fit the lens's cross-section offset to the real surface. Measured over 1LDG and 1M56, on the frames
    // where the lens is inside the ribbon the CRAFT beside it has 1.1–1.3 Å of daylight on average — so
    // the trail length is not the problem (sliding along it was tried and buys nothing) and neither is the
    // corridor radius (it is a gameplay number, not a clearance). What is wrong is where in the
    // cross-section the lens sits: 0.7 Å above the rail, unconditionally, whatever is there. Swing that
    // offset around the tangent to a direction with room, and shorten it if no direction has any.
    const oLen = Math.hypot(cam.off[0], cam.off[1]);
    let wantRot = 0, wantSc = 1, wantBack = CBs;
    if (CAM_FIT && !window.NOFIT && oLen > 1e-6 && !ribbonClearAtLeast(seatAt(cam.off[0], cam.off[1]), CAM_CLEAR)) {
      wantSc = 0.25; wantRot = 0;
      let fbD = -1;
      // Rotation alone runs out of directions in an enclosed pocket, and sliding along the rail alone
      // buys nothing (measured). Together they find room the one-dimensional searches cannot.
      search:
      for (const sc of [1, 0.75, 0.5, 0.25]) {
        for (const deg of FIT_ANGLES) {
          const th = deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
          const ox = (cam.off[0] * c - cam.off[1] * sn) * sc, oy = (cam.off[0] * sn + cam.off[1] * c) * sc;
          for (const bk of FIT_BACKS) {
            const back = Math.max(0.8, CB - bk);
            if (ribbonClearAtLeast(seatAt(ox, oy, back), CAM_CLEAR)) { wantRot = deg; wantSc = sc; wantBack = back; break search; }
            // nothing may clear at all in an enclosed pocket; remember the roomiest seat seen
            if (sc > 0.5) {
              const dd = ribbonClear(seatAt(ox, oy, back), 0, 0);
              if (dd > fbD + 0.02) { fbD = dd; wantRot = deg; wantSc = sc; wantBack = back; }
            }
          }
        }
      }
    }
    P.camRot = P.camRot === undefined ? 0 : P.camRot + clamp(wantRot - P.camRot, -FIT_SLEW * dt, FIT_SLEW * dt);
    P.camSc = P.camSc === undefined ? 1 : P.camSc + clamp(wantSc - P.camSc, -3 * dt, 1.2 * dt);
    P.camBk = P.camBk === undefined ? CBs : P.camBk + clamp(wantBack - P.camBk, -14 * dt, 4 * dt);
    let th0 = P.camRot * Math.PI / 180, c0 = Math.cos(th0), s0 = Math.sin(th0);
    const fitSeat = (th, sc, bk) => {
      const cc = Math.cos(th), ss2 = Math.sin(th);
      return seatAt((cam.off[0] * cc - cam.off[1] * ss2) * sc, (cam.off[0] * ss2 + cam.off[1] * cc) * sc, bk);
    };
    cam.pos = fitSeat(th0, P.camSc, P.camBk);
    // The smoothed seat can sit in geometry even when both the seat it came from and the seat it is
    // going to are clear: the path between two clear seats need not be clear. When that happens, take
    // the searched seat outright for this frame. The fit never steers the view, so it costs a slide.
    if (CAM_FIT && !window.NOFIT && !ribbonClearAtLeast(cam.pos, CAM_CLEAR)) {
      // Catch up fast rather than jumping: a full snap moves the lens up to 1.7 Å in one frame, which at
      // this viewing distance throws the craft twenty degrees across the screen.
      // Limiting the hurry in PARAMETER space is not enough: 70° of swing costs little rotation but moves
      // the seat by twice the offset length. Measured on the bundle the fit snapped -1°→-71°→-146° on two
      // consecutive frames as the lens entered the first helix, sliding the seat 1.2 Å against a normal
      // step of 0.19 — and because only the position was clamped afterwards, the lens then spent ten
      // frames pinned at the limiter chasing state it had already committed to. That plateau is the bump
      // the player feels in the first second. Budget the hurry by how far it actually moves the seat.
      const dR = clamp(wantRot - P.camRot, -FIT_SNAP_ROT, FIT_SNAP_ROT);
      const dS = clamp(wantSc - P.camSc, -0.3, 0.3);
      const dB = clamp(wantBack - P.camBk, -1.2, 1.2);
      const had = ribbonClear(cam.pos, 0, 0);
      const bud = A(FIT_SNAP_STEP);
      for (const f of [1, 0.6, 0.35, 0.2, 0.12]) {
        const rr = P.camRot + dR * f, rs = P.camSc + dS * f, rb = P.camBk + dB * f;
        const snap = fitSeat(rr * Math.PI / 180, rs, rb);
        const move = V.len(V.sub(snap, cam.pos));
        if (move > bud && f > 0.12) continue;
        if (ribbonClear(snap, 0, 0) > had) {
          status.snapN = (status.snapN || 0) + 1;
          status.snapSum = (status.snapSum || 0) + move / SC;
          status.snapMax = Math.max(status.snapMax || 0, +(move / SC).toFixed(2));
          P.camRot = rr; P.camSc = rs; P.camBk = rb; P.__snapped = true;
          th0 = P.camRot * Math.PI / 180; c0 = Math.cos(th0); s0 = Math.sin(th0);
          cam.pos = snap;
        }
        break;
      }
    }
    // ---- B: over a sheet the deck is a floor, and the lens must never get under it. A β-sheet is a
    // wide flat slab, so from below it fills the entire frame with its own back face — that is the green
    // wash, and it reads as flying through a wall rather than over one. C alone does not catch it: the
    // lens can be a clear inch UNDER the deck and never be inside any surface at all.
    if (!window.NODECK) {
      const dn = rail.nodeAt(P.s - A(CBs));
      const tr = dn.trench || 0;
      let lift = 0;
      if (tr > 0.3) {
        const hgt = V.dot(V.sub(cam.pos, dn.p), dn.u) / SC;   // height above the rail, along the deck normal
        const floor = -(TRENCH_H - DECK_MIN);                  // the rail rides TRENCH_H above the deck
        if (hgt < floor) lift = (floor - hgt) * Math.min(1, (tr - 0.3) / 0.3);
      }
      P.deckLift = P.deckLift === undefined ? 0
        : P.deckLift + clamp(lift - P.deckLift, -DECK_SLEW * dt, DECK_SLEW * dt);
      if (P.deckLift > 1e-4) cam.pos = V.add(cam.pos, V.scale(dn.u, A(P.deckLift)));
      status.deck = +(P.deckLift || 0).toFixed(3);
    }
    // ---- C: keep the lens out of drawn surfaces, by exactly how deep it is and no more.
    // The old corridor fit asked ribbonClearAtLeast(pos, 0.9) — "is anything within 0.9 Å" — which is
    // true on 74-92% of frames, and then searched 20 angles x 4 scales x 2 trail lengths for a pose. It
    // fired 235 times a run and jumped between solutions, and those jumps were the bumps. The honest
    // question is whether the lens is actually INSIDE something, which happens on 1-6 frames a fold, and
    // the honest answer is to push it out along the surface normal by the depth it is in. Two orders of
    // magnitude smaller, and continuous.
    if (!window.NODUCK) {
      const esc = ribbonEscape(cam.pos, 0, 0);
      const want = esc.depth > 0 ? esc.depth + DUCK_CLEAR : 0;
      if (want > 0 && esc.dir) P.duckDir = esc.dir;
      P.duck = P.duck === undefined ? 0
        : P.duck + clamp(want - P.duck, -DUCK_SLEW * dt, DUCK_SLEW * dt);
      if (P.duck > 1e-4 && P.duckDir) cam.pos = V.add(cam.pos, V.scale(P.duckDir, A(P.duck)));
      status.duck = +(P.duck || 0).toFixed(3);
    }
    // Aim from the nominal seat. Swinging the lens is a translation the player did not ask for; letting it
    // steer the view as well turns a 1 Å slide into a 300 °/s whip.
    const aimFrom = seatAt(cam.off[0], cam.off[1]);
    // Random camera jitter reads as the WALL shaking, not the ship — the world is what fills the screen.
    // A small directional kick away from the wall, decaying, plus a judder on the craft itself (below)
    // puts the impact where it belongs.
    // Whatever the fit decides, the lens may not lurch. Measured at the start of the bundle it was moving
    // 0.89 Å in a frame against a craft step of 0.19 — the fit swinging 140° in two frames as the camera
    // crossed the rail's start. This is the backstop: a step budget tied to the craft's own.
    if (P.camPrevPos && dt > 0) {
      const step = V.sub(cam.pos, P.camPrevPos), len = V.len(step);
      const budget = A(P.speed * dt + 0.18);
      // BUMPS: the whole run, not the first 2.2 s. The opening-bump hunt logged only t < 2.2 and that
      // window then became the whole picture — on 1M56 it covered 2% of the fold. Here we keep a
      // histogram of every frame's DESIRED lens step (before the budget clamps it), the worst offenders
      // with what else happened on that frame, and how often the clamp was actually doing work.
      if (window.BUMPS) {
        const st = len / SC, want = st;
        const B = status.bumps = status.bumps || { n: 0, clamped: 0, hist: [0,0,0,0,0,0,0,0], worst: [], snapFrames: 0 };
        B.n++;
        const budA = budget / SC;
        if (want > budA) B.clamped++;
        const bin = Math.min(7, Math.floor(want / 0.15));
        B.hist[bin]++;
        if (want > 0.45) {
          B.worst.push({ t: +P.t.toFixed(2), res: Math.round(node.res), want: +want.toFixed(3), bud: +budA.toFixed(3),
            snap: P.__snapped ? 1 : 0, dspeed: +((P.speed - (P.__lastSpeed || P.speed))).toFixed(2),
            fov: +P.fovKick.toFixed(2), trench: +(node.trench || 0).toFixed(2), groove: +P.groove.toFixed(2) });
          if (B.worst.length > 40) B.worst.shift();
        }
        if (P.__snapped) B.snapFrames++;
        P.__lastSpeed = P.speed; P.__snapped = false;
      }
      if (len > budget) cam.pos = V.add(P.camPrevPos, V.scale(step, budget / len));
    }
    P.camPrevPos = cam.pos.slice();
    if (P.shake > 0.01 && P.shakeDir) cam.pos = V.add(cam.pos, V.scale(P.shakeDir, A(0.16) * P.shake * Math.sin((P.t - (P.shakeT0 || 0)) * 22)));
    // Never let the lens dip into the deck: a camera under the sheet fills the screen with one surface and
    // the craft disappears behind it.
    if (cn.sheetN && (cn.trench || 0) > 0.3) {
      const sn = V.norm(cn.sheetN);
      const deckPt = V.sub(cn.p, V.scale(sn, A(TRENCH_H)));
      const h = V.dot(V.sub(cam.pos, deckPt), sn) / SC;
      if (h < 1.0) {
        // Lifting the lens off the deck runs AFTER the corridor fit, so it can undo it and push the lens
        // straight back into a wall — this is why 1LDG stayed buried at residues 137 and 172, both of
        // them just over the trench threshold. Only take the lift if it does not cost clearance.
        const lifted = V.add(cam.pos, V.scale(sn, A(1.0 - h)));
        if (ribbonClearAtLeast(lifted, CAM_CLEAR) || ribbonClear(lifted, 0, 0) >= ribbonClear(cam.pos, 0, 0)) cam.pos = lifted;
      }
    }
    nearOn = !ribbonClearAtLeast(cam.pos, nearFadeNow[1] / SC);
    const lookAhead = window.CAM_OLD ? 7 : 7 + TUNE.lookCoil * (1 - clamp((node.hw - 0.3) / 0.4, 0, 1)); // look further ahead outside helices
    let look = V.sub(rail.nodeAt(P.s + A(lookAhead)).p, V.scale(node.u, A(0.2 + 0.5 * trenchC))); // over a sheet, look down at the floor
    // Never lose the craft. Past 10° off the view axis the look target leans toward it, and past 18° the
    // camera is allowed to break its comfort cap: being disoriented is worse than a fast turn.
    let slewCap = TUNE.slew;
    if (!window.CAM_OLD) {
      const toCraft = V.norm(V.sub(pos3, aimFrom));
      const off = Math.acos(clamp(V.dot(cam.fwd, toCraft), -1, 1)) * 180 / Math.PI;
      const w = clamp((off - 10) / 12, 0, 1);
      if (w > 0) look = V.lerp(look, V.add(pos3, V.scale(node.t, A(3))), w);
      slewCap = TUNE.slew * (1 + 0.7 * clamp((off - 16) / 20, 0, 1));
    }
    const roll = clamp(-P.vx / SC * 0.035, -0.3, 0.3);
    const upT = V.norm(V.add(V.scale(node.u, Math.cos(roll)), V.scale(node.r, Math.sin(roll))));
    const prevFwd = cam.fwd;
    let nf = V.norm(V.lerp(cam.fwd, V.norm(V.sub(look, aimFrom)), Math.min(1, (window.CAM_OLD ? 5 : TUNE.fwdRate) * dt)));
    if (!window.CAM_OLD && dt > 0) { // slew-rate limit: never turn the view faster than TUNE.slew °/s
      const ang = Math.acos(clamp(V.dot(prevFwd, nf), -1, 1)), maxAng = slewCap * Math.PI / 180 * dt;
      if (ang > maxAng && ang > 1e-6) { const axis = V.norm(V.cross(prevFwd, nf)); nf = V.norm(rotAbout(prevFwd, axis, maxAng)); }
    }
    // Last resort: the craft may never leave a 25° cone about the view axis. Everything above is a soft
    // bias that a sharp enough turn can out-run; this cannot be out-run, at the cost of a fast swing.
    {
      // Aim the clamp at where the craft WILL be, not where it is. Waiting until it actually reaches the
      // cone edge leaves only one frame to fix it, and the swing that takes is the single biggest jolt in
      // the game: 339 °/s on 1LDG, well above anything the path itself does.
      const q = rail.nodeAt(P.s + A(P.speed * CONE_LEAD));
      const ahead = V.add(q.p, V.add(V.scale(q.r, P.x), V.scale(q.u, P.y)));
      const toCraft = V.norm(V.sub(ahead, aimFrom));   // from the nominal seat: fitting the lens must never steer the view
      const off = Math.acos(clamp(V.dot(nf, toCraft), -1, 1)), cone = 25 * Math.PI / 180;
      if (off > cone) {
        const axis = V.cross(nf, toCraft);
        const step = Math.min(off - cone, CONE_RATE * Math.PI / 180 * dt); // firm, but still not a snap
        if (V.len(axis) > 1e-6) nf = V.norm(rotAbout(nf, V.norm(axis), step));
      }
    }
    // Is the craft outside the frame? The frustum is a rectangle, so an angle off the axis is only an
    // upper bound — 30° straight up is still on screen, 30° sideways is not. cam.up is lerped toward its
    // goal and is not exactly perpendicular to the view axis, and lookAt orthogonalises it internally, so
    // this has to as well or the vertical test is simply wrong.
    {
      const rel = V.sub(pos3, cam.pos), rgt2 = V.norm(V.cross(nf, cam.up)), up2 = V.norm(V.cross(rgt2, nf));
      const fz = V.dot(rel, nf), fx = V.dot(rel, rgt2), fy = V.dot(rel, up2);
      const asp = (window.innerWidth || 1280) / Math.max(1, window.innerHeight || 800);
      const tv = Math.tan((cam.fovDraw || cam.fov) * Math.PI / 360), th = tv * asp;
      const out = !P.done && (fz <= 0.01 || Math.abs(fx) > th * fz || Math.abs(fy) > tv * fz);
      if (out) { const L = Math.hypot(fx, fy) || 1; P.lostDir = [fx / L, -fy / L]; }
      P.lostGlow = clamp((P.lostGlow || 0) + (out ? 8 * dt : -4 * dt), 0, 1);
      if (dt > 0 && P.speed > 5 && !P.done) {
        status.frameN = (status.frameN || 0) + 1;
        if (out) {
          status.offScreenN = (status.offScreenN || 0) + 1;
          // does it happen while a side chain is actually in play? Off-screen on an empty stretch costs
          // the player nothing; off-screen while lining up a collection costs them the collection.
          let live = false;
          for (const b of blocks) { if (b.type === 'H' && !b.judged && b.s - P.s > -A(1.5) && b.s - P.s < A(5)) { live = true; break; } }
          if (live) status.offScreenLive = (status.offScreenLive || 0) + 1;
        }
      }
    }
    const cameraStats = HEADLESS || window.CAMERA_DIAGNOSTICS;
    if (cameraStats && dt > 0 && P.speed > 5 && !P.done) {   // how far off the view axis the craft actually ends up
      const o = Math.acos(clamp(V.dot(nf, V.norm(V.sub(pos3, cam.pos))), -1, 1)) * 180 / Math.PI;
      (status.camOff = status.camOff || []).push(Math.round(o));
      if (o > 40) (status.offTrace = status.offTrace || []).push([+P.t.toFixed(2), Math.round(o), Math.round(rail.nodeAt(P.s).res), +(P.x / SC).toFixed(2), +P.speed.toFixed(1), +(P.bendAhead||0).toFixed(0)]);
      if (o > (status.offWorst ? status.offWorst.o : 0))
        status.offWorst = { o: Math.round(o), res: Math.round(rail.nodeAt(P.s).res), ss: rail.nodeAt(P.s).elem,
          trench: +((rail.nodeAt(P.s).trench || 0)).toFixed(2), speed: +P.speed.toFixed(1),
          x: +(P.x / SC).toFixed(2), y: +(P.y / SC).toFixed(2), t: +P.t.toFixed(1) };
    }
    cam.fwd = nf;
    if (window.HUNT && P.t < 6) { if (P.t < 1.6) status.earlyMaxX = Math.max(status.earlyMaxX || 0, Math.abs(P.x / SC));

      const dv = P.speed - (P.spPrev === undefined ? P.speed : P.spPrev); P.spPrev = P.speed;
      const jp = P.camPrev2 ? V.len(V.sub(cam.pos, P.camPrev2)) / SC : 0; P.camPrev2 = cam.pos.slice();
      if (P.shake > 0.005 || dv < -0.4 || P.fovKick > 0.5 || jp > 0.3)
        (status.hunt = status.hunt || []).push([+P.t.toFixed(2), +P.speed.toFixed(1), +dv.toFixed(2),
          +P.shake.toFixed(3), +P.fovKick.toFixed(2), +jp.toFixed(3), +(P.x/SC).toFixed(2), +(P.y/SC).toFixed(2), P.fixed]);
    }
    if (window.HANDOVER) {
      const jp = P.hoPrev ? V.len(V.sub(cam.pos, P.hoPrev)) / SC : 0; P.hoPrev = cam.pos.slice();
      if (P.t < 2.5) (status.ho = status.ho || []).push([+P.t.toFixed(2), +(P.preview||0).toFixed(2), +jp.toFixed(2)]);
    }
    if (window.BUMPLOG) {
      const jp = P.camPrev ? V.len(V.sub(cam.pos, P.camPrev)) / SC : 0;
      (status.bumpLog = status.bumpLog || []).push([+P.t.toFixed(3), +(P.s / SC).toFixed(2), +jp.toFixed(3),
        +(P.speed).toFixed(1), +(P.shake || 0).toFixed(2), +(P.fovKick || 0).toFixed(2),
        +(P.camBk === undefined ? 0 : P.camBk).toFixed(2), +(P.camRot === undefined ? 0 : P.camRot).toFixed(0),
        +(P.camSc === undefined ? 1 : P.camSc).toFixed(2)]);
      P.camPrev = cam.pos.slice();
    }
    let camTurnNow = 0;
    if (dt > 0) { camTurnNow = Math.acos(clamp(V.dot(prevFwd, cam.fwd), -1, 1)) * 180 / Math.PI / dt; if (cameraStats && P.speed > 5 && !P.done) (status.camTurn = status.camTurn || []).push(Math.round(camTurnNow)); }
    if (cameraStats && dt > 0 && P.speed > 5 && !P.done) {  // how fast the rail itself turns, for comparison with the lens
      const t0 = rail.nodeAt(P.s).t, t1 = rail.nodeAt(P.s + A(P.speed * dt)).t;
      (status.railTurn = status.railTurn || []).push(Math.round(Math.acos(clamp(V.dot(t0, t1), -1, 1)) * 180 / Math.PI / dt));
    }
    P.camTurn = P.camTurn === undefined ? camTurnNow : P.camTurn + (camTurnNow - P.camTurn) * Math.min(1, 6 * dt);
    // camera up: lean on world up (no roll) except where the rail runs near vertical; controls keep the rail frame
    let upGoal = upT;
    if (!window.CAM_OLD) {
      const wu = V.perp([0, 1, 0], cam.fwd), vert = Math.abs(cam.fwd[1]);
      if (V.len(wu) > 0.15) upGoal = V.norm(V.lerp(upT, V.norm(wu), TUNE.upWorld * (1 - vert * vert) * (1 - trenchC))); // over a sheet the sheet is the floor
    }
    const prevUp = cam.up;
    cam.up = V.norm(V.lerp(cam.up, upGoal, Math.min(1, 2.5 * dt)));
    // The view direction has had a slew cap since early on; the horizon never had one, and roll is the
    // worse of the two for comfort. 1BCF rolled at 131 °/s at the 95th percentile with the craft flying
    // straight. The cause is the up vector's basis: outside a trench it blends 70 % toward world up, and
    // that blend collapses as the flight direction approaches vertical, snapping the horizon to the rail
    // frame. Cap the rate instead of chasing the blend.
    if (dt > 0) {
      const rgtN = V.norm(V.cross(cam.fwd, cam.up)), upN = V.norm(V.cross(rgtN, cam.fwd));
      const pu = V.norm(V.perp(prevUp, cam.fwd));
      const ang = Math.atan2(V.dot(pu, rgtN), V.dot(pu, upN));
      const maxA = ROLL_MAX * Math.PI / 180 * dt;
      if (Math.abs(ang) > maxA) cam.up = V.norm(V.perp(rotAbout(pu, cam.fwd, -Math.sign(ang) * maxA), cam.fwd));
    }
    // Roll — the horizon rotating about the view axis — is the most nausea-inducing camera motion there
    // is, and nothing here had ever measured it. Take the previous up vector into the NEW frame so a
    // change of view direction does not read as roll.
    if (cameraStats && dt > 0 && P.speed > 5 && !P.done) {
      const rgtN = V.norm(V.cross(cam.fwd, cam.up)), upN = V.norm(V.cross(rgtN, cam.fwd));
      const pu = V.norm(V.perp(prevUp, cam.fwd));
      const ang = Math.atan2(V.dot(pu, rgtN), V.dot(pu, upN)) * 180 / Math.PI;
      (status.camRoll = status.camRoll || []).push(Math.round(Math.abs(ang) / dt));
    }
    cam.fov += (76 + 12 * clamp((P.speed - BASE_SPEED) / (RAMP_SPEED + BOOST_ADD), 0, 1) - cam.fov) * Math.min(1, 3 * dt);
    cam.fovDraw = cam.fov + P.fovKick;

    // the craft: banked by lateral speed, pitched by vertical speed
    if (renderer) {
      // A knock, not a buzz. This used to be sin(absolute time) at 10 Hz, so the phase at the moment of
      // contact was arbitrary: the hull snapped straight to a 3.5° tilt in one frame and then vibrated.
      // Phase from the impact instead, so the first motion starts at zero and tips AWAY from the wall it
      // touched, at 4 Hz, damping with the shake.
      const jAge = P.t - (P.shakeT0 || 0);
      const jud = P.shake > 0.01 ? P.shake * 0.30 * (P.shakeSign || 1) : 0;
      if (window.OPENLOG && P.t < 2.2) {
        const st2 = P.openPrev ? V.len(V.sub(cam.pos, P.openPrev)) / SC : 0; P.openPrev = cam.pos.slice();
        (status.openLog = status.openLog || []).push([+P.t.toFixed(3), +(P.speed).toFixed(2),
          +(P.x / SC).toFixed(3), +(P.y / SC).toFixed(3), +st2.toFixed(3), +P.shake.toFixed(3),
          +(-P.vx / SC * 0.09).toFixed(3), +(P.vy / SC * 0.05).toFixed(3)]);
      }
      const jBank = jud * Math.sin(jAge * 25);
      if (window.JUDLOG && P.shake > 0.005) (status.judLog = status.judLog || []).push([+P.t.toFixed(3), +P.shake.toFixed(3), +jBank.toFixed(4)]);
      // The roll is added OUTSIDE the bank clamp: it is a full revolution, not a lean, and clamping it
      // would stall the hull half way round.
      let rollA = 0;
      if (P.rollT > 0) { const k = 1 - P.rollT / ROLL_T; rollA = P.rollDir * 2 * Math.PI * (k * k * (3 - 2 * k)); }
      const bank = clamp(-P.vx / SC * 0.09 + jBank, -0.9, 0.9) + rollA;
      const pitch = clamp(P.vy / SC * 0.05 + jud * 0.35 * Math.sin(jAge * 34), -0.45, 0.45);
      const cb = Math.cos(bank), sb = Math.sin(bank);
      let r = V.add(V.scale(node.r, cb), V.scale(node.u, sb));
      let u = V.sub(V.scale(node.u, cb), V.scale(node.r, sb));
      let t = node.t;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const t2 = V.add(V.scale(t, cp), V.scale(u, sp)); u = V.sub(V.scale(u, cp), V.scale(t, sp)); t = t2;
      const boosting = P.boostGlow > 0.5;
      const accent = P.flashT > 0.05 ? [255, 235, 160] : boosting ? [127, 212, 193] : [255, 179, 71];
      engineCol = P.flashT > 0.05 ? [250, 226, 177] : boosting ? [153, 227, 230] : [168, 210, 223];
      const origin = V.sub(V.sub(pos3, V.scale(u, 1.6 * CRAFT_SC)), V.scale(t, 5 * CRAFT_SC));
      buildCraft(origin, t, u, r, accent);
      // the ghost of your best run on this fold, at the same clock time
      ghostPose = null;
      if (!P.done && P.preview <= 0) {
        const gq = ghostAt(P.t);
        if (gq) {
          const gn = rail.nodeAt(gq.s);
          const gp = V.add(gn.p, V.add(V.scale(gn.r, gq.x), V.scale(gn.u, gq.y)));
          const go = V.sub(V.sub(gp, V.scale(gn.u, 1.6 * CRAFT_SC)), V.scale(gn.t, 5 * CRAFT_SC));
          buildGhostCraft(go, gn.t, gn.u, gn.r, [127, 212, 193]);
          ghostPose = gq;
          // A translucent craft flying next to you means nothing until someone says what it is.
          teach('ghost', 'that is your best run on this fold · beat it', 3.0);
        }
      }
      // exhaust from the two nacelles
      if (!P.done && P.speed > 3) {
        const thr = clamp((P.speed - 8) / 20, 0.15, 1) + (boosting ? 0.6 : 0);
        const exc = boosting ? [0.45, 0.9, 1.0] : [1.0, 0.55, 0.2];
        for (const sgn of [-1, 1]) {
          const nozzle = V.add(V.add(V.add(origin, V.scale(u, 1.5 * CRAFT_SC)), V.scale(t, -12.6 * CRAFT_SC)), V.scale(r, sgn * 8.5 * CRAFT_SC));
          const n = Math.random() < thr * 1.6 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const jit = V.add(V.scale(r, (Math.random() - 0.5) * A(0.03)), V.scale(u, (Math.random() - 0.5) * A(0.03)));
            sparks.push({ p: V.add(nozzle, jit), v: V.add(V.scale(t, -A(2 + 3 * thr)), V.scale(jit, 8)), age: 0, life: 0.07 + 0.05 * thr, col: exc, size: A(0.025 + 0.02 * thr), streak: true });
          }
        }
      }
    }
    buildFx(dt);

    status.cof = cofs.map((c) => ({ n: c.n, s: +(c.s / SC).toFixed(1), off: +c.off.toFixed(2), lim: +c.lim.toFixed(2),
      near: c.near, locked: !!c.locked, announced: !!c.announced, judged: !!c.judged,
      minD: c.minD > 1e8 ? null : +(c.minD / SC).toFixed(2) }));
    status.landmark = landmarkFocus ? { name: landmarkFocus.c.name, phase: landmarkFocus.phase,
      age: +(P.t-landmarkFocus.start).toFixed(2), residues: landmarkFocus.c.resonance.length } : null;
    status.cofs = P.cofs;
    status.roll = +P.rollT.toFixed(2); status.rolls = P.rolls;
    // Whether boost is ENGAGED, not merely whether the craft happened to speed up. A corner arriving
    // mid-window cuts the speed back down, and a test that infers the control from the speed then reads
    // as "boost does nothing" when the control plainly worked.
    status.boost = !!(keys.boost || touch.boost);
    status.ghost = ghostPose ? +((P.s - ghostPose.s) / SC).toFixed(1) : null;
    status.groove = +P.groove.toFixed(2); status.grooveBest = +P.grooveBest.toFixed(2); status.kick = +P.kick.toFixed(2);
    {
      const rx = P.x / SC, ry = P.y / SC, rr = Math.hypot(rx, ry);
      if (rr > (P.peakR || 0)) { P.peakR = rr; P.peakX = rx; P.peakY = ry; }
      // Also as a FRACTION of the corridor here. The corridor narrows and widens along the rail, so a
      // drag measured in Å depends on where the craft happened to be when it was made — and the
      // slipstream, by carrying it further during a slow drag, can land it somewhere tighter. The
      // fraction is what actually says whether the control responded.
      const limP = Math.max(rail.nodeAt(P.s).R - A(WALL_MARGIN), A(CRAFT_R + 0.06)) / SC;
      P.peakF = Math.max(P.peakF || 0, limP > 0 ? rr / limP : 0);
      status.peakX = +(P.peakX || 0).toFixed(2); status.peakY = +(P.peakY || 0).toFixed(2);
      status.peakF = +(P.peakF || 0).toFixed(2);
    }
    Object.assign(status, { t: P.t, s: P.s / SC, fixed: P.fixed, score: P.score, done: P.done, lim: +(Math.max(node.R - A(WALL_MARGIN), A(CRAFT_R + 0.06)) / SC).toFixed(2),
      res: Math.round(node.res), elem: node.elem, autopilot, bend: +(P.bendAhead || 0).toFixed(0), speed: P.speed, combo: P.bestCombo, rank: P.rank, missed: P.missed, perfect: P.perfect, trench: +((node.trench || 0)).toFixed(2), runFolds: P.runFolds, lane: laneMode ? (lunge.active ? +(lunge.ang * 180 / Math.PI).toFixed(0) : 'centre') : null, x: +(P.x / SC).toFixed(2), y: +(P.y / SC).toFixed(2) });
  }

  // ---------------------------------------------------------------- credits
  function prettyJournal(j) { return (j || '').replace(/\./g, '. ').replace(/\s+/g, ' ').trim().split(' ').map((w) => w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w).join(' '); }
  function authorLine(m, max) {
    if (!m || !m.authors || !m.authors.length) return '';
    const a = m.authors; max = max || 3;
    const names = a.slice(0, max).join(', ') + (a.length > max ? ' et al.' : '');
    return names + (m.year ? ` (${m.year})` : '');
  }
  function isPdb(f) { return f && f.meta && /^[0-9][A-Za-z0-9]{3}/.test(f.id); }
  function pdbCode(f) { return f.id.replace(/x$/, '').toUpperCase(); }

  // ---------------------------------------------------------------- draw
  let projM = null, viewM = null, gliderPos = [0, 0, 0];
  function project(p, W, H) {
    if (!projM) return null;
    const v = viewM, x = p[0], y = p[1], z = p[2];
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    const pr = projM;
    const cx = pr[0] * vx, cy = pr[5] * vy, cw = -vz;
    if (cw <= 0.01) return null;
    return [(cx / cw * 0.5 + 0.5) * W, (1 - (cy / cw * 0.5 + 0.5)) * H];
  }

  // These soft gradients have no fine detail. Rasterize once into small textures,
  // then vary opacity, avoiding per-pixel gradient evaluation on a Retina-sized
  // overlay every frame. Their radii remain in CSS pixels.
  const edgeTints = { width: 0, height: 0, images: [] };
  const hudLabelCache = { title: null, width: 0, font: '', label: '' };
  function drawEdgeTint(W, H, kind, alpha) {
    if (edgeTints.width !== W || edgeTints.height !== H) {
      edgeTints.width = W; edgeTints.height = H;
      edgeTints.images = [[0.32, 0.78, '5,8,18'], [0.45, 0.9, '120,190,255']].map(([r0, r1, rgb]) => {
        const c = document.createElement('canvas'), scale = Math.min(1, 512 / Math.max(W, H));
        c.width = Math.max(1, Math.round(W * scale)); c.height = Math.max(1, Math.round(H * scale));
        const ctx = c.getContext('2d'); ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
        const g = ctx.createRadialGradient(W / 2, H / 2, H * r0, W / 2, H / 2, H * r1);
        g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(1, `rgba(${rgb},1)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return c;
      });
    }
    hud.save(); hud.globalAlpha = alpha;
    hud.drawImage(edgeTints.images[kind], 0, 0, W, H); hud.restore();
  }

  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    // Bound fragment work on big / Retina monitors. DOM controls retain native resolution.
    // At most a 1080p scene, independent of display size; phones keep their existing resolution.
    const sceneDpr = Math.min(dpr, Math.sqrt(1920 * 1080 / Math.max(1, W * H)));
    const w = Math.max(1, Math.floor(W * sceneDpr)), h = Math.max(1, Math.floor(H * sceneDpr));
    const intro = document.getElementById('intro');
    const showIntro = intro && !intro.hidden;
    if (renderer && rail) {
      let eye = cam.pos, forward = cam.fwd, up = cam.up, shiftX = 0, shiftY = 0;
      if (showIntro) {
        // The idle sculpture has its own composition. Never feed this pose into the flight camera.
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const pv = previewPose(0.14 + (still ? 0 : 0.04 * Math.sin(performance.now() / 9000)));
        eye = V.add(previewC, V.scale(V.sub(pv.pos, previewC), W < 640 ? 1.20 : 1.65));
        forward = V.norm(V.sub(previewC, eye)); up = pv.up;
        shiftX = W < 640 ? 0 : 0.30; shiftY = W < 640 ? -0.48 : 0;
        introPose = { eye, forward, up, shiftX, shiftY };
      } else if (introBlend > 0 && introPose) {
        const t = introBlend / 0.85, k = t * t * (3 - 2 * t);
        eye = V.lerp(eye, introPose.eye, k); forward = V.norm(V.lerp(forward, introPose.forward, k));
        up = V.norm(V.lerp(up, introPose.up, k)); shiftX = introPose.shiftX * k; shiftY = introPose.shiftY * k;
      }
      projM = perspective(cam.fovDraw || cam.fov, W / H, 1, 4000);
      projM[8] = shiftX; projM[9] = shiftY;
      viewM = lookAt(eye, V.add(eye, forward), up);
      // The preview sits far enough out to frame the whole fold, well beyond the flight fog, so push the
      // fog back while it runs or the structure is invisible.
      const fogN = P.preview > 0 ? A(25) + previewR * 0.8 : A(25);
      const fogF = P.preview > 0 ? A(60) + previewR * 3.0 : A(60);
      renderer.begin(w, h, projM, viewM, [0.3, 0.85, 0.45], BG, fogN, fogF);
      // The two-pass fade doubles the work on the largest mesh in the scene, and on a phone that alone
      // cost enough frames to make the boost and the brake feel dead. Almost every frame has nothing
      // within the band, so ask first and draw once when the answer is no.
      if (showIntro) renderer.draw(ribbonMesh);
      else {
        if (nearOn) {
          renderer.draw(ribbonMesh, false, 1, false, false, nearSolidNow);
          for (const c of chunks) renderer.draw(c.mesh, false, 1, false, false, SIDE_SOLID);
          if (cofMesh) renderer.draw(cofMesh, false, 1, false, false, SIDE_SOLID);
          renderer.draw(ribbonMesh, false, 1, false, false, nearFadeNow);        // the near shell, faded out
        } else {
          renderer.draw(ribbonMesh);
          for (const c of chunks) renderer.draw(c.mesh, false, 1, false, false, SIDE_SOLID);
          if (cofMesh) renderer.draw(cofMesh, false, 1, false, false, SIDE_SOLID);
        }
        // A silhouette of the craft, painted through whatever is in front of it. In a tight fold the ribbon
        // comes between the lens and the ship and the player simply loses it. Drawn BEFORE the solid craft
        // and with the same geometry, so wherever the ship is actually visible the solid pass covers it
        // exactly and nothing looks doubled.
        renderer.draw(gliderMesh, true, 0.45, false, true);
        renderer.draw(gliderMesh);
        renderer.draw(gliderGlowMesh, true);
        renderer.draw(ghostMesh, false, 0.5);
        // drawn through the geometry at low alpha: a ghost you cannot see round a bend tells you nothing,
        // and it must never be mistaken for something you can hit
        if (ghostPose && ghostCraftMesh) renderer.draw(ghostCraftMesh, true, 0.42, true, true);
        renderer.draw(fxMesh, true, 1, true); // additive
        // A cofactor sits buried in the fold, so the ribbon is always between it and the lens and the solid
        // pass alone leaves it a dark smudge. A faint additive pass drawn through the geometry makes it glow
        // from inside the protein — which is where it actually is, and reads as the thing the fold is built
        // around rather than as another collectable stuck to the wall.
        // The x-ray pass exists so a buried cofactor is not a dark smudge behind the ribbon. Up close there
        // is nothing left to see through, and additive blending on top of the solid pass saturates the whole
        // group to white — 1LDG's NADH sits 1.9 Å off the rail and filled a third of the screen with grey
        // balls. Fade it out as it comes onto the lens, the same discipline the effect quads use.
        if (cofMesh && cofs.length) {
          let dn = 1e9;
          for (const c of cofs) dn = Math.min(dn, V.len(V.sub(c.cen, cam.pos)));
          const xa = 0.22 * clamp((dn / SC - 4.5) / 5.5, 0, 1);
          if (xa > 0.02) renderer.draw(cofMesh, true, xa, true, true);
        }
        renderer.draw(postMesh, true, 1, true, true); // target posts, drawn through the sheet ahead
      }
    }
    // The overlay used to escape the scene's pixel budget: 9.4 million pixels at
    // 2048×1152 / 2×, and 33 million at 4K / 2×. Keep a separate, sharper HUD budget.
    const hudDpr = Math.min(dpr, Math.sqrt(2560 * 1440 / Math.max(1, W * H)));
    const hudW = Math.max(1, Math.floor(W * hudDpr)), hudH = Math.max(1, Math.floor(H * hudDpr));
    if (hudCanvas.width !== hudW || hudCanvas.height !== hudH) { hudCanvas.width = hudW; hudCanvas.height = hudH; }
    hud.setTransform(hudW / W, 0, 0, hudH / H, 0, 0);
    hud.clearRect(0, 0, W, H);
    if (showIntro) return;
    const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const sans = 'system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif';

    // comfort vignette: the periphery darkens while the view turns fast
    if (TUNE.vignette && P.camTurn > 30) {
      const k = clamp((P.camTurn - 30) / 90, 0, 1) * 0.55;
      drawEdgeTint(W, H, 0, k);
    }
    // boost tint
    if (P.boostGlow > 0.02) {
      drawEdgeTint(W, H, 1, 0.25 * P.boostGlow);
    }

    // Where is the craft? A sheet hairpin can carry it right off the screen for a third of a second —
    // the geometry turns faster than any clamp rate worth using — and a player with no craft and no
    // heading is simply lost. Point at it from the edge instead of whipping the view round to find it.
    // Whether it is lost, and the fade, are decided in update(): they are state, not drawing, and keeping
    // them here meant they never advanced on a frame that was not drawn.
    const glP = rail && !P.done && gliderPos ? project(gliderPos, W, H) : null;
    if (P.lostGlow > 0.02 && P.lostDir) {
      const MG = 26, [ux, uy] = P.lostDir;
      const hw = Math.max(10, W / 2 - MG), hh = Math.max(10, H / 2 - MG);
      const t = Math.min(Math.abs(ux) > 1e-4 ? hw / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-4 ? hh / Math.abs(uy) : 1e9);
      hud.save();
      hud.translate(W / 2 + ux * t, H / 2 + uy * t); hud.rotate(Math.atan2(uy, ux));
      hud.globalAlpha = P.lostGlow * (0.6 + 0.4 * Math.abs(Math.sin(P.t * 7)));
      hud.fillStyle = 'rgb(126,214,255)';
      hud.beginPath(); hud.moveTo(13, 0); hud.lineTo(-7, -9); hud.lineTo(-3, 0); hud.lineTo(-7, 9); hud.closePath(); hud.fill();
      hud.restore();
      hud.globalAlpha = 1;
    }

    // score pops in world space
    const compact0 = TOUCH || W < 640;
    const gl0 = glP;
    const anchor = gl0 && gl0[0] > 0 && gl0[0] < W && gl0[1] > 0 && gl0[1] < H ? gl0 : [W / 2, H * 0.62];
    pops.forEach((q, qi) => {
      const a = 1 - q.age / 1.1;
      hud.globalAlpha = Math.min(1, a * 1.5); hud.fillStyle = q.col; hud.textAlign = 'center'; hud.textBaseline = 'middle';
      hud.font = `500 ${compact0 ? 14 : 17}px ${sans}`;
      // A pop is centred on a point in the world, so on a narrow phone a long one ("sheet repaired +500")
      // runs off the edge and is read as "f repaired +500". Keep the whole string on screen.
      const half = hud.measureText(q.text).width / 2 + 6;
      const px = clamp(anchor[0] + q.dx, half, Math.max(half, W - half));
      hud.fillText(q.text, px, anchor[1] - 42 - 14 * q.age);
    });
    hud.globalAlpha = 1; hud.textBaseline = 'top';

    // A single hierarchy across phone and desktop: score + combo, fold identity, progress map.
    const compact = TOUCH || W < 640;
    const M = compact ? 18 : 28;
    const veil = hud.createLinearGradient(0, 0, 0, 130);
    veil.addColorStop(0, 'rgba(5,8,18,0.50)'); veil.addColorStop(1, 'rgba(5,8,18,0)');
    hud.fillStyle = veil; hud.fillRect(0, 0, W, 130);
    hud.fillStyle = TXT; hud.textAlign = 'left';
    hud.font = `500 ${compact ? 28 : 34}px ${sans}`;
    hud.fillText(P.score.toLocaleString('en-US'), M, 14);
    hud.font = `${compact ? 11 : 12}px ${sans}`;
    hud.fillStyle = 'rgb(170,184,198)';
    hud.fillText(`${P.fixed} / ${totalHelix} restored`, M, compact ? 49 : 57);
    const comboY = compact ? 70 : 80;
    if (P.combo >= 2 && !P.done) {
      hud.fillStyle = ELEM_COL.H; hud.font = `500 ${compact ? 13 : 15}px ${sans}`;
      hud.fillText(`×${1 + Math.floor(P.combo / 5)}  ·  ${P.combo} in a row`, M, comboY);
    }
    if (P.groove > 0.02 && !P.done && !autopilot) {
      const gy = comboY + (P.combo >= 2 ? 30 : 0), bw = compact ? 65 : 90;
      hud.fillStyle = 'rgba(142,199,182,0.18)'; hud.fillRect(M, gy, bw, 3);
      hud.fillStyle = ELEM_COL.E; hud.fillRect(M, gy, bw * P.groove, 3);
      hud.font = `11px ${sans}`; hud.fillText('Slipstream', M, gy + 9);
    }
    if (autopilot) {
      hud.fillStyle = 'rgb(170,184,198)'; hud.font = `11px ${sans}`;
      hud.fillText('Autopilot', M, comboY + (P.combo >= 2 ? 24 : 0));
    }
    hud.textAlign = 'right'; hud.fillStyle = TXT;
    hud.font = `500 ${compact ? 12 : 15}px ${sans}`;
    const foldTitle = fold ? fold.title : '';
    const labelWidth = W * (compact ? 0.54 : 0.50);
    if (hudLabelCache.title !== foldTitle || hudLabelCache.width !== labelWidth || hudLabelCache.font !== hud.font) {
      let label = foldTitle;
      while (label.length > 4 && hud.measureText(label).width > labelWidth) label = label.slice(0, -1);
      Object.assign(hudLabelCache, { title: foldTitle, width: labelWidth, font: hud.font, label: label === foldTitle ? label : label.trimEnd() + '…' });
    }
    hud.fillText(hudLabelCache.label, W - M, 19);
    if (rail) {
      const node = rail.nodeAt(P.s);
      const ri = clamp(Math.round(node.res), 0, seq.length - 1);
      hud.font = `${compact ? 10 : 12}px ${sans}`;
      hud.fillStyle = ELEM_COL[node.elem] || TXT;
      hud.fillText(`${isPdb(fold) ? pdbCode(fold) + '  ·  ' : ''}${ELEM_NAME[node.elem] || 'coil'}  ·  ${nums[ri]}`, W - M, 39);
      if ((node.trench || 0) > 0.6) {
        hud.fillStyle = ELEM_COL.E;
        hud.fillText(P.ice ? 'Trench · low grip' : 'Trench · left / right', W - M, 57);
      } else if (ghostPose && !P.done) {
        const d = (P.s - ghostPose.s) / SC;
        if (Math.abs(d) > 0.5) {
          hud.fillStyle = d > 0 ? ELEM_COL.E : 'rgb(219,158,149)';
          hud.fillText(`${d > 0 ? '+' : ''}${d.toFixed(0)} Å vs best`, W - M, 57);
        }
      }
    }
    const MS = compact ? 80 : 104;
    const mmx = W - M - MS, mmy = H - (compact ? 96 : 32) - MS;
    drawMinimap(mmx, mmy, MS);
    if (landmarkFocus && !P.done && P.preview <= 0) {
      const m = landmarkFocus, age = P.t-m.start, caught = m.phase === 'collected';
      const cc = COF_COL[m.c.n] || [0.9,0.6,0.4];
      const alpha = Math.min(1, age / 0.25) * (caught ? Math.min(1, (2.2-age)/0.5) : 1);
      const y = H < 500 ? 85 : 120, width = Math.min(W-128, 360);
      hud.save(); hud.globalAlpha = Math.max(0, alpha); hud.textAlign = 'center';
      hud.shadowColor = 'rgba(5,8,18,0.9)'; hud.shadowBlur = 8;
      hud.fillStyle = `rgb(${cc.map(v => Math.round(v*255)).join(',')})`;
      hud.font = `500 ${compact ? 17 : 20}px ${sans}`;
      hud.fillText(m.c.name, W/2, y, width);
      hud.font = `11px ${sans}`; hud.fillStyle = TXT;
      hud.fillText(caught ? `Cofactor claimed · +${m.points.toLocaleString()}` : 'Cofactor ahead · follow the ring', W/2, y+21, width);
      hud.restore();
    }
    hud.textAlign = 'left';
    // lunge target dot
    if (laneMode && rail && !P.done && lunge.active) {
      const nd = rail.nodeAt(P.s + A(1.0));
      const rho = Math.min(A(1.25), 0.75 * (nd.R - A(WALL_MARGIN)));
      const wp = V.add(nd.p, V.add(V.scale(nd.r, Math.cos(lunge.ang) * rho), V.scale(nd.u, Math.sin(lunge.ang) * rho)));
      const sp = project(wp, W, H);
      if (sp) { hud.fillStyle = 'rgba(255,179,71,0.8)'; hud.beginPath(); hud.arc(sp[0], sp[1], 5, 0, Math.PI * 2); hud.fill(); }
    }
    // turn indicator: a chevron pointing where the path bends over the next 8 Å, growing with sharpness
    if (rail && !P.done && P.bendAhead > 20) {
      const rgt = V.norm(V.cross(cam.fwd, cam.up)), up2 = cam.up;
      let dx = V.dot(P.bendDir, rgt), dy = V.dot(P.bendDir, up2);
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const k = clamp((P.bendAhead - 20) / 70, 0, 1);
      const cxI = W / 2, cyI = compact ? H * 0.22 : H * 0.26, r = (compact ? 70 : 110);
      const px = cxI + dx * r, py = cyI - dy * r;
      hud.save(); hud.translate(px, py); hud.rotate(Math.atan2(-dy, dx));
      hud.globalAlpha = 0.38 + 0.5 * k;
      hud.strokeStyle = k > 0.6 ? ELEM_COL.H : TXT; hud.lineWidth = 2 + k; hud.lineCap = 'round'; hud.lineJoin = 'round';
      const sz = 9 + 6 * k;
      hud.beginPath(); hud.moveTo(-sz * 0.65, -sz); hud.lineTo(sz * 0.35, 0); hud.lineTo(-sz * 0.65, sz); hud.stroke();
      hud.restore(); hud.globalAlpha = 1;
    }
    // fold title card at the start of a fold: what you are flying, and who solved it
    if (titleCardT > 0 && fold && !P.done) {
      const a = Math.min(1, titleCardT / 0.6) * Math.min(1, (4.5 - titleCardT) / 0.4 + 0.01);
      hud.globalAlpha = a; hud.textAlign = 'center'; hud.fillStyle = TXT;
      const y0 = compact ? H * 0.3 : H * 0.36;
      hud.font = `300 ${compact ? 22 : 30}px ${sans}`; hud.fillText(fold.title, W / 2, y0);
      hud.font = `${compact ? 11 : 13}px ${mono}`; hud.fillStyle = ELEM_COL.H;
      if (isPdb(fold)) {
        hud.fillText(`PDB ${pdbCode(fold)} · ${seq.length} residues`, W / 2, y0 + (compact ? 30 : 40));
        hud.fillStyle = 'rgba(219,230,255,0.8)';
        const who = authorLine(fold.meta, 3); if (who) hud.fillText(`structure by ${who}`, W / 2, y0 + (compact ? 48 : 62));
        if (fold.meta.journal) hud.fillText(prettyJournal(fold.meta.journal), W / 2, y0 + (compact ? 64 : 82));
      } else hud.fillText(`${seq.length} residues · synthetic tutorial`, W / 2, y0 + (compact ? 30 : 40));
      hud.globalAlpha = 1;
    }
    // centre flash
    if (flash.t > 0 && flash.text) {
      hud.textAlign = 'center'; hud.font = `${compact ? 12 : 16}px ${sans}`; hud.fillStyle = TXT;
      hud.globalAlpha = Math.min(1, flash.t / 0.4);
      if (compact && hud.measureText(flash.text).width > W - 30) { // wrap once on narrow screens
        // Sit it low, like a subtitle. Score pops float up from the craft through the middle of the
        // screen, and at 0.6 H a hint and a run of pops land on top of each other and neither reads.
        const parts = flash.text.split(' · '); parts.forEach((ln, k) => hud.fillText(ln, W / 2, H - 96 + k * 16));
      } else hud.fillText(flash.text, W / 2, H - 96);
      hud.globalAlpha = 1;
    }

    // finish card
    if (P.done) {
      const cw = Math.min(520, W - 40);
      const rows = [
        ['fold score', `${P.score - P.base}${best.score !== null && P.score - P.base >= best.score ? '  · new best' : ''}`],
        ['run total', `${P.score} · ${P.runFolds} fold${P.runFolds > 1 ? 's' : ''}`],
        ['time', `${P.t.toFixed(1)} s${best.time !== null && P.t <= best.time + 1e-6 ? '  · best' : ''}`],
        ['side chains fixed', `${P.fixed} of ${totalHelix} · ${P.perfect} perfect`],
        ...(cofs.length ? [['cofactors', `${P.cofs} of ${cofs.length} · ${cofs.map((c) => c.name).join(', ')}`]] : []),
        ...(P.runFolds >= FOLDS.length ? [['campaign', `all ${FOLDS.length} folds in one run`]] : []),
        ...(P.rolls ? [['barrel rolls', `${P.rolls}`]] : []),
        ...(P.grooveBest > 0.1 ? [['best slipstream', `${Math.round(P.grooveBest * 100)}%`]] : []),
        ['helices fully repaired', `${P.helices}`],
        ['side chains missed', `${P.missed}`],
        ['longest combo', `${P.bestCombo}`],
      ];
      if (isPdb(fold)) {
        rows.push(['structure', `PDB ${pdbCode(fold)} · rcsb.org/structure/${pdbCode(fold)}`]);
        if (authorLine(fold.meta, 2)) rows.push(['solved by', authorLine(fold.meta, 2)]);
        if (fold.meta.journal) rows.push(['published in', prettyJournal(fold.meta.journal) + (fold.meta.doi ? ` · doi.org/${fold.meta.doi.toLowerCase()}` : '')]);
      } else rows.push(['structure', 'synthetic tutorial fold, no PDB entry']);
      // layout: a value that does not fit beside its label at 11 px goes on its own line underneath
      const inner = cw - 48, lineH = 22;
      hud.font = `13px ${mono}`;
      const layout = rows.map(([k, v]) => {
        const kw = hud.measureText(k).width;
        let fs = 13; hud.font = `${fs}px ${mono}`;
        while (fs > 11 && hud.measureText(v).width > inner - kw - 14) { fs--; hud.font = `${fs}px ${mono}`; }
        const fits = hud.measureText(v).width <= inner - kw - 14;
        let vfs = fs;
        if (!fits) { vfs = 12; hud.font = `${vfs}px ${mono}`; while (vfs > 8 && hud.measureText(v).width > inner) { vfs--; hud.font = `${vfs}px ${mono}`; } }
        hud.font = `13px ${mono}`;
        return { k, v, fits, vfs, h: fits ? lineH : lineH + 16 };
      });
      const ch = 96 + layout.reduce((a, r) => a + r.h, 0) + 44;
      const cx = (W - cw) / 2, cy = Math.max(12, (H - ch) / 2);
      // The card is deliberately translucent so the fold stays visible behind it, but at 0.82 the craft —
      // which sits dead centre at the C-terminus, dark and ship-sized — showed straight through the middle
      // rows and cut the text in half. Opaque enough to read against anything, still not a solid slab.
      hud.fillStyle = 'rgba(5,8,18,0.94)'; hud.fillRect(cx, cy, cw, ch);
      hud.strokeStyle = 'rgba(219,230,255,0.12)'; hud.lineWidth = 1; hud.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
      hud.textAlign = 'left'; hud.fillStyle = TXT; hud.textBaseline = 'top';
      // Finishing all ten in one run is the end of the campaign and should say so. runFolds counts the
      // folds carried through on this run, so it only reads 10 if you never broke the chain.
      const campaign = P.runFolds >= FOLDS.length;
      hud.font = `11px ${mono}`;
      if (campaign) { hud.fillStyle = 'rgb(190,140,255)'; hud.fillText('THE WHOLE FOLD, N TO C · ALL TEN', cx + 24, cy + 20); hud.fillStyle = TXT; }
      else hud.fillText('C-TERMINUS REACHED', cx + 24, cy + 20);
      hud.font = `500 ${compact ? 16 : 20}px ${sans}`;
      let ttl = fold.title; const maxW = cw - 48 - (compact ? 60 : 90);
      while (ttl.length > 4 && hud.measureText(ttl + '…').width > maxW) ttl = ttl.slice(0, -1);
      hud.fillText(ttl === fold.title ? ttl : ttl.trim() + '…', cx + 24, cy + 40);
      hud.textAlign = 'right'; hud.font = `400 ${compact ? 56 : 72}px ${sans}`;
      hud.fillStyle = P.rank === 'S' ? 'rgb(190,140,255)' : P.rank === 'A' ? ELEM_COL.H : P.rank === 'B' ? ELEM_COL.E : TXT;
      hud.fillText(P.rank, cx + cw - 24, cy + 14);
      let y = cy + 96;
      for (const r of layout) {
        hud.font = `13px ${mono}`; hud.textAlign = 'left'; hud.fillStyle = 'rgba(219,230,255,0.6)'; hud.fillText(r.k, cx + 24, y);
        hud.fillStyle = TXT; hud.textAlign = 'right'; hud.font = `${r.vfs}px ${mono}`;
        if (r.fits) hud.fillText(r.v, cx + cw - 24, y + (13 - r.vfs) / 2);
        else hud.fillText(r.v, cx + cw - 24, y + 17);
        y += r.h;
      }
      hud.font = `13px ${mono}`;
      hud.fillStyle = ELEM_COL.H; hud.font = `12px ${sans}`; hud.textAlign = 'center';
      hud.fillText(campaign
        ? (compact || TOUCH ? 'tap · fly the campaign again      ⋯ menu' : 'click, N or Enter · fly the campaign again      R · this fold again')
        : (compact || TOUCH ? 'tap · next fold      ⋯ menu · fly it again' : 'click, N or Enter · next fold      R · fly it again'), cx + cw / 2, cy + ch - 28);
    }

    // footer (desktop only)
    hud.textAlign = 'center'; hud.font = `11px ${sans}`; hud.fillStyle = 'rgba(219,230,255,0.45)';
    if (touch.id !== null && !laneMode) { // virtual stick
      hud.strokeStyle = 'rgba(219,230,255,0.35)'; hud.lineWidth = 1.5;
      hud.beginPath(); hud.arc(touch.x0, touch.y0, 60, 0, Math.PI * 2); hud.stroke();
      hud.fillStyle = 'rgba(219,230,255,0.6)';
      hud.beginPath(); hud.arc(touch.x0 + clamp(touch.dx, -60, 60), touch.y0 + clamp(touch.dy, -60, 60), 14, 0, Math.PI * 2); hud.fill();
    }
    if (status.err) { hud.fillStyle = 'rgb(255,120,110)'; hud.textAlign = 'left'; hud.font = `12px ${mono}`; hud.fillText(String(status.err), 20, 170); }
  }

  // ---------------------------------------------------------------- loop
  function frame(dt, skipDraw) {
    const now = performance.now();
    if (dt === undefined) { dt = lastNow ? (now - lastNow) / 1000 : 1 / 60; lastNow = now; }
    dt = clamp(dt, 0, 0.1);
    if (P.slow > 0) { P.slow -= dt; dt *= 0.25; } // hit-stop
    try { syncSound(); if (!paused) update(dt); sound.pump(); if (!skipDraw) draw(); } catch (e) { status.err = String(e && e.stack || e); }
    status.frames++;
    if (HEADLESS) document.title = JSON.stringify(status);
  }
  window.frame = frame;
  window.flyerStatus = () => status;
  window.setMarathon = (v) => { MARATHON = !!v; };
  // Fairness audit (dev tool): for every side chain, the band of craft positions inside the corridor from
  // which it can actually be collected, and for every sheet passage, the widest clear lateral gap.
  // Dev: signed distance from a point to the ribbon SURFACE, using the mesh that is actually drawn and its
  // normals. Negative means inside the geometry. Measuring to Cα points hid this: the coil tube is 0.6 Å
  // thick and a strand 2.35 Å wide, so being 0.3 Å from the centre line is well inside the surface.
  // Analytic penetration of the drawn ribbon, using its own profile rather than a nearest-vertex sign test.
  // The vertex test cannot tell inside from outside in an enclosed space (between two sheets of a barrel it
  // reported 2.8 Å "inside" where there was open air), which is what made the corridor fit collapse.
  const RIB_HW = { H: 1.1, E: 2.35, C: 0.6 }, RIB_HT = { H: 0.2, E: 0.2, C: 0.6 };
  let ribFrames = null;
  function buildRibFrames() {
    ribFrames = null;
    if (!rail || !ca) return;
    const n = ca.length / 3, caP = (k) => [ca[3 * k] * SC, ca[3 * k + 1] * SC, ca[3 * k + 2] * SC];
    const t = [], nv = [], bv = [], pos = [];
    let prevN = null;
    for (let i = 0; i < n; i++) {
      const ti = V.norm(V.sub(caP(Math.min(n - 1, i + 1)), caP(Math.max(0, i - 1))));
      let m = null;
      const nd = rail.resNode(i);
      if (ss[i] === 'H' && rail.axis && rail.axis[i]) m = V.perp(V.sub(rail.axis[i], caP(i)), ti);
      else if (nd && nd.sheetN) m = V.perp(nd.sheetN, ti);
      else if (i > 0 && i < n - 1) m = V.perp(V.sub(V.add(caP(i - 1), caP(i + 1)), V.scale(caP(i), 2)), ti);
      if (!m || V.len(m) < 1e-4) m = prevN ? V.perp(prevN, ti) : V.perp(Math.abs(ti[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], ti);
      m = V.norm(m); prevN = m;
      t.push(ti); nv.push(m); bv.push(V.cross(ti, m)); pos.push(caP(i));
    }
    ribFrames = { t, nv, bv, pos, n };
  }
  // How deep inside the ribbon a point is, in Å. 0 means outside. Also returns the element it is inside.
  function ribbonPenetration(p, skipRes, skipSpan) {
    if (!ribFrames) return { depth: 0 };
    const { t, nv, bv, pos, n } = ribFrames;
    let worst = 0, where = null;
    for (let k = 0; k < n; k++) {
      if (skipSpan && Math.abs(k - skipRes) <= skipSpan) continue;
      const rel = V.sub(p, pos[k]);
      const a = V.dot(rel, t[k]);
      if (Math.abs(a) > 1.9 * SC) continue;
      const e = ss[k], w = RIB_HW[e] * SC, h = RIB_HT[e] * SC;
      const u = V.dot(rel, bv[k]), v = V.dot(rel, nv[k]);
      const q = Math.sqrt((u * u) / (w * w) + (v * v) / (h * h));
      if (q >= 1) continue;
      const d = (1 - q) * Math.min(w, h) / SC;
      if (d > worst) { worst = d; where = e; }
    }
    return { depth: +worst.toFixed(2), ss: where };
  }
  // Where the worst penetration is AND which way is out. The ribbon cross-section is an ellipse in each
  // residue's own (bv, nv) frame, so the outward direction is the gradient of q = sqrt(u²/w² + v²/h²),
  // which is (u/w², v/h²) in that frame. Returned in world units, unit length. This is what makes a
  // correction possible that is proportional to how wrong things are, instead of a search over poses.
  function ribbonEscape(p, skipRes, skipSpan) {
    if (!ribFrames) return { depth: 0, dir: null };
    const { t, nv, bv, pos, n } = ribFrames;
    let worst = 0, dir = null;
    for (let k = 0; k < n; k++) {
      if (skipSpan && Math.abs(k - skipRes) <= skipSpan) continue;
      const rel = V.sub(p, pos[k]);
      const a = V.dot(rel, t[k]);
      if (Math.abs(a) > 1.9 * SC) continue;
      const e = ss[k], w = RIB_HW[e] * SC, h = RIB_HT[e] * SC;
      const u = V.dot(rel, bv[k]), v = V.dot(rel, nv[k]);
      const q = Math.sqrt((u * u) / (w * w) + (v * v) / (h * h));
      if (q >= 1) continue;
      const d = (1 - q) * Math.min(w, h) / SC;
      if (d > worst) {
        worst = d;
        // degenerate at the exact centre line: push along the thin axis, the shortest way out
        const gu = u / (w * w), gv = v / (h * h);
        const g = Math.hypot(gu, gv);
        dir = g > 1e-9 ? V.norm(V.add(V.scale(bv[k], gu / g), V.scale(nv[k], gv / g)))
                       : V.norm(nv[k].slice());
      }
    }
    return { depth: worst, dir };
  }

  // Unsigned clearance from a point to the drawn ribbon strips, in Å. A helix ribbon is only 0.4 Å
  // thick, so a camera 0.3 Å off its face is outside the geometry and still fills the whole screen:
  // penetration alone never catches that, clearance does.
  function ribbonClear(p, skipRes, skipSpan) {
    if (!ribFrames) return 1e9;
    const { t, nv, bv, pos, n } = ribFrames;
    let best = 1e9;
    for (let k = 0; k < n; k++) {
      if (skipSpan && Math.abs(k - skipRes) <= skipSpan) continue;
      const rel = V.sub(p, pos[k]);
      const a = V.dot(rel, t[k]);
      if (Math.abs(a) > 4 * SC) continue;
      const e = ss[k], w = RIB_HW[e] * SC, h = RIB_HT[e] * SC, ha = 1.9 * SC;
      const u = V.dot(rel, bv[k]), v = V.dot(rel, nv[k]);
      const da = Math.max(Math.abs(a) - ha, 0), du = Math.max(Math.abs(u) - w, 0), dv = Math.max(Math.abs(v) - h, 0);
      const d = Math.sqrt(da * da + du * du + dv * dv) / SC;
      if (d < best) best = d;
    }
    return best;
  }
  // Walk the finished rail and report where its tangent turns fastest, in degrees per Å. A kink here is
  // a kink the player flies into: the camera can only smooth it, never remove it.
  window.railScan = function (thr) {
    if (!rail) return null;
    const out = [], step = A(0.5);
    for (let sq = step; sq < rail.length - step; sq += step) {
      const t0 = rail.nodeAt(sq - step).t, t1 = rail.nodeAt(sq + step).t;
      const deg = Math.acos(clamp(V.dot(t0, t1), -1, 1)) * 180 / Math.PI / (2 * 0.5);
      if (deg > (thr || 40)) { const n0 = rail.nodeAt(sq);
        out.push([Math.round(n0.res), +deg.toFixed(0), n0.elem, +(n0.trench || 0).toFixed(2), +(n0.hw || 0).toFixed(2)]); }
    }
    return out;
  };
  // How wide is the playable corridor along the whole rail? If `lim` falls below the craft's own radius
  // the route cannot be flown without touching a wall, whatever the player does.
  window.railLim = function () {
    if (!rail) return null;
    const out = []; let tight = 0, n = 0;
    for (let sq = 0; sq < rail.length; sq += A(0.5)) {
      const nd = rail.nodeAt(sq), lim = (nd.R - A(WALL_MARGIN)) / SC; n++;
      if (lim < CRAFT_R + 0.05) { tight++; if (out.length < 25) out.push([Math.round(nd.res), +lim.toFixed(2), +(nd.trench || 0).toFixed(2)]); }
    }
    return { n, tight, pct: +(100 * tight / n).toFixed(1), worst: out };
  };
  // Can the obstacle side chains ('L' blocks beside a sheet) actually be hit? They are only a hazard if
  // the craft can reach them inside the slot it is allowed to fly in.
  window.obstacleReach = function () {
    if (!rail) return null;
    let n = 0, reach = 0, near = [];
    for (const b of blocks) {
      if (b.type !== 'L') continue;
      n++;
      const nb = rail.nodeAt(b.s);
      let best = 1e9;
      for (let j = 0; j <= 80; j++) {
        const x = -(nb.slotL || TRENCH_HALF) + ((nb.slotL || TRENCH_HALF) + (nb.slotR || TRENCH_HALF)) * (j / 80);
        for (let k = 0; k <= 6; k++) {
          const y = -0.6 + 1.2 * (k / 6);
          const p = V.add(nb.p, V.add(V.scale(nb.r, A(x)), V.scale(nb.u, A(y))));
          best = Math.min(best, touchDist(p, b) / SC);
        }
      }
      if (best < CRAFT_R) reach++; else if (best < CRAFT_R + 0.4) near.push(+best.toFixed(2));
    }
    return { obstacles: n, reachable: reach, nearMiss: near.length };
  };

  // boolean form with an early exit: the camera search only ever asks "is there this much daylight?"
  function ribbonClearAtLeast(p, thr) {
    if (!ribFrames) return true;
    const { t, nv, bv, pos, n } = ribFrames, T = thr * SC, T2 = T * T;
    for (let k = 0; k < n; k++) {
      const px = p[0] - pos[k][0], py = p[1] - pos[k][1], pz = p[2] - pos[k][2];
      const tk = t[k], a = px * tk[0] + py * tk[1] + pz * tk[2], ha = 1.9 * SC;
      const da = Math.abs(a) - ha;
      if (da > T) continue;
      const e = ss[k], w = RIB_HW[e] * SC, h = RIB_HT[e] * SC;
      const bk = bv[k], nk = nv[k];
      const du = Math.abs(px * bk[0] + py * bk[1] + pz * bk[2]) - w;
      if (du > T) continue;
      const dv = Math.abs(px * nk[0] + py * nk[1] + pz * nk[2]) - h;
      if (dv > T) continue;
      const qa = Math.max(da, 0), qu = Math.max(du, 0), qv = Math.max(dv, 0);
      if (qa * qa + qu * qu + qv * qv < T2) return false;
    }
    return true;
  }
  // How wide is the playable corridor along the first stretch, against the 1.25 Å a single swipe throws
  // the craft? If the corridor is narrower than the reach, a full lunge collides with no mistake made.
  window.limScan = function (upto) {
    if (!rail) return null;
    const out = [];
    for (let q = 0; q <= (upto || 40); q += 2) {
      const nd = rail.nodeAt(A(q));
      out.push(+(Math.max(nd.R - A(WALL_MARGIN), A(CRAFT_R + 0.06)) / SC).toFixed(2));
    }
    return out;
  };
  let ribGrid = null;
  function buildRibbonGrid() {
    ribGrid = null;
    if (!ribbonGeom) return;
    const pos = ribbonGeom.pos, cell = 1.2 * SC, map = new Map();
    for (let i = 0; i < pos.length; i += 3) {
      const k = Math.floor(pos[i] / cell) + ',' + Math.floor(pos[i + 1] / cell) + ',' + Math.floor(pos[i + 2] / cell);
      let a = map.get(k); if (!a) { a = []; map.set(k, a); }
      a.push(i);
    }
    ribGrid = { map, cell };
  }
  function surfaceDist(p) {
    if (!ribbonGeom || !ribGrid) return 1e9;
    const pos = ribbonGeom.pos, nrm = ribbonGeom.nrm, { map, cell } = ribGrid;
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    let best = 1e9, bi = -1;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const arr = map.get((cx + a) + ',' + (cy + b) + ',' + (cz + c));
      if (!arr) continue;
      for (const i of arr) {
        const dx = p[0] - pos[i], dy = p[1] - pos[i + 1], dz = p[2] - pos[i + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) { best = d2; bi = i; }
      }
    }
    if (bi < 0) return 1e9;
    const dx = p[0] - pos[bi], dy = p[1] - pos[bi + 1], dz = p[2] - pos[bi + 2];
    const sgn = dx * nrm[bi] + dy * nrm[bi + 1] + dz * nrm[bi + 2];
    return (sgn < 0 ? -1 : 1) * Math.sqrt(best) / SC;
  }
  // Shrink the corridor and the trench slot until the whole playable cross-section is outside the surface.
  // Fade geometry out as it comes onto the lens, so a wall a fraction of an angstrom away never blinds the
  // player. Mode 2 is the solid pass (everything beyond the band), mode 1 the near shell drawn over it.
  // Over a sheet the lens rides about 2 Å above the deck on purpose, so the trench band stops short of it.
  const NEAR_FADE = [A(0.9), A(2.2), 1], NEAR_SOLID = [A(0.9), A(2.2), 2];
  const NEAR_FADE_T = [A(0.35), A(1.2), 1], NEAR_SOLID_T = [A(0.35), A(1.2), 2];
  // Side chains take a clean cut rather than a fade: they are small and opaque, and a half-transparent
  // one on the lens veils the whole view in its own colour.
  const SIDE_SOLID = [A(0.5), A(1.8), 2];
  let nearFadeNow = NEAR_FADE, nearSolidNow = NEAR_SOLID, nearOn = false;
  const FIT_ANGLES = [0, 15, -15, 30, -30, 45, -45, 60, -60, 80, -80, 100, -100, 120, -120, 140, -140, 160, -160, 180];
  const FIT_SNAP_ROT = 70;   // deg the lens may swing in one frame when the smoothed seat is in a wall
  const FIT_BACKS = [0, 0.6];   // Å the lens may also come forward along the rail while it swings
  const FIT_SNAP_STEP = 0.3;  // A the hurry may slide the lens in one frame
const FIT_SLEW = 320, CAM_CLEAR = 0.9; // deg/s the lens may swing round the craft, and the daylight it wants
  const ROLL_MAX = 45;   // deg/s the horizon may rotate about the view axis
  const CONE_LEAD = 0.22, CONE_RATE = 150; // seconds of lead on the keep-in-frame clamp, and its rate cap
  const OMEGA_MAX = 65; // deg/s the path may rotate the view before the craft eases off
  const SURF_CLEAR = 0.45; // Å of daylight between the craft's hull and the ribbon
  function fitCorridorToSurface() {
    if (!ribbonGeom || !rail) return;
    buildRibbonGrid();
    const ok = (p) => surfaceDist(p) >= SURF_CLEAR;
    // binary search, and only when the full extent is not already clear: a linear walk was too slow to load
    const fit = (p, dirs, r0, lo) => {
      if (dirs.every((d) => ok(V.add(p, V.scale(d, A(r0)))))) return r0;
      let a = lo, b = r0;
      for (let it = 0; it < 7; it++) {
        const mid = (a + b) / 2;
        if (dirs.every((d) => ok(V.add(p, V.scale(d, A(mid)))))) a = mid; else b = mid;
      }
      return a;
    };
    for (const nd of rail.nodes) {
      if ((nd.trench || 0) > 0.3) {
        nd.slotR = fit(nd.p, [nd.r], nd.slotR === undefined ? TRENCH_HALF : nd.slotR, 0.2);
        nd.slotL = fit(nd.p, [V.scale(nd.r, -1)], nd.slotL === undefined ? TRENCH_HALF : nd.slotL, 0.2);
      }
      nd.R = A(fit(nd.p, [nd.u, V.scale(nd.u, -1), nd.r, V.scale(nd.r, -1)], nd.R / SC, 0.3));
    }
  }
  // Dev: sanity-check surfaceDist by sampling it at the rail centre, where it should read the corridor's
  // own clearance (~2.1 Å inside a helix coil). If it reads small or negative there, the sign heuristic is
  // wrong and any corridor fitted to it will collapse.
  window.surfProbe = () => {
    buildRibbonGrid();
    const out = [];
    for (let k = 0; k < rail.nodes.length; k += 7) {
      const nd = rail.nodes[k];
      out.push({ ss: nd.elem, d: +surfaceDist(nd.p).toFixed(2) });
    }
    const ds = out.map((o) => o.d).sort((a, b) => a - b);
    const byss = {};
    for (const o of out) { (byss[o.ss] = byss[o.ss] || []).push(o.d); }
    const res = { n: out.length, min: ds[0], p10: ds[Math.floor(ds.length * 0.1)], median: ds[ds.length >> 1], neg: ds.filter((d) => d < 0).length };
    for (const k in byss) { const a2 = byss[k].sort((x, y) => x - y); res[k] = { median: a2[a2.length >> 1], min: a2[0] }; }
    return res;
  };
  window.flyerAudit = () => {
    const out = { fold: fold.id, len: +(rail.length / SC).toFixed(1), helix: [], sheet: [], cof: [] };
    for (const c of cofs) {
      // where the gate is, how far out it sits, and what the craft must do on either side of it
      const nb = rail.nodeAt(c.s);
      let prev = null, next = null;
      for (const b of blocks) {
        if (b.type !== 'H') continue;
        if (b.s <= c.s && (!prev || b.s > prev.s)) prev = b;
        if (b.s > c.s && (!next || b.s < next.s)) next = b;
      }
      const aimOf = (b) => b && b.aim ? [b.aim.x, b.aim.y] : null;
      out.cof.push({ n: c.n, name: c.name, s: +(c.s / SC).toFixed(2), off: +c.off.toFixed(2),
        lim: +c.lim.toFixed(2), near: c.near, r: COF_R, metal: !!c.metal,
        gate: [+(c.dx * c.off).toFixed(2), +(c.dy * c.off).toFixed(2)],
        prevS: prev ? +(prev.s / SC).toFixed(2) : null, prevAim: aimOf(prev),
        nextS: next ? +(next.s / SC).toFixed(2) : null, nextAim: aimOf(next) });
    }
    for (const b of blocks) {
      const nb = rail.nodeAt(b.s);
      const lim = (nb.R - A(WALL_MARGIN)) / SC;
      if (b.type === 'H') {
        const rel = V.sub(b.ca, nb.p);
        const dir = V.norm(V.perp(rel, nb.t));           // from the rail centre out toward this side chain
        const [sa, se] = blockSeg(b);
        let lo = null, hi = null, plo = null, phi = null, touchMin = null, perfMin = null;
        for (let k = 0; k <= 80; k++) {
          const sl2 = -(nb.slotL || TRENCH_HALF), sr2 = (nb.slotR || TRENCH_HALF);
          const r = b.trench ? sl2 + (sr2 - sl2) * k / 80 : lim * k / 80;
          const p = b.trench ? V.add(nb.p, V.scale(nb.r, A(r))) : V.add(nb.p, V.scale(dir, A(r)));
          const rel2 = V.sub(p, nb.p);
          const off = Math.hypot(V.dot(rel2, nb.r), V.dot(rel2, nb.u)) / SC; // how far the craft must be sent
          if (touchDist(p, b) < A(b.trench ? TRENCH_CATCH : CRAFT_R)) { if (lo === null) lo = r; hi = r; if (touchMin === null || off < touchMin) touchMin = off; }
          if (segDist(p, sa, se) < A(PERFECT_R)) { if (plo === null) plo = r; phi = r; if (perfMin === null || off < perfMin) perfMin = off; }
        }
        out.helix.push({ res: nums[b.i], trench: !!b.trench, s: +(b.s / SC).toFixed(2),
          aimX: +((b.aim && b.aim.x) || 0).toFixed(2), aimY: +((b.aim && b.aim.y) || 0).toFixed(2),
          lim: +lim.toFixed(2), inLen: +(b.inLen || 0).toFixed(2), stretch: +((b.inLen || 0) / Math.max(0.01, b.Lvis)).toFixed(2), Lvis: +b.Lvis.toFixed(2),
          rise: +V.dot(b.inw, rail.nodeAt(b.s).u).toFixed(2), aa: seq[b.i],
          touchMin: touchMin === null ? null : +touchMin.toFixed(2), perfMin: perfMin === null ? null : +perfMin.toFixed(2),
          lo: lo === null ? null : +lo.toFixed(2), hi: hi === null ? null : +hi.toFixed(2),
          band: lo === null ? 0 : +(hi - lo).toFixed(2), perfect: plo === null ? null : +(phi - plo).toFixed(2), gap: b.gap });
      } else {
        const tr = clamp(((nb.trench || 0) - 0.3) / 0.4, 0, 1);
        const half = tr > 0.5 ? 2.4 : lim;
        let best = -1e9, bestX = 0;
        for (let k = -60; k <= 60; k++) {
          const x = half * k / 60, p = V.add(nb.p, V.scale(nb.r, A(x)));
          if (clear > best) { best = clear; bestX = x; }
        }
        out.sheet.push({ res: nums[b.i], trench: +tr.toFixed(2), clear: +best.toFixed(2), atX: +bestX.toFixed(2) });
      }
    }
    return out;
  };

  loadFold(expandFold(FOLDS[0]));
  if (!HEADLESS) { (function loop() { frame(); requestAnimationFrame(loop); })(); }
})();
