# Fold Flyer — playtest log and open issues

**`node tools/phone_test.js --artifact` tests the file the published LINK serves.** The link serves the
fragment build wrapped in the head the Artifact tool supplies — a different file from the standalone, and
one nothing had ever opened. It passes all 22 checks. Two things make that non-obvious and worth keeping
the check for: the Artifact head sets a LIGHT colour scheme and an off-white body ground, which only stays
invisible because the game's own CSS paints `html, body` from `--bg`; and the fragment has no viewport
meta of its own, so opened raw it fails on layout. Content-wise the two builds differ only by the wrapper.

**Leaked browser processes make `phone_test` lie.** A killed headless run can leave its `headless_shell`
children behind. Twenty-seven of them had accumulated, load average 57, and the test's polling (a DevTools
round-trip every 30 ms) then misses the 0.55 s lunge entirely: the lunge checks reported 0.12–0.56 Å
instead of ~1.1 and the failures moved around between runs. It looks exactly like a real regression, and I
chased it into the game twice before checking `uptime`. **Check the load before believing a phone_test
failure**, and `pkill -f chromium_headless_shell` when nothing is running.

**`phone_test` bundles the current source before it runs.** It used to open `dist/FoldFlyer.html`
whichever build that happened to be, and since the bundle step normally runs AFTER the checks, every
"phone_test passed" in this log before this point actually described the previous build. Fixed at source:
the test now rebuilds unless given an explicit path.

Run order for any change: `python3 tools/acceptance.py`, `python3 tools/acceptance.py --oracle`,
`python3 tools/fairness.py`, `node tools/phone_test.js`. All four must pass before publishing.

## Audio, checked once
One persistent drone pair created behind a guard, retuned per element with `setTargetAtTime`; every other
sound is an oscillator that is started, ramped down and `stop()`ed, so nothing accumulates over a session.
The wall scrape re-triggers every 0.12 s while you lean on a wall, which is deliberate. No leak, nothing
firing per frame.

## Advertised features, verified working (they had never been exercised)
- **Drop a .pdb or .cif anywhere.** The control hint promises it and nothing had ever tested it. It works
  end to end: crambin (1CRN, 46 residues with side chains) parses, loads as its own fold and autopilot
  completes it 5/5 with no error. The drop path passes raw Å straight to `loadFold` while the packaged
  folds go through `expandFold`, which divides stored 0.1 Å integers by 10 — the units do agree. CIF
  parsing checked separately on 1XI4 (1630 residues, Cα only) and 3J9P (560 residues with side chains).
  `window.__load(st)` is exposed so this path can be tested without a human dragging a file.
- **The minimap as a progress map.** Lit fraction and position dot both track correctly through a run.
- **The finish card.** Rank, fold score, run total, time, side chains fixed with the perfect count,
  helices repaired, misses/hits/near misses, longest combo, the PDB entry and its citation.

## State at the end of the playtest run
A skilled player can take every fold at rank S, in campaign order, with every cofactor claimed. Oracle,
all ten, one sitting (re-measured 2026-09-13 after the cofactor and movement work):

| # | fold | side chains | perfect | rank | time | wall contacts | cofactors |
|---|---|---|---|---|---|---|---|
| 1 | BUNDLE | 20/20 | 20 | S | 14.5 s | 0 | — |
| 2 | 1AEP | 17/17 | 17 | S | 18.8 s | 0 | — |
| 3 | 256B | 13/13 | 13 | S | 14.5 s | 0 | 2/2 |
| 4 | 2ABD | 8/8 | 8 | S | 14.4 s | 0 | — |
| 5 | 1BCF | 23/23 | 23 | S | 17.5 s | 0 | 2/2 |
| 6 | 1MBN | 19/19 | 19 | S | 21.4 s | 0 | 1/1 |
| 7 | 1LDG | 27/27 | 26 | S | 56.7 s | 0 | 1/1 |
| 8 | 1TIM | 17/17 | 16 | S | 48.3 s | 0 | — |
| 9 | 1QJ8 | 23/23 | 23 | S | 27.2 s | 0 | — |
| 10 | 1M56 | 48/48 | 47 | S | 75.6 s | 0 | 3/3 |

**215 of 215 side chains, 9 of 9 cofactors, rank S everywhere, and not one wall contact on any fold.**
Two of the 215 resist a perfect pass by the oracle's control law, none by geometry. The oracle eases off
for a crossing it cannot otherwise make, which is what a perfect player does and what makes this a
benchmark for "flawless" rather than "flat out"; it also raised perfects on five folds.

Camera never inside the drawn structure on any fold. View rotation capped at 65 °/s of path turn, roll at
45 °/s, camera step at roughly the craft's own. No collision anywhere on a run with no input.

And what an ordinary player gets (`window.CASUAL=1`): **A**, or **B** on 1LDG. A sloppy one: **B/C**.
No input at all: **D**. See "What an ordinary player actually gets" below.

## Whole-campaign checks worth running before any release
Per-fold metrics missed two player-facing bugs in a row (an unreachable top rank, and every fold opening
with the ship in the corner). Both only show in a sweep:
- Oracle every fold and read the RANK, not just the collection count. A flawless run must score S.
- Chain all ten in one run: **`bash tools/chain_eval.sh`** (it prints a table and PASS/FAIL; set
  `CHAIN_SECONDS` to change the budget). The whole campaign finishes clean, no error, 214 of 215 side
  chains, 589,800 points over 6.6 minutes of autopilot, ranks spread S/A/B. The single drop is 1QJ8 —
  the only fold the autopilot misses on, and the reason it now sits 9th rather than 2nd.
  Three traps in writing that harness, each of which fooled me once. The eval is flattened to one line,
  so a line comment silently swallows the whole script. The two branches must be `else if`, or advancing
  off the ninth fold and logging the tenth happen in the SAME frame and the tenth row carries the ninth
  fold's data. And `done` does NOT go false when the next fold loads — the preview orbit holds it true
  with `t` frozen at the finished fold's time, so the harness must wait until it observes `done` false
  again; without that it walks all ten folds in ten frames and reports the bundle's numbers under all ten
  names. Gating on the fold id changing does not help, because the id changes on the very next frame.
  The wrapper exists because the comment can only be stripped by a real parser: a sed line range stops
  early, since any text describing the strip contains a block terminator.
- Fly each fold with NO input at all and count `status.wall`: a route that collides on its own is broken.
- Screenshot the first half second, not just mid-run.

## Diagnostics available
- `window.CLIPCHK=1` — per-frame signed distance from craft and camera to the ribbon SURFACE
  (uses the drawn mesh and its normals). Negative means inside geometry. Slow: dev only, small folds.
- `window.CLEARCHK=1` — closest approach to any Cα.
- `window.ORACLE=true` — human-limited perfect player, the practical fairness test.
- `window.LAZY=r` — mindless circling at radius r, the low-effort baseline.
- `flyerAction('lanes')` with no input — the parked-at-centre baseline.
- `--audit` on headless_run.py — per-target reachability dump.
- `status.wall` — every wall contact, with the residue, the craft's lateral position and the boundary it
  met. Run a fold with NO input at all (no autopilot, no oracle): a route that collides with the player
  doing nothing is a broken route, and this is how to see it.
- `window.railLim()` — walks the rail and reports every node where the playable corridor is narrower
  than the craft. Should be zero everywhere.
- `status.slowMin` (oracle runs, after t=3 s) — the slowest the craft ever gets. If this drops near
  3 Å/s the corner brake is stopping the game rather than easing it.
- `status.aimLog` with `window.AIMLOG=1` — the aim point, the craft's actual position and the stem
  distance at the instant each side chain is caught. This is what showed 1TIM 48 being caught at
  3.7 Å/s, which is how the compounding speed floor was found.
- `window.railScan(deg)` — walks the finished rail and lists every place its tangent turns faster than
  that, in degrees per Å. This is how 1QJ8's hairpin kinks were found. `window.RAILOPT = {...}` overrides
  the rail build options for a run, for testing them without editing the file.
- `window.RAWSTEP=1` — the camera step the fit WANTS each frame, before the step limiter clamps it, as
  `[t, Å, s]` for the first 2.2 s. This is the one that finds start-of-fold bumps: `BUMPLOG` reads the
  step after clamping, so a camera pinned at its budget for ten frames looks perfectly smooth there.
- `window.OPENLOG=1` — `[t, speed, x, y, camStep, shake, bank, pitch]` for the first 2.2 s, to separate a
  camera artefact from a physics one. Uses its own `P.openPrev`; do not read `P.camPrevPos` here, it has
  already been overwritten this frame.
- `window.BUMPLOG=1` — per-frame camera step in Å, with speed, shake, and the fit's parameters. Sort by
  the step column: anything much over the craft's own step (speed × dt) is a lurch the player will feel.
- `offScreenLive/frameN` — how often the craft is off the frame WHILE a side chain is in play (within
  −1.5 to +5 Å). This is the number that decides whether off-screen time actually costs anything, and it
  is much smaller than the raw figure: 0.00 % on 1QJ8 (which has the most off-screen time of any fold),
  0.13 % on 1M56, 0.48 % on 1LDG, 1.12 % on 1MBN at worst. The corridor fit's framing cost lands on empty
  transit stretches, not on collections. Do not trade geometry back for framing on the raw number alone.
- `offScreenN/frameN` — how often the craft is genuinely OUTSIDE the frame, tested against the frustum
  rectangle rather than a cone. This is the metric to trade the corridor fit against; `off22` below is
  only an upper bound. Note `cam.up` is lerped and is not exactly perpendicular to the view axis, so the
  test orthogonalises it first — without that the vertical check is wrong and 1AEP read 7.8 % when the
  true figure was 1.2 %.
- `off22/off28/off35` in every headless run — the percentage of frames the craft spends beyond that many
  degrees off the view axis. The horizontal half-field on a portrait phone is about 22°, so `off22` is
  the upper bound on how often the craft can be off-screen: 0.3 % on the bundle, 4.3 % on 1QJ8.
- `status.offWorst` and `status.offTrace` — the worst moment the craft spent off the view axis, with the
  residue, the trench flag, the speed and the lateral position, plus every frame over 40°. This is how
  the 1QJ8 excursion was localised.
- `status.nearMiss` — every side chain that was collected but not perfected, with how close the pass
  actually came. Run the oracle and read it: a perfect player should leave almost none.
- `window.obstacleReach()` — counts obstacle blocks and how many can actually be touched from inside the
  slot the craft may fly in. Currently zero on every fold; see the open decision above.
- `camRollMean/P95/Max` in every headless run — how fast the HORIZON rotates about the view axis. This
  is the component that actually makes people ill, and nothing measured it until now. It is computed by
  carrying the previous up vector into the new frame, so a change of view direction does not read as roll.
- `camOffMean/P95/Max` in every headless run — how far off the view axis the craft actually sits, in
  degrees. It is the check on any change to the keep-in-frame clamp: 12–13° mean, 19–21° at p95.
- `railTurnMean/P95/Max` in every headless run — how fast the RAIL turns, alongside `camTurn*` for the
  lens. Measured on every fold, the lens rate sits just under the path rate, so the camera smoothing is
  already doing its job and any rotation left is the path's.
- `window.CAMTRACE=1` (with CLIPCHK) — per-sample `[residue, camera clearance Å]` trace.
- `ribbonClear(p)` — unsigned distance from a point to the drawn ribbon strips. Penetration is not the
  measure that matters for the camera: a helix ribbon is 0.4 Å thick, so a lens 0.1 Å OUTSIDE its face
  still fills the entire screen with flat orange.
- `node tools/phone_test.js` now waits for the craft to reach cruise before timing boost and brake. It
  used to measure whenever the clock said to, so a clipped side chain earlier in the run left the craft
  below the 8 Å/s brake floor and the brake check read as broken when nothing was.

## Measuring penetration — use `ribbonPenetration`, not `surfaceDist`
`surfaceDist` finds the nearest ribbon vertex and takes the sign from its normal. That sign is
**wrong in enclosed spaces**: between two sheets of a barrel it reported 2.8 Å "inside" where
there was open air. Every alarming number from it (1–4 % of frames, 0.8 Å deep) was inflated.
`ribbonPenetration` solves the ribbon's own profile analytically (coil 0.6 Å tube, helix
1.1 × 0.2, strand 2.35 × 0.2) and cannot lie about the sign. Trust that one.

## Ruled out
- **Corridor too wide.** Fitting the corridor to `surfaceDist` starved the maps (autopilot 0/16 on
  1TIM). Reverted; `fitCorridorToSurface` is left in the file, unused, with the grid still built.
- **Holding the flip until the craft is past.** Backwards: it parked the side chain in the craft's path
  for the whole pass. Reversed — the swing now accelerates 3.5× out of the grab — and the worst clip on
  the bundle went 0.26 → 0.15 Å, frames clipped 3.3 % → 1.9 %.
- **Moving the camera to dodge the ribbon.** Tried a seat that slid forward along the rail and then drew
  in towards the craft, searched per frame with a 0.2 s look-ahead. It cannot work: at a hairpin every
  seat from the full trail down to the craft's own position is equally tight, so the search either
  stopped at a seat that was still blind or buried the lens inside the ship. It also whipped the view at
  300 °/s until the aim was decoupled from the seat. Reverted in full.

## Fixed
- **A wall on the lens.** At every hairpin on the bundle (residues 40, 55, 92, 105) and over long
  stretches of 1AEP (19–26, 59–65, 82–94, 120–128) the neighbouring ribbon passed within 0.1 Å of the
  camera and filled the whole screen with one flat colour: no craft, no tunnel, no side chains. The
  ribbon is now drawn twice. The first pass cuts away everything inside `NEAR_SOLID` (3.4 Å, or 1.2 Å
  over a sheet, where the lens rides ~2 Å above the deck on purpose); the second draws only that near
  shell, blended and faded to nothing at 0.6 Å. Near geometry melts away instead of blocking the view.
  Nothing moves, so camera turn rate is untouched (bundle: mean 26, p95 73, max 89 °/s).
- **Dithered dissolve, the first attempt at the same thing.** Rejected: it is worst exactly where it
  matters, because a large surface half-dissolved is television static. 1AEP was full of it — grey
  coil at mid-band turned the top half of the screen to snow. The two-pass blend has no such middle.
- **Side chains take a hard cut at 1.8 Å, not a fade.** Both a dissolve and a blend are wrong for them:
  they are small and saturated, so a half-transparent one on the lens veils the entire view in its own
  colour (a red glutamate over the whole sky on 1QJ8). Cut outright, they simply are not there.
- **The lens's cross-section offset is fitted to the real surface.** This is the standing top issue, and
  it finally moved. The measurement that unlocked it: on the frames where the lens is inside the ribbon,
  the CRAFT beside it has 1.1–1.3 Å of daylight on average. So the trail length was never the problem
  (sliding along it buys nothing) and neither was the corridor radius (a gameplay number, not a
  clearance). What was wrong is where in the cross-section the lens sits — 0.7 Å above the rail,
  unconditionally, whatever happens to be there. The offset now swings around the tangent to a direction
  with room, and shortens if no direction has any, searched per frame and only when the nominal seat
  fails. The aim comes from the nominal seat, so swinging the lens never steers the view.

  | fold | tight frames before | after | deepest before | after |
  |---|---|---|---|---|
  | 1M56 | 161/1446 | 91 | −0.28 Å | −0.02 |
  | 1LDG | 161/1078 | 105 | −0.37 | −0.23 |
  | 1MBN | 28/395 | 11 | 0 | 0 |
  | 1AEP | 30/338 | 13 | 0 | −0.04 |
  | 1TIM | 66/891 | 52 | −0.39 | −0.09 |
  | 2ABD | 30/240 | 26 | −0.47 | −0.26 |

  Occlusion of the craft falls with it (1LDG 54 → 34 frames, 1M56 27 → 18). Turn rates are unchanged.
- **A perfect pass is judged on the path, not on the frames.** The distance to a side chain's stem was
  sampled once per frame. At 20 Å/s the craft moves 0.33 Å between frames, so a pass straight through
  the middle could read as 0.45 Å out and be denied its perfect purely by where the frames happened to
  fall — and the verdict changed with the frame rate, which is not something scoring should ever do. It
  now takes the true closest approach between the frame's travel segment and the stem segment. The
  oracle gains two perfects on 1M56 (44 → 46 of 48).
- **The keep-in-frame clamp leads the craft.** It used to aim at where the craft was, so it only ever
  acted on the one frame where the craft reached the edge of its 25° cone, and the swing that took was
  the single biggest jolt in the game — bigger than anything the path itself does. It now aims 0.22 s
  ahead and its rate cap drops 260 → 150 °/s. Peak view rotation: 1LDG 339 → 255, 1TIM 337 → 213,
  1M56 371 → 145, 1QJ8 404 → 294. The craft sits at most 3° further off axis for it.
- **The wall you collided with was invisible, and usually nowhere near anything.** Logging, at every wall
  contact, the distance from the craft to the nearest DRAWN surface settled it: across four folds
  **78–98 % of contacts happened with nothing within 0.5 Å**, median gap 0.7–0.9 Å, and on the sheet map
  3.0 Å. One contact on the bundle stopped the craft with the nearest geometry 5.71 Å away — open space in
  every direction. The corridor is an abstract tube built to guarantee side chains are reachable; its
  radius runs from 0.3 to 2.45 Å along a fold with no visual cue whatsoever. Every earlier fix made that
  collision *feel* better; none made it make sense.
  Two changes, together. The boundary now opens outward to wherever the drawn surface actually is, up to
  `WALL_GIVE` (1.0 Å), marched per frame only when the craft is pressed against it — it can only widen,
  never shrink, so every aim point stays exactly as reachable. And a stop only counts as a collision, with
  its shake and beep and speed loss, when a drawn surface is within `WALL_SEEN` (0.5 Å); otherwise the
  craft simply stops, silently. Measured on the same steered run:

  | fold | collisions before | after | median gap to visible geometry, after |
  |---|---|---|---|
  | bundle | 45 | 1 | 0.28 Å |
  | 1LDG | 40 | 6 | 0.38 |
  | 1M56 | 37 | 3 | 0.41 |
  | 1QJ8 | 15 | 1 | 0.27 |

  Every remaining collision is a genuine scrape against something on screen. Craft-into-geometry did not
  get worse for it: 1M56 −0.30 → −0.07, the bundle unchanged at 0, and 1LDG's −0.48 is identical before
  and after (it is intended contact with a collected side chain, not the wall).
- **Every fold now opens with a rotating preview of the structure**, so you can see where you are about
  to race. `PREVIEW_T` 3.2 s of slow orbit around the whole fold, framed to its bounding sphere, then
  `PREVIEW_BLEND` 0.7 s easing into exactly the pose the flight camera starts from — `flightStartPose()`
  computes that pose, because the flight code ASSIGNS the camera rather than smoothing it, so blending to
  anything else is a visible cut. Measured across the hand-over: first flight frame moves 0.00 Å.
  Any key, tap or click skips it. Two things it needed that were not obvious: the flight fog ends at 60 Å
  and the preview sits further out than that, so the fog is pushed back while it runs or the structure is
  invisible; and finger input must be ignored (not just skipped) during the preview, because the update
  is frozen and a lunge started there would stick.
  Cost to the harness: +4 s on every acceptance budget (frames, not run time — `P.t` does not advance
  during the preview, so times, pars and ranks are untouched).
- **The bundle punished you for touching the controls.** Reported as an initial collision in the first
  seconds, and it was a real wall hit, not a visual artefact — my earlier sweeps missed it because they
  ran with no input or on autopilot, neither of which steers into anything early. With a player-like
  input the craft hits the wall at **t = 0.80 s**, complete with shake, beep and speed loss, and again at
  1.2 s. The bundle's corridor is a constant 1.45 Å and lateral acceleration carries the craft there in
  about a third of a second, while the first side chain does not arrive until 1.0 s. So the first thing
  the game does to a new player testing the controls is punish them, before it has taught anything.
  `WALL_GRACE` (1.6 s) now suppresses the penalty at the start of every fold. The wall still stops the
  craft — held hard left through the whole grace period it reaches 1.45 Å and no further — it just does
  not shake, beep or cost speed. First contact on the bundle moves from 0.80 s to 2.42 s, after the
  opening side chains.
  The lesson for the harness: **no-input and autopilot runs cannot find control-response bugs.** Use
  `--keys "left:0.5-1.5,right:2-3"` and `window.HUNT=1`, which logs every frame carrying a shake, a
  speed drop, a field-of-view kick or a camera jump.
- **The bundle lurched in its first second.** Reported as "a huge bump animation in the first few
  seconds". `window.BUMPLOG=1` logs the camera's step per frame, and it showed the lens moving **0.89 Å
  in one frame** at t=0.63, then 0.72 Å, against a normal step of 0.19 Å at that speed. The corridor fit
  was swinging the seat 140° in two frames, right as the camera crossed the rail's start.
  Two causes, both fixed. The fit was running against the extrapolated pre-start region, where the rail
  frame is frozen at node 0, so its answer went stale the instant the camera entered real nodes; it now
  waits until the lens is past the start. And there was no limit on how far the lens could move in a
  frame — the 70°/frame catch-up was bounded in ANGLE, which says nothing about distance. There is now a
  step budget tied to the craft's own step, and it is the backstop for any future cause as well.
  Largest camera step over a whole run, measured on all ten folds: 0.41–0.46 Å, and not one frame over
  0.5 Å on any of them (132,000 frames). Note `BUMPLOG` lives in `update()`, so these runs do NOT need
  `--draw-all` — using it takes the big folds from 30 seconds to many minutes for no extra information. The cost is 2–6 extra tight frames per fold and 1LDG's deepest
  reading going 0 → −0.03 Å, which is nothing you can see and is covered by the near-fade.
- **Every other effect audited for the same two bugs, and they are clean.** The impact shake had both an
  arbitrary starting phase and, historically, per-frame rates; so did the lost-craft arrow. Swept the
  whole file for `sin(absolute time)` and for rates missing `dt`. The four remaining absolute-time sines
  are all continuous ambient effects (the side-chain pulse, the pulse running up the trench, the arrow's
  blink, the dev circling) where an arbitrary phase is correct, and every decay uses `dt`. Nothing else
  to fix.
- **The impact shake snapped, then buzzed.** Reported as "odd shakes once it hit something", and it was
  not the collision detection — the contacts are genuine wall touches and they are rare (zero on an
  untouched run, zero to five for autopilot over a whole fold). The feedback was the problem, and the
  measurement is stark: logging the hull's bank offset frame by frame, the very first frame of a contact
  jumped to **+0.0608 rad** — 3.5° in one frame with no motion leading into it. Both the hull judder and
  the camera kick were driven by `sin(absolute time)`, so the phase at the moment of impact was arbitrary
  and usually not zero. On top of that the frequencies were 10 and 13 Hz, which is a vibration rather
  than a knock.
  Phase now runs from the impact, so the first frame is exactly 0.0000, and the direction is away from
  the wall that was touched. 4 Hz for the hull, damping with the shake: 0 → −0.042 rad over 0.05 s, back
  through zero at 0.13 s, second swing a third the size, gone in about 0.4 s. `window.JUDLOG=1` logs it.
- **The lost-craft arrow lived in the draw path.** Whether the craft is off the frame, and the arrow's
  fade, were computed inside `draw()`. In a browser that is every frame so players saw it correctly, but
  it was state in the wrong place: it never advanced on a frame that was not drawn, which is why it could
  never be seen in a headless screenshot, and its fade was per-frame rather than per-second — twice as
  fast on a 120 Hz phone as on a 60 Hz one. Moved into `update()`, reusing the frustum test already there,
  with a time-based ramp. Same class of bug as the frame-sampled perfect pass.
- **Two phone checks were testing the geometry, not the control.** "Finger held right keeps the craft
  right" asserted an absolute 0.9 Å. How far right a held finger gets you is capped by the finger's reach
  AND by however wide the corridor is at that moment, and both vary through a fold, so the check passed or
  failed by luck — and it sampled at 400 ms, while the craft is still accelerating. It now waits for the
  craft to arrive and asserts what "following" actually means: it goes right, and it stays there rather
  than snapping back. Four consecutive runs land on 1.11–1.25 Å.
- **The dead hazard system is gone.** The game carried a complete obstacle mechanic that nothing ever
  created an obstacle for: collision detection, invulnerability frames, a speed and combo penalty, a red
  damage vignette, a near-miss bonus, a hit counter in the HUD and on the finish card, and a term in the
  rank. `blocks.push` only ever pushed `type: 'H'`, on every fold, in every copy of the file checked.
  You could not be hit anywhere, however badly you flew. Removed in full, about 60 lines, along with
  `planLateral` (which searched for a lateral line clear of obstacles and therefore returned its input
  unchanged every single frame) and the obstacle-clearance tests in the aim search and in `pruneUnfair`.
  The interface no longer shows a counter that can only ever read zero: the HUD says "fixed · missed" and
  the finish card says "side chains missed". Acceptance no longer carries a per-fold hit ceiling.
  Nothing changed in play — all ten folds finish with the same counts, ranks, camera and roll figures.
  If hazards are wanted later, the material is the trench side chains that are currently dropped for
  being unreachable: 49 of them on 1QJ8 against 23 kept, 19 on 1LDG, 16 on 1TIM.
- **The horizon had no rate limit, and it was the worst motion in the game.** The view direction has had
  a slew cap since early on; roll never had one, and roll is the component that makes people ill. 1BCF —
  the fold I had called flawless on every other measure — rolled at 131 °/s at the 95th percentile and
  190 at peak, with the craft flying straight. 1M56 peaked at 349. The cause is the up vector's basis:
  outside a trench it blends 70 % toward world up, and that blend collapses as the flight direction
  approaches vertical, snapping the horizon onto the rail frame. Rather than chase the blend, the roll
  rate is now capped at 45 °/s, and frames before and after are pixel-identical — the horizon still ends
  up where it should, it just gets there without whipping.

  | fold | roll p95 before | after | peak before | after |
  |---|---|---|---|---|
  | 1BCF | 131 °/s | 45 | 190 | 45 |
  | 1LDG | 88 | 45 | 160 | 45 |
  | 1QJ8 | 65 | 45 | 126 | 45 |
  | 1M56 | 53 | 45 | 349 | 45 |

  This is the third comfort lever after the speed cap on sharp turns and the keep-in-frame clamp, and the
  only one that cost nothing at all: no time, no framing, no completion.
- **Every fold opened with the ship filling the corner of the screen.** `rail.nodeAt` clamped to node 0
  for any position before the start, so for the first half second — while the craft is still near s=0 —
  the camera's seat, which trails several Å behind, landed exactly ON the craft. It now extrapolates
  backwards along the first node's tangent instead, giving the opening shot a proper trail. The first
  frame of a run is now an establishing view down the tunnel. It also takes the bundle and 1BCF to
  0.00 % of frames with the craft off the frame; those runs' only off-screen frames were the opening.
- **The top rank was unreachable on seven of ten folds.** A flawless run — everything collected, every
  side chain perfected, nothing hit — was scoring A, not S, on 1AEP, 256B, 2ABD, 1MBN, 1LDG, 1TIM and
  1M56. The rank's time gate compared against a flat par of 18 Å/s, and the corner brake and the
  view-rotation cap (both added during this session) slow the craft wherever the rail bends, so that par
  simply cannot be met on a convoluted fold. My regression, and one no measurement I was watching would
  have caught — it only shows if you look at the rank a perfect player gets.
  Par is now integrated along the rail from the speed the game will actually allow at each point, so it
  tracks the level's own geometry. The multiplier drops from 1.25× to 1.0× at the same time, because the
  new par is the ideal line and collecting side chains and holding a combo both beat it. The spread is
  now: flawless and brisk → S on all ten; complete but slow (autopilot, a fixed 15 Å/s) → A; collect
  nothing → D. Check it with `window.flyerPar()` and an oracle run.
- **The collect animation is back to its original form, and should stay there.** Two changes made to it
  during this session were both wrong and are both reverted:
  *Rushing the grab 3.5×.* Done to cut a measured 0.1 Å overlap between the hull and a side chain it had
  just collected. It turns the knock into a twitch. The overlap is worth nothing: `intendedWorst` is 0 on
  every fold, meaning the craft never penetrates a target it has NOT yet collected, so all of it is the
  contact the mechanic is built on.
  *Removing the compress-on-impact.* The chain shortening by 0.25 Å over the grab before it springs is
  the weight of the hit. Taking it out on the theory that "collecting is not a crash" left the animation
  limp. Both restored; the overlap measurement goes back to 0.25 Å on the bundle and that is correct.
  **Do not trade this animation for a penetration number again.**
  What did survive: a side chain's aim point sits near the corridor edge, so reaching one often touches
  the boundary at the same instant it is collected, and the hull then juddered as if hit. For a moment
  after a pickup the boundary still stops the craft, but silently. That removes a false cue rather than a
  real one.
  Ruled out as a cause while chasing this: the near-cut on side chains (1.8 Å) does not touch the
  collect — frames compared with it on and off are identical.
- **Collisions that were built into the route.** Flying a fold with no input at all — not parked by an
  autopilot, simply untouched — still rang the wall: 4 contacts on 1QJ8, 1 on 1LDG, 1 on 1M56. Two
  separate causes.
  *The corridor closes below the hull.* `lim` is the corridor radius minus a 0.55 Å safety margin, and
  on a handful of nodes the margin eats the whole corridor: 1LDG 32–33 and 1M56 48–49 leave 0.10–0.22 Å
  for a craft of 0.24. The ship does not fit, so those residues scrape whatever anyone does. The limit
  is now floored at the hull radius plus a hair.
  *A graze fired the full impact.* Any outward motion at the boundary bounced at 2.4×, beeped and cost
  speed. The corridor's own pinch points therefore rang the collision 11–16 times a run on 1M56 with
  nothing done wrong. Contact now needs 2.5 Å/s of outward speed to count; below that the craft simply
  sheds its outward drift, silently.
  Untouched runs are now clean on every map tested, and the oracle's contacts fall from 16 to 0 on 1M56.
  The contacts autopilot still takes are it genuinely steering into things, which is the point.
- **The wall shook, not the ship.** A hit jittered the CAMERA by up to ±0.25 Å of white noise. The world
  is what fills the screen, so that reads as the scenery vibrating — exactly backwards. The camera now
  takes a small directional kick away from the wall it touched, decaying, and the impact is carried by
  the craft: the hull rolls and pitches for as long as the shake lasts.
- **The fit's own smoothing was most of what was left.** The seat is smoothed toward the searched one,
  and the path between two clear seats need not itself be clear — so on the frames that mattered the
  lens was sitting in a wall that neither the seat it came from nor the seat it was going to occupied.
  When the smoothed seat is blocked, it now hurries toward the searched one at up to 70° of swing in a
  frame instead of its usual rate. This closes the standing top issue.

  | fold | tight frames before | after | deepest before | after |
  |---|---|---|---|---|
  | 1LDG | 56 | 16 | −0.29 Å | 0 |
  | 1M56 | 52 | 15 | 0 | 0 |
  | 1TIM | 22 | 5 | −0.06 | 0 |
  | 1QJ8 | 12 | 2 | 0 | 0 |
  | 256B | 8 | 5 | 0 | 0 |
  | bundle | 7 | 2 | 0 | 0 |

  **All ten folds are now at zero: the camera is never inside the drawn structure anywhere in the
  campaign.** A full snap does slightly better on the counts (1LDG 2 frames) but moves the lens up to
  1.66 Å in one frame, which throws the craft twenty degrees across the screen; the capped version keeps
  the mean jump at 0.34 Å and the worst at 1.02, and reaches zero depth just the same. Comfort wins the
  tie. The cost is that the craft is off the frame a little more often, under 4 % everywhere, and the
  edge arrow covers it.
- **The corridor fit searches finer.** Twenty offset directions instead of fourteen, four lengths
  instead of three. The cost is paid only on the ~10 % of frames where the nominal seat fails. 1M56 joins
  the maps where the lens is never inside geometry at all, and the craft spends far less time off the
  frame on the shorter folds (256B 1.96 → 0.46 %, bundle 0.38 → 0.19 %). Eight of the ten folds are now
  at zero; 1LDG (−0.29 Å) and 1TIM (−0.06 Å) are what is left.
- **The phone boost check measures the peak of the hold, not its end.** The corner brake cuts the boost
  as well as the cruise, so a bend arriving mid-window read as "the boost does nothing" when it plainly
  worked. It also waits for a straight stretch before starting. Four consecutive runs now land within
  0.2 Å/s of each other; before, one run in three failed.
- **The rail's curvature limiter is on, at 70 °/Å.** It was disabled as "measured worse". Re-measured,
  it is close to neutral on nine folds (times identical, view rotation identical, tight frames moving by
  ±3) and a clear gain on the one that needed it. **Correction to an earlier note that called it simply
  neutral: it is not free.** It costs 1TIM one perfect for the oracle (16 → 15 of 17; residue 133 joins
  residue 48 just outside the band) and gains 1QJ8 one side chain and one perfect (21 of 22 → 22 of 23).
  Net positive, and the loss is on a measure sensitive to the oracle's control law rather than the level,
  but it should not have been reported as costless — the metrics I checked at the time did not include
  perfect counts. The gain on the map that needed it: 1QJ8 spends a third less time with
  the craft off the frame (4.85 → 3.31 %) and one more side chain becomes reachable, so the map has 23
  collectables instead of 22. Note what it does NOT do: the worst kinks barely move (142 → 139 °/Å). It
  is earning its keep on the many medium bends, not the extreme ones.
- **The corner brake reads the sharpest local turn, not an average.** It measured the bend over 3 Å,
  which averages a kink away and lets the craft arrive at full speed into a corner. It now takes the
  worse of a 1 Å and a 3 Å window. The craft spends less time off the frame (256B 3.35 → 1.96 %,
  1LDG 1.69 → 1.31 %) for about 4 % more time on the long folds.
- **The corridor fit searches two more dimensions.** Rotating the lens's offset around the tangent runs
  out of directions in an enclosed pocket. It may now also come up to 0.6 Å forward along the rail while
  it swings, and when nothing clears at all it takes the roomiest seat it has seen instead of blindly
  shrinking to a quarter. Neither dimension works alone: sliding along the rail on its own was measured
  and buys nothing. Tight lens frames roughly halve again on top of the previous fit.

  | fold | tight before | after | deepest before | after |
  |---|---|---|---|---|
  | 1LDG | 97 | 54 | −0.26 Å | −0.29 |
  | 1M56 | 96 | 59 | −0.04 | −0.14 |
  | 1TIM | 52 | 22 | −0.04 | −0.07 |
  | 256B | 20 | 9 | −0.16 | 0 |
  | 1AEP | 13 | 6 | −0.04 | 0 |

  The cost is that the craft spends more time outside the frame, roughly doubling from a low base and
  staying under 3.4 % everywhere. That is the trade taken deliberately: flying through the structure was
  the complaint, and a craft off the frame now has an arrow pointing at it.
- **A bug in the cone clamp leaked the fit into the view.** It took its direction from the real lens
  rather than the nominal seat, so every time the fit moved the camera it also steered the aim. That is
  what pushed 256B's peak view rotation from 88 to 148 °/s. Fixed, and the rates went straight back.
- **The corner brake no longer stops the game.** `OMEGA_MAX`'s speed floor was a fraction of `cruise`,
  which the older corner brake has already cut to a third — so the two compounded and 1TIM crawled to
  3.7 Å/s at one kink. The floor now comes off the unreduced cruise. The slowest the craft ever gets
  goes 3.0–3.2 → 4.7–5.4 Å/s, and the oracle's run times drop 6–9 % (1TIM 49.8 → 45.7 s, 1LDG 59.7 →
  54.2, 1M56 77.8 → 73.6). The cost is about 3 °/s on the mean view rotation of the most convoluted
  maps, which is still well below where they sat before `OMEGA_MAX` existed.
- **A sharper oracle.** Its steering time constant was a fixed 0.1 s, which left it arriving a few
  hundredths of an angstrom off and dropping perfects it should have had. It now tightens as the side
  chain comes up, with the acceleration still clamped to the human limit so the line stays feasible.
- **An edge arrow when the craft leaves the screen.** At a sheet hairpin the geometry carries the craft
  clean off the frame for about a third of a second and nothing can follow it — the two clamp settings
  that try are both worse than the problem (see below). The heads-up display now points at it from the
  screen edge, fading in over about a tenth of a second and out again, so the player always has a
  heading. It fires only when the craft is genuinely outside the frame, never when it is merely near
  the edge, and it reads the craft's direction from the lens rather than its projection, which is what
  keeps it correct when the craft is behind the camera and a projection would mirror it.
- **The craft is always findable.** A silhouette of the glider is painted through whatever is in front
  of it, at 0.45 alpha and unlit, drawn before the solid craft and from the same geometry — so wherever
  the ship is genuinely visible the solid pass covers it exactly and nothing looks doubled. In a tight
  fold the ribbon comes between the lens and the ship and the player simply loses it: 1MBN residues
  82–85 were six samples running with the lens inside geometry and no ship on screen.
- **The craft eases off through sharp turns.** `OMEGA_MAX` (65 °/s) caps how fast the path may rotate
  the view, by limiting speed on the local turn. The existing corner brake averages the bend over 8 Å,
  so a short sharp kink slipped straight through it; the cap reads the turn over 3 Å instead. Peak view
  rotation drops across the campaign (1BCF 129 → 100 °/s at p95, bundle 91 → 74, 256B's rail max 255 →
  191) and the mean falls a few degrees. It costs about 10 % completion time on the most convoluted
  folds, so 1LDG's acceptance budget went 70 → 88 s.
- **The near shell is squared off and starts at 0.9 Å.** When the lens is *inside* a coil the surface
  surrounds it, so every direction is in the band at once and a gentle ramp washes the whole screen
  milky — 2ABD residue 36 was a grey fog with the ship floating in it. Squaring the ramp and starting
  the band at 0.9 Å clears it while leaving the 2.2 Å end, and so the wall cases, untouched.
- **The near band is 2.2 Å, not 3.4.** At 3.4 Å enough layers of a tight coil fall inside the shell that
  the unsorted blend turns into translucent shards — 256B residue 48 was a starburst. 2.2 Å holds the
  win on every frame that needed it and has at most one layer to blend.
- **The two passes are drawn only when something is actually near.** One clearance test per frame says
  whether any ribbon is inside the band; almost always nothing is, and the ribbon is then drawn exactly
  once, as before. Doubling the largest mesh in the scene every frame was costing phone frame rate.

## Ruled out this round
- **Making the keep-in-frame clamp fiercer when the craft is far out** (rate graded from 150 up to
  450 °/s with the excess angle). It does pull 1QJ8's worst excursion in from 95° to 69°, but the craft
  is still off-screen at 69° and the peak view rotation doubles to 592 °/s. A whip that violent is worse
  than the half-second it fixes. Reverted.
- **Knocking the side chain further out of the craft on impact** (the impact compression from 0.25 to
  0.5 Å). It helps 1M56 (worst overlap 0.12 → 0.07 Å) and hurts the bundle (0.15 → 0.17) and 1MBN. The
  compression shortens the chain from the tip, but the overlap is at atoms near its base, so it is not
  the lever. Reverted.
- **Four ways of smoothing 1QJ8's hairpin kinks, all ineffective.** Residue-level coil smoothing
  (`coilSmooth` 4 and 10), the loop Hermite blend (`loopBlend` 0.6 and 0.9), summing the ribbon push over
  every overlapping residue instead of taking the deepest one, and the curvature limiter down at 10 °/Å.
  Every one leaves the worst kink between 135 and 152 °/Å. The corner is not a smoothing failure: at a
  β-hairpin the rail has to clear two 2.35 Å slabs that nearly touch, and the only path through turns
  that sharply. The level is the lever, or the speed, and the speed cap and the edge arrow already do
  what they can.
- **Aiming at a stretch of rail instead of one point ahead** (five samples from 0.55 to 1.5 of the look
  distance, weighted to the middle). The theory was that a single look point wiggles with the backbone
  and drags the view with it. Measured on four folds it changes the camera turn rate by one degree per
  second on one map and nothing on the others, so the rotation is not coming from the look target — it
  is the rail itself turning at flight speed. Reverted as dead complexity.
- **Clamping the lens inside the corridor radius.** The craft is held inside a per-node radius `R`, and
  the camera's 0.7 Å of height above the rail was never checked against it, which looked like the whole
  explanation for the lens being in a wall beside a clean craft. Clamping the camera's offset to `R`
  changes nothing on any fold, because `R` is a gameplay radius and not a real clearance — the same
  reason fitting it to the surface starved the maps. Reverted.
- **Ducking the camera forward along the rail when the lens is in geometry**, aim taken from the
  un-ducked seat so the view never whips. Measured on three folds: tight frames went 7 → 10 on the
  bundle, 30 → 25 on 1AEP, 24 → 24 on 256B. It buys nothing because at these places no seat is clear —
  the pocket is tight for the whole trail, not just its far end. Reverted.

## Open issues
1. **The standing top issue is closed.** The camera is never inside the drawn structure on any fold.
   What remains is 0–16 frames per run (of 250–1500 sampled) where it is merely *near* a surface, which
   is what flying inside a fold looks like. The craft itself was never the problem and remains clean.
   The open question is now comfort, not geometry: see 4.
2c. Landscape (1440×900) checked for the first time this round and is healthy: same completion, same
   tight-frame counts, and the craft is off the frame far less than on a phone (0.14–0.63 % against
   1.9–2.4 %), because the wider field simply contains it. The full HUD, colour key and control hints
   lay out correctly.
2b. 1BCF is flawless: 23 of 23 side chains, all perfect, for both autopilot and the oracle; not one
   tight lens frame in 342; 0.07 % of frames with the craft off the frame; and not a single rail kink
   over 60 °/Å. It is the reference for what a good fold looks like here.
2. **Campaign state after this round.** Seven of the ten folds never put the camera inside geometry at
   all (bundle, 1QJ8, 1AEP, 256B, 2ABD, 1BCF, 1MBN); 1BCF has not a single tight frame in 335. What is
   left is 1LDG (54 tight frames in 1022, deepest 0.29 Å), 1M56 (59 in 1410, 0.14 Å) and 1TIM (22 in
   844, 0.07 Å). Every fold is completed in full by both autopilot and the oracle.
3. Second pass over the bundle found it clean: 20/20 perfect for autopilot and the oracle, the lowest
   camera turn rate in the campaign (mean 23 °/s, max 77), 10 tight lens frames in 280.
3. Craft clips already-judged side chains on 1.9 % of sampled frames on the bundle, worst 0.15 Å; 0.6 %
   on 1QJ8, 1.1 % on 1TIM. What is left is the collection contact itself plus the first frames of the
   flip, and it is no longer visible now that near geometry fades out.
   1AEP and 256B are the tight ones: the lens is inside 0.5 Å of the ribbon on 9–10 % of sampled frames,
   against 1.5 % on the bundle. 256B residues 42–51 are the worst stretch in the campaign, and the
   camera is genuinely inside the ribbon there (−0.31 Å) while the craft is not. Autopilot and the
   oracle still clear both maps with no misses.
4. Camera turn rate rises with how convoluted the fold is, and it is the rail's own curvature at flight
   speed — the lens rate measures just under the path rate on every fold. `OMEGA_MAX` now takes the top
   off it. The MEAN is still 40–49 °/s on the convoluted folds and cannot be cut further without
   slowing the cruise, which is settled and liked. Left alone deliberately.
6. ~~A few very large single-frame spikes survive the cap: 404 °/s on 1QJ8, 359 on 1TIM, 371 on 1M56.~~
   **Confirmed and closed, 2026-09-13, and the old hypothesis was wrong.** Re-measured after the camera
   step-budget work: the maxima are down to 294 (1QJ8), 222 (1TIM) and 238 (1M56), and on every fold the
   camera's turn rate sits *below the rail's own*, often far below — 1QJ8's path hits 3719 °/s at its
   hairpins against the lens's 294; 1LDG 888 against 254. So these are curvature, heavily damped, not
   the keep-in-frame rule breaking the comfort cap. Nothing to fix.

   | fold | camTurn mean / p95 / max | railTurn mean / p95 / max |
   |---|---|---|
   | BUNDLE | 32 / 85 / 89 | 41 / 114 / 163 |
   | 1LDG | 61 / 101 / 254 | 78 / 187 / 888 |
   | 1TIM | 58 / 91 / 222 | 75 / 188 / 517 |
   | 1QJ8 | 62 / 234 / 294 | 75 / 213 / 3719 |
   | 1M56 | 52 / 91 / 238 | 65 / 160 / 331 |

   1QJ8's p95 of 234 °/s is the highest in the campaign and is the β-barrel's hairpins. It is left alone:
   it is a fold the player now meets ninth rather than second, and cutting it further means slowing the
   cruise, which is settled.
11. **Can a skilled human max the score?** Very nearly. With the sharper oracle, every side chain in
   the campaign is demonstrably perfectible by a human-feasible line except 1TIM residue 48. Two are
   sensitive to the controller rather than the level: 1QJ8 48 is perfected by a looser time constant
   (0.06 s) and missed by a tighter one, and 1TIM 133 and 1M56 344 go the other way — no single fixed
   setting takes all of them, which is itself the evidence that these are control-law artefacts and
   not unfair geometry. 1TIM 48 resists every setting tried, at 0.39–0.44 Å against a 0.30 Å band,
   even though the static audit gives it a 0.76 Å perfect band. Looked at again: the oracle is caught at
   the far edge of the judging window (1.41 Å of 1.5) at (−1.52, 0.35) while the aim point is at
   (−1.13, 0.52) — it has overshot radially past the 1.45 Å reach limit and is correcting late. The
   level is fine; this is the oracle's line into a hairpin. Closing it as an instrument limit.
12. 1TIM opens inside geometry: at residue 12 the lens is 0.39 Å inside a sheet and the first thing the
   player sees is a featureless green wash with the craft floating in it. The fade is doing its job;
   the corridor at the very start of that map is the problem.
9. **1QJ8's rail has kinks, and that is the root cause on that map.** `railScan` finds tangent turns of
   100–142 °/Å at residues 15, 53, 74, 95, 118 and 133 — the hairpins between strands, one residue
   before every place the craft goes off-screen. At 142 °/Å even a crawl of 5 Å/s still swings the path
   700 °/s, so no speed cap and no camera can follow it: the rail itself is the defect. Re-testing the
   disabled curvature limiter (`curvLimit`, off because it measured worse) at 60–90 °/Å does cut the
   off-screen time from 4.9 % to 3.4 %, but it makes the worst kink worse rather than better and it
   changes the map — one more side chain becomes collectable. Not a playtest-tick change; it needs
   deciding on its own.
   The old note, still true:
9b. 1QJ8 loses the craft off-screen for about a third of a second, three times a run, at sheet hairpins
   (residues 55, 97, 119). Localised: the craft is hard against a trench wall (x ≈ −1.9) and slow, and
   the rail turns through the hairpin faster than any clamp rate worth using can follow. It is
   geometric and it predates every camera change made here — the old 260 °/s clamp reached 90°, the
   current one 95°. Now covered by the edge arrow, which is the honest fix: the view is not dragged
   anywhere, the player is just told where to look. The level itself is still the real lever. The craft
   it misses (res 48) is autopilot being autopilot: the oracle takes all 22 and perfects all 22.
10. 1LDG is the hardest map on the lens: near or inside geometry on 188 of 1078 sampled frames (17 %),
   worst −0.37 Å, and the craft is occluded on 5 % of frames — now covered by the silhouette. The craft
   itself is clean (5 frames in 1078). Both autopilot and the oracle take all 27.
8. 1MBN: the lens is inside geometry on 28 of 395 sampled frames, including residues 82–85 straight
   through. The wash there is mild now and the silhouette keeps the ship visible, but the corridor is
   still the underlying problem. Both autopilot and the oracle take all 19 perfectly.
7. 1BCF is the cleanest map in the campaign: the lens is never inside geometry (closest approach
   0.48 Å), one tight frame in 326, and the oracle takes all 23 side chains perfectly.
5. 2ABD is the worst map for the lens being inside geometry: 29 of 231 sampled frames, −0.47 Å at its
   worst, and residues 61–67 have the camera buried for eight samples running. The craft is clean over
   the same stretch, and both autopilot and the oracle clear the map 8/8.
2. `ribbonClear` reports 0 Å for every camera seat at the bundle's hairpins, including the craft's own
   position. Either the corridor really has no daylight there or the measure's per-residue boxes (3.8 Å
   long on the raw Cα tangent) fan out at a 180° turn and report phantom geometry. Worth settling before
   anyone tries to fit the corridor again.
3. True backbone-only penetration is 0–0.1 Å, i.e. essentially clean. The visible problem was never the
   ribbon being entered, only its being too close to the lens.

## The first-second bump on map 1 (reported, fixed)

"First map, first second the ship has a small bump without steering." With no input at all the craft's
`x`, `y` stayed at 0 and `shake` was 0 throughout, so this was purely the lens, not physics.

`RAWSTEP` on the bundle: the camera wanted to move **1.374 Å in one frame at t = 0.667** against a normal
step of 0.19, then sat **pinned at the limiter's 0.37 Å budget for ten straight frames**. That plateau —
about 3.7 Å of camera travel in 0.17 s — is what the player feels. `BUMPLOG` could never have found it,
because after the clamp every one of those frames reads as a clean 0.37.

Ruled out along the way: the fit's activation gate at `s = CB` (ramping its authority in over 0.5 s
changed the peak 1.374 → 1.316, i.e. nothing); `CB` itself being dynamic (pinning it with `DEBUG_CAM`
changed nothing); and physics (`NOFIT=1` alone dropped the peak to 0.258).

The cause was the snap branch. It limits the hurry in PARAMETER space — 70° of rotation, ±0.3 of scale,
±1.2 Å of trail per frame — but 70° of swing about the tangent moves the seat by up to twice the offset
length. Logged, it snapped **-1° → -71° → -146° on two consecutive frames** as the lens entered the first
helix. Worse, only the resulting POSITION was clamped afterwards, while `camRot/camSc/camBk` kept the
values it had committed to, so the lens then had to chase its own state for ten frames.

Fixed by budgeting the hurry in the currency that matters — how far it actually slides the seat
(`FIT_SNAP_STEP = 0.3 Å`, a ladder of 1 / 0.6 / 0.35 / 0.2 / 0.12 on the deltas) — so state and seat stay
together and the limiter never has to pin. The fit is also no longer gated on `P.s > A(CB)`; it converges
during the run-in instead of arriving with an accumulated correction to dump.

| | before | after |
|---|---|---|
| bundle peak wanted camera step, first 2.2 s | 1.374 Å | 0.484 Å |
| frames pinned at the limiter | 10 | 0 |
| largest single snap, any fold | 0.87–0.99 Å | 0.30 Å |

Camera penetration is unchanged: `camIn` is 0 on nine folds and 1 frame at −0.1 Å on 1TIM, which is
exactly what the pre-change build measures. **A graded budget was tried and reverted** — opening the
budget when clearance is near zero brought the bump straight back (peak 1.068 Å), because at that instant
on the bundle the seat genuinely is against the surface. Clearance cannot separate the two cases.

## Campaign order (changed 2026-09-13)

1QJ8 (OmpX) moved from 2nd to 9th. It is **67% β-sheet and 7% helix**; every other fold in the campaign is
helix-dominant, and the next-highest sheet content is 1LDG and 1TIM at 16–17%. Sitting 2nd, it followed a
tutorial bundle that is 84% helix and 0% sheet with a map that is essentially one long trench run — a
mechanic the player had not yet seen. It is also the only fold the autopilot drops a side chain on
(22/23), the only one with must-slow segments in the fairness check, and the widest reach band by far
(0.99–4.62 Å against 0.98–2.06 Å everywhere else).

The order is now graded by sheet content, so the trench arrives a strand at a time:

| # | fold | helix | sheet |
|---|---|---|---|
| 1 | BUNDLE | 84% | 0% |
| 2 | 1AEP | 87% | 0% |
| 3 | 256B | 90% | 0% |
| 4 | 2ABD | 69% | 3% |
| 5 | 1BCF | 85% | 5% |
| 6 | 1MBN | 86% | 0% |
| 7 | 1LDG | 51% | 16% |
| 8 | 1TIM | 48% | 17% |
| 9 | 1QJ8 | 7% | 67% |
| 10 | 1M56 | 72% | 2% |

**The reorder exposed a tooling bug worth remembering: `acceptance.py` and `fairness.py` both restated
the campaign order as a literal list**, so after the move every row was labelled with the wrong fold —
and 1LDG, now 7th, was run against 1MBN's time budget and reported a spurious FAIL at 14/27. Both tools
now read the order out of `folds.js` (`campaign_ids()`), and acceptance asserts its `SECONDS` table and
`folds.js` name the same set. Per-fold numbers are otherwise identical before and after the move: the
folds themselves are untouched, only their order.

## Cofactors (added 2026-09-13)

Nine real cofactors across five folds, parsed from the PDB `HETATM` records at build time and drawn as
ball-and-stick where they actually sit: hemes in 256B, 1BCF and 1MBN, two heme A and a copper in 1M56,
NADH in 1LDG, a manganese in 1BCF.

**The geometry decided the mechanic, and it killed the obvious one.** Measured against the rail, every
cofactor centroid sits **4.4–5.5 Å off the flight path with a corridor radius of about 2 Å**. Only one of
the ten (1LDG's NADH, 1.9 Å) has an atom inside reach at all. So you cannot fly through a heme's ring, and
widening the corridor to let you would drive the craft into the protein — the exact failure this whole
session was spent removing. A cofactor is a landmark you fly PAST.

The mechanic is therefore a **flyby gate**: a ring of pips on the rail, placed at a fraction of the
corridor's own limit on the side the cofactor is on. Claiming one means hugging that wall as you go by,
which is the tight side. That trade is the point. They are worth 2000 × combo and are never required.

Three things had to be got right, each found by a test rather than by reasoning:

- **The gate must not fight a side chain.** The oracle takes whichever target is nearer along the rail, so
  a gate 1 Å from a side chain simply loses. A heme is 7–13 Å across and stays beside the tunnel for a
  stretch, so the gate is placed at the point in ±4 Å that is *furthest* from any side chain — and from any
  gate already placed, since 1BCF's heme and its Mn site landed 0.3 Å apart and fought each other.
- **Two gates closer than 9 Å of rail cannot both be flown.** The second is dropped, most substantial
  first, so a lone metal ion beside a heme gives way to the heme.
- **The gate pulls itself inward until the swing is actually flyable.** Starting at 0.72 of the corridor
  limit and shrinking in 0.05 Å steps while the reach test fails. Without this, 256B's opening heme sat
  2.9 Å from a side chain needing 0.71 Å across, and 1BCF's heme cost the oracle residue 58 — dropping a
  flawless run from S to A, which breaks the campaign's central invariant.

**The reach model had to be made honest.** The from-rest formula said 1BCF's gate was fine; the oracle then
proved it was not. A gate is reached *moving outward*, and that velocity has to be nulled before the craft
can come back to the next side chain — `COF_SWING = 1.55` charges for it. A further `COF_HEAD = 0.88`
keeps the gate off the feasibility boundary entirely; without it a gate sat at need 0.946 against can
0.948 and the audit's own 2-decimal rounding flipped the verdict.

`fairness.py` now audits all of this: every gate inside the corridor, every gate swingable from the side
chain before it and to the one after at the speed the ramp is carrying you, no two gates within 9 Å. The
oracle claims **9 of 9 with every fold still at rank S and every side chain fixed**.

Rendering: a cofactor is buried in the fold, so the ribbon is always between it and the lens and the solid
pass alone leaves it a dark smudge. A faint additive pass drawn *through* the geometry makes it glow from
inside the protein — which is where it is, and reads as the thing the fold is built around rather than as
another collectable stuck to the wall.

## Movement (added 2026-09-13)

**Barrel roll.** Double-tap ← or →, or flick hard sideways on a phone. The roll is the HULL only — the
horizon never turns, because the view-roll cap of 45 °/s exists for comfort and spinning the world would
undo it at a stroke. It earns its place by doing something: while the craft is inverted a wall bump is a
graze, so a roll is how you ride out a corner taken too wide. 0.52 s, 0.85 s cooldown, and collecting
anything mid-roll pays a flat 150. The roll angle is added *outside* the bank clamp — clamped, the hull
stalls half way round.

**Slipstream.** Riding beyond 0.72 of the corridor limit builds a meter over 1.3 s worth up to +18 %
cruise; it falls away in 0.55 s off the edge and is wiped by a wall hit. The outer corridor is where the
wall is and where the cofactor gates are, so this pays for the line the game already wanted to ask for.
It is off under autopilot, so acceptance times are untouched; the oracle picks up 0.26–0.99 of it without
trying and **every fold still ranks S**, times within 0.3 s of before.

## A whole class of false test failure, fixed

`phone_test` polled from the harness for the craft's peak excursion during a swipe. A lunge lasts 0.55 s,
so on a loaded machine the poll simply misses it — this produced failures that cost a whole session once
before, and produced two more today at load 17. **The game now records the peak itself**
(`window.flyerPeakReset()`, `status.peakX/peakY/peakF`) and the test reads it, so the measurement no
longer depends on how fast the harness can poll.

The drag magnitude is also checked as a **fraction of the local corridor** (`peakF`), not in Å. The
corridor narrows and widens along the rail, and the slipstream — by carrying the craft further during a
slow 600 ms drag — can land it somewhere tighter, where the wall clamps it. An absolute threshold makes
that check depend on where the drag happened to land. This was a real interaction, not noise.

**Check `uptime` before believing any phone_test failure.** This machine is shared; `memembed` jobs from
other users have put it at load 17 twice today.

## The speed cap, and why the slipstream does not pay in speed alone (2026-09-13)

Adding the slipstream and the perfect-kick quietly broke the guarantee the whole game rests on.

Side chains are **placed** against `MAX_CRUISE`: `buildBlocks` asks whether a player at that speed can
cross from the previous one to this one, and drops the ones that fail. A speed source that goes past
`MAX_CRUISE` therefore un-places them again, silently. Measured with the audit extended to the real
flat-out speed, holding full slipstream would have cost **3–9 side chains per fold, up to 40% on 1BCF**,
with nothing on screen to warn the player. The oracle found it first: 1QJ8 went from 23/23 to 22/23.

Two things came out of it:

- **Cruise is clamped to `MAX_CRUISE`.** The bonuses now carry you to the ceiling sooner and hold you
  there through bends, where the corner brake would otherwise have you crawling. The reward for the risky
  line is paid in **score** instead: a side chain taken with the slipstream above half scores ×(1+groove)
  on top of the combo multiplier.
- **`fairness.py` has a `flat-out` column that must stay at zero**, and a non-zero count is a FAILURE, not
  a warning. It asks whether every crossing still works at the game's own top speed. If a future speed
  bonus escapes the cap, this is what will say so.

**The oracle now eases off for a crossing it cannot otherwise make.** A perfect player would, and without
it the oracle is not a benchmark for "flawless" but for "flat out". It made the oracle strictly better:
1M56 went from 46 to 48 perfect, 1QJ8 from 22/23 to 23/23, 1BCF from 21 to 23 perfect. All ten folds are
at rank S with every side chain fixed and all 9 cofactors claimed.

`window.NOFUN=1` turns the movement bonuses off so any comfort metric can be measured with and without
them. Measured that way, they cost nothing: camOff mean 13 either way, p95 23/25, off-frame frames
29 vs 29 on 1MBN and 175 vs 190 on 1M56 — marginally BETTER with the bonuses, because the craft spends
less time crawling out of bends.

## Two more false test failures, and the shape they share (2026-09-13)

Both were fixed properly rather than by moving a threshold:

- **`moving the finger moves the craft`** slept a fixed 600 ms and then sampled. A held finger drives the
  craft to a steady offset, but how long that takes in wall-clock time depends on how many frames the
  machine can render; at load 32 the sample landed while it was still on its way. It now **waits for the
  craft to stop moving** (`settle()`), with a timeout.
- **Magnitudes are checked as a fraction of the local corridor**, not in Å. The corridor narrows and
  widens along the rail, so an absolute threshold makes the check depend on where the drag happened to
  land — and the slipstream, by carrying the craft further during a slow 600 ms drag, moved where that
  was. That one was a real interaction, not noise.

The shape they share: **a test that depends on harness timing will fail on a busy machine and tell you
nothing about the game.** Measure inside the game, or wait for a settled state — never sleep and sample.

## What an ordinary player actually gets (2026-09-13)

Everything in this harness was either the oracle (perfect knowledge, human limits) or the autopilot
(a spring that flies the centre line). Neither says whether the game is too hard. `window.CASUAL=1` adds a
deliberately imperfect player — reaction delay, a shaky aim, and a share of side chains simply not gone
for — tunable with `CASUAL_LAG`, `CASUAL_ERR`, `CASUAL_SKIP`.

| player | settings | result |
|---|---|---|
| oracle | perfect | **S** on all ten, 215/215 side chains, 9/9 cofactors, 0 wall contacts |
| casual | 0.28 s lag, 0.30 Å error, 15% skipped | **A** on five, **B** on five · 62–96% fixed |
| sloppy | 0.45 s lag, 0.60 Å error, 30% skipped | **B/C** · 47–79% fixed |
| no input at all | — | **D** · 0–1 fixed |

The casual sweep, fold by fold (`window.CASUAL=1`):

| # | fold | fixed | | rank | time | missed |
|---|---|---|---|---|---|---|
| 1 | BUNDLE | 17/20 | 85% | A | 15.6 s | 3 |
| 2 | 1AEP | 14/17 | 82% | B | 19.7 s | 3 |
| 3 | 256B | 12/13 | 92% | A | 14.6 s | 1 |
| 4 | 2ABD | 5/8 | 62% | B | 14.9 s | 3 |
| 5 | 1BCF | 22/23 | 96% | A | 17.9 s | 1 |
| 6 | 1MBN | 18/19 | 95% | A | 21.7 s | 1 |
| 7 | 1LDG | 21/27 | 78% | B | 61.7 s | 6 |
| 8 | 1TIM | 12/17 | 71% | B | 51.7 s | 5 |
| 9 | 1QJ8 | 22/23 | 96% | A | 27.0 s | 1 |
| 10 | 1M56 | 40/48 | 83% | B | 81.0 s | 8 |

2ABD reads worst at 62%, but it has only eight side chains, so a 15% skip rate costs it proportionally
more than anywhere else. Nothing here is a walkover and nothing is brutal.

That is the ladder you want: S is reachable but demands precision, an ordinary run lands at A/B, and doing
nothing gets you to the end of the fold with nothing to show for it. No fold punishes an average player
and none is a walkover.

## A GPU buffer leak across the campaign

`renderer.upload(geom, mesh)` reuses a mesh's four GL buffers when one is passed and allocates new ones
when it is not. The side-chain chunk meshes and (as first written) the cofactor mesh were rebuilt from
scratch on every fold load, so their buffers were orphaned on the GPU every time — about 80 across a
ten-fold campaign, on a device where that is worth having. `gl.js` now exports `dispose(m)`, `buildChunks`
frees the previous fold's chunk meshes before dropping them, and the cofactor mesh is re-uploaded into
the same buffers. A fold with no cofactors uploads an EMPTY mesh rather than leaving the previous one in
place, so `draw()` skips it on `count === 0`.

Related, and worth remembering when reading any diagnostic: **the per-frame status block sits behind the
preview's early return**, so anything written there is stale for the whole 3.2 s orbit of the next fold.
`buildCofactors` now clears `status.cof` on load for that reason.

## Ghost of your best run (2026-09-13)

Each fold stores the run that scored best as a trace of `(s, x, y)` — rail position and cross-section
offset, **not** world coordinates, so it survives any future change to how the rail is built. Sampled at
20 Hz, quantised to integers (s in 0.1 Å, x and y in 0.01 Å) and kept as one comma-separated string in
`localStorage`: about 3 kB for a 15 s fold, ~20 kB for 1M56, well inside any quota for all ten.

It replays at the same clock time, drawn additively and through the geometry at low alpha so it reads as a
ghost and can never be mistaken for something you can hit — and so it is still visible round a bend, which
is the whole point. The HUD shows `+N Å vs best`, green ahead and red behind. When the ghost's trace runs
out it simply stops being drawn.

Two details worth keeping:

- **The ghost seeds itself when there is no ghost yet**, not only on a new best. A player who already had
  a stored score from before this existed would otherwise have to beat an old number before getting
  anything to race. This is also exactly what made the first test fail — the harness reuses its profile,
  so `flyer.score.BUNDLE` was already set and the strict "new best" branch never ran.
- The test reads `flyer.ghost.BUNDLE` **by name**. Checking `status.fold` there reads the *next* fold:
  the finish card has already been tapped by the time the following check runs.

## Dropping your own structure is now tested

`window.__load` (the entry point the drop handler uses) is exercised in `phone_test` with `data/1UBQ.pdb`:
ubiquitin loads, 76 residues, 6 side chains, plays with no error. It is a headline feature for this
audience and nothing covered it — and `expandFold` grew a `cof` field this session, which is exactly the
kind of change that silently breaks a path with no test on it. A dropped structure carries no cofactors,
which `buildCofactors` handles by uploading an empty mesh.

## The intro card ships from tools/bundle_template.html, not index.html

A whole version's worth of intro-card edits — the barrel roll, the cofactor legend, the phone paragraph —
was applied to `index.html` and silently did nothing. **`index.html` is a bare dev page with no intro card
at all**; the card exists only in `tools/bundle_template.html`, which is what `bundle.py` fills in. The
anchors came from reading the *published* page, so they matched the template's text, not index.html's, and
`str.replace` with a missing anchor is a no-op with no error.

`phone_test` now asserts the card names the current mechanics (`barrel roll`, `slipstream`, `cofactor`,
`ghost`). That immediately found a second bug: on a phone the `.long`, `.legend` and `.keys` blocks are
`display: none`, so only the short paragraph is visible — and it said "barrel-rolls", which is not the
phrase a player scanning for "barrel roll" finds. **The check reads `innerText`, so it sees what the player
sees, not what is in the markup.**

Two rules from this:
- Verify an edit landed. `replace` with a stale anchor fails silently.
- A mechanic that exists in `game.js` and not on the card does not exist for the player.

## headless_run now tests the shipped shell (2026-09-13)

`bundle.py` builds the game into `tools/bundle_template.html`. `headless_run.py` was building it into
`index.html` — a bare dev page with no intro card, no brake button and a different touchbar. So
`acceptance`, `fairness`, `chain_eval` and **every screenshot** described a page no player ever sees. Only
`phone_test` used the real one, because it bundles first.

`headless_run.py` now fills the same template, with a prelude that hides the intro (`HEADLESS` already
bypasses its pause, so it never blocked anything) and emits plain JS rather than script tags, since it all
lands inside the template's single `<script>`. Verified by diffing the whole acceptance and oracle tables
before and after: **identical**, down to the score, apart from the wall-clock line.

This is the same failure as the stale-`dist/` one already recorded here, and as the intro-card edits that
went to the wrong file: **more than one file claims to be "the page", and the tools disagreed about which.**

## Drop robustness, for a public link

People will drop all sorts of things at a game they open from a link. Tested:

| dropped | result |
|---|---|
| 1UBQ (76 res, full side chains) | loads, 6 side chains, plays |
| 1CRN (46 res) | loads, 5 side chains |
| Cα-only PDB | loads, 4 side chains from the grafted templates |
| a 4-residue stub | loads and finishes, no error |
| a file that is not a structure | `No Cα atoms found`, caught, flashed, game keeps running |

`phone_test` covers the happy path through `window.__load` **and** the real `drop` handler, by dispatching
a genuine `DragEvent` with a `DataTransfer` carrying a junk `File`. Two traps in writing that: a `\n`
inside the injected JS string becomes a real newline and silently breaks the literal, so `evaluate`
returns `undefined` rather than failing loudly — keep the injected expression on one line.

## A browser without WebGL now says so (2026-09-13)

`createRenderer` throws `WebGL not available` and the throw was caught into `status.err` — where nobody
could see it. A player on an old device, or with hardware acceleration switched off, got a black page and
no explanation. The message now goes into the intro card they are already looking at.

**Writing the test for it immediately found a bug I had introduced**: `buildCofactors` called
`uploadGeom` with no renderer guard, so with WebGL missing the whole init threw part way through and
`window.flyerStatus` was never even assigned. The fallback path looked fine right up until something
asked it a question.

`tools/nogl_test.js` is the check: it bundles, stubs `getContext('webgl')` to return null **before** the
bundle's own script runs, and asserts the message appears, the card is visible, and the failure is
recorded rather than thrown. It is separate from `phone_test` because the stub has to be injected ahead of
the game's script, which means a purpose-built page rather than the real one.

### The five checks before any release
1. `python3 tools/acceptance.py`
2. `python3 tools/acceptance.py --oracle`
3. `python3 tools/fairness.py`
4. `node tools/phone_test.js`
5. `node tools/nogl_test.js`
plus `bash tools/chain_eval.sh` for the whole campaign in one run.

## The slipstream was being wiped on every pickup

`riding` was gated on `P.flashT < 0.05`, meaning "not just after a wall hit". But `impact()` sets
`P.flashT = 1` on **every side chain you collect**, not only on wall contact — so the slipstream was
cancelled every time you scored, which in this game is constantly. It decays in 0.55 s and `flashT` takes
about 0.33 s to fall, so each pickup cost roughly 0.6 of the meter.

Measured: the oracle's best slipstream on the bundle was **0.26**; it is now **1.0**, and 1.0 on 1MBN and
1M56 too. Ranks and times are unchanged, because cruise is capped at `MAX_CRUISE` either way — the meter
now actually reaches the top it was always supposed to.

A real wall hit zeroes `P.groove` at the point of contact, which is the correct and only place for it.

**The tell:** a number that is never near its maximum in any measurement is usually being reset by
something, not merely hard to earn. `grooveBest` sat between 0.26 and 0.99 across folds with no pattern
that matched how the folds actually fly.

### Storage, after the whole campaign
30 keys, 77 kB — ten folds × (best time, best score, ghost trace). Comfortably inside any quota.

## Cofactor scoring, and where the number came from

At `COF_SCORE = 2000` the three cofactors on 1M56 were worth roughly as much as **all 48 of its side
chains put together** — 3 × 2000 against 48 × ~150. That is not a prize, it is the whole fold. Halved to
1000: two helix repairs, ten flips, still clearly the best thing you can take, and a fold you win on side
chains. Rank depends on side chains fixed and time against par, never on score, so this moved nothing but
the number (1M56 oracle: 92,385 → 78,385).

Cofactors are also marked on the minimap — a pulsing ring until claimed, a filled dot after. They are the
only thing on a fold worth planning a line for, and without a mark the first you know of one is the ring
of pips a second ahead of it.

First-time hints are keyed by cofactor KIND (`cof:HEM`, `cof:CU`, …). A player who met the heme on fold 6
still has no idea what the blue thing on fold 7 is.

## The roll, in every input mode

Three ways in, and each was wrong once:

- **Touch, free flight** — flick and release: `< 250 ms`, `>= 70 px`, mostly sideways.
- **Touch, lane mode** (the phone default) — a much harder flick, `< 420 ms`, `>= 140 px`. It layers on
  top of the lunge: an ordinary flick lunges, a hard one lunges AND rolls. The first build gated the roll
  on free flight, so **almost no player could reach it at all**.
- **Keyboard** — double-tap ← or → within 320 ms. This was gated on `!laneMode`, so a desktop player who
  pressed L lost it. Now it works in both, for the same reason the touch flick does.

The classifier is a pure function, `window.flyerRollFromFlick(ms, dx, dy, lane)`, tested directly with
exact numbers — **a CDP swipe on a loaded machine takes over a second of wall time for a flick a phone
does in 110 ms**, so a real fast flick can never be synthesised from the harness and any timing threshold
tested that way will fail for reasons that have nothing to do with the game. The keyboard path and the
"an ordinary flick does not roll" path are tested through the real listeners.

## Sound can be turned off (2026-09-13)

There was no mute. This is a game people open from a link — at work, on a train, next to someone asleep —
and a page that starts making noise with no way to stop it gets closed. `M` on a keyboard, a **sound**
button in the phone menu, remembered in `localStorage` across sessions, and it silences both the beeps and
the drone.

**Adding one button to the menu broke it.** `#menurow` was a non-wrapping flex row anchored to the right;
six buttons overflowed a 390 px phone and the first one ended up spanning **x = −72 to 18** — off the left
edge, unreachable by any finger. The test failed as "autopilot button works", which says nothing about the
cause. `phone_test` now asserts **every menu button is on screen**, which names it directly, and the row
wraps with `max-width: calc(100vw - 24px)`.

The lesson is the shape of the failure, not the CSS: a test that clicks a control by its bounding rect
will fail *silently and misleadingly* when the control moves off-screen. Assert that the thing you are
about to click is reachable.

## Ruled out: letting the autopilot claim cofactors

Tried, measured, reverted. The idea was that the autopilot demo should show off the cofactors, and the
guard looked airtight: take a gate **only** when no unjudged side chain is inside the look-ahead, so it
can never compete with one.

It cost 1M56 a side chain anyway — 48/48 down to 47/48 — because *"no side chain in the horizon right
now"* is not the same as *"no side chain soon"*. Detouring to the gate left the craft out of position for
the one that appeared next. It also only claimed 3 of the 9 across the campaign, so the trade was bad in
both directions.

The autopilot's job is to finish every fold; the acceptance budgets are measured on it. A player who wants
the cofactors can fly for them — the minimap marks them and the pips call them out.

## The whole campaign, as an ordinary player flies it

`window.CASUAL=1` chained through all ten (the same harness as `chain_eval.sh`, autopilot off):

| fold | fixed | rank | time | running score |
|---|---|---|---|---|
| BUNDLE | 17/20 | A | 15.6 s | 3,846 |
| 1AEP | 14/17 | B | 19.5 s | 9,546 |
| 256B | 12/13 | A | 14.6 s | 13,641 |
| 2ABD | 5/8 | B | 14.6 s | 15,941 |
| 1BCF | 22/23 | A | 17.9 s | 27,101 |
| 1MBN | 18/19 | A | 20.5 s | 43,879 |
| 1LDG | 21/27 | B | 61.4 s | 52,756 |
| 1TIM | 12/17 | B | 51.5 s | 58,356 |
| 1QJ8 | 22/23 | A | 26.1 s | 70,783 |
| 1M56 | 40/48 | B | 79.4 s | 90,131 |

**183 of 215 side chains, 5.4 minutes, five A and five B, no error anywhere.** A normal player gets to the
end of the campaign, with plenty left on the table to come back for. That is the shape you want: the
oracle's 215/215 at rank S is visible from here but not close.

## The bumps were never collisions (2026-09-13)

Reported: bumps still felt after every wall penalty was removed. So it was never the collision system, and
the search had been in the wrong place for two sessions.

**Why it took so long — three process failures, all mine:**

1. **I assumed collision** because that is what the first report named, and kept measuring wall events.
2. **The camera-step diagnostic only logged `P.t < 2.2`.** It was written to hunt the opening bump, found
   it, and then that 2.2 s window quietly became the whole picture. On 1M56 it covered **2% of the fold**.
3. **The replacement diagnostic reported all zeros and I nearly believed it.** It referenced `budget`
   before its `const`, threw a TDZ error every frame, and `Math.floor(NaN/0.15)` silently wrote to a
   property called "NaN" instead of a histogram bin. "0 snaps, 0 clamps" looked like a result.

Measured over a whole 1M56 run once the diagnostic worked (`window.BUMPS=1`): **220 frames wanting a lens
step over 0.45 Å, 230 frames clamped by the step budget, 235 fit snaps** — roughly two a second.

Decomposed by switching each suspect off:

| | clamped | steps >0.45 Å | >0.90 Å |
|---|---|---|---|
| baseline | 230 | 220 | 8 |
| corridor fit off | 23 | 78 | 3 |
| trail length pinned | 223 | 140 | 7 |
| both off | 12 | 12 | 5 |

**The corridor fit was the bumps.** It swings the lens around the tangent to dodge geometry. What it
bought: about 6 frames per fold where the lens is a tenth of an Å inside a ribbon — which the
near-geometry fade already dissolves. Screenshots of the worst such frame with and without the fit are
indistinguishable, and the one WITHOUT frames the craft better.

`CAM_FIT = false`, and the trail length `CB` (which shortens by up to 1 Å as the path bends) is now slewed
at `CB_SLEW = 1.1 Å/s` instead of jumping.

| 1M56, whole run | before | after |
|---|---|---|
| frames clamped by the step budget | 230 | **11** |
| lens steps > 0.45 Å | 220 | **9** |
| lens steps > 0.90 Å | 8 | **3** |

Cost: `camIn` 0 → 1–6 frames a fold (18 across seven). Framing **improved**: `camOff` p95 23–25 → 18–20,
and 1M56's off-frame count fell to zero. Both are one constant to restore.

**The lesson that generalises:** a diagnostic written to chase one symptom acquires the scope of that
symptom and keeps it. `RAWSTEP`'s 2.2-second window was correct for the opening bump and wrong for
everything after, and nothing in the code said so. When a fix does not hold, suspect the instrument's
range before the hypothesis.

## Walls, part 3: what "flying through walls" actually was (2026-09-13)

With the bumps fixed, the next report was that flying through walls looks wrong. Three separate things
were hiding under that phrase, and only measuring each separately pulled them apart.

**Correction first: the craft DOES clip geometry.** I reported "0% of frames, never" — that came from
`ribbonPenetration(...) / SC`, and the function returns an OBJECT (`{depth, ss}`), so the whole
measurement was NaN. Measured properly: **0.3–3.0% of frames, up to 0.51 Å deep.** Fourth instrumentation
bug of the day, and the most misleading, because it produced a confident wrong answer rather than an
obvious zero.

**What the green wash was.** Not fog, not the near-fade (narrowing the band 0.9–2.2 → 0.5–1.1 Å changed
nothing). It was a β-sheet's **back face**, drawn solid and filling the frame as a backdrop, with the ship
and helix rendering on top of it. The camera was on the far side of a slab.

Three fixes, in order of how much they bought:

- **C — the lens escape.** The old corridor fit triggered on `ribbonClearAtLeast(pos, 0.9)`, which is true
  on **74–92% of frames**, and answered with a search over 20 angles × 4 scales × 2 trail lengths. It
  fired 235 times a run and jumped between solutions: that was the bumps. It now triggers on signed
  penetration (true on 1–6 frames a fold) and corrects by pushing along the surface normal by exactly the
  depth it is in — `DUCK_CLEAR = 0.12 Å`, `DUCK_SLEW = 4.5 Å/s`. A correct idea wired to the wrong sensor.
- **B — the sheet deck floor.** A slab seen from underneath fills the frame with its own back face, and C
  cannot catch it: the lens can be a clear inch UNDER a deck without being inside any surface at all.
  `DECK_MIN = 0.45 Å` above the deck in trench sections, slewed.
- **A — back-face culling for β-sheets only.** A sheet is a slab you fly OVER and never inside, so its
  underside is only ever visible when the camera is somewhere wrong. A helix coil is the opposite — a
  tube you fly INSIDE, where the back face IS the wall you are meant to see. `cartoon.js` now emits
  strand triangles into a second index buffer over the same vertices, and `gl.js` draws that one with
  `CULL_FACE`. No shader change, no new attribute, no gameplay effect.

Measured, diffing rendered frames pixel by pixel on 1QJ8 (67% sheet):

| | res 50 | res 70 | res 90 | res 110 |
|---|---|---|---|---|
| global culling vs none | 0.32% | 0.25% | **10.38%** | 0.77% |
| sheet-only culling vs none | 0.28% | 0.28% | **0.96%** | 0.20% |

The 10.38% was the **helix** being eaten — which is exactly why it has to be per-element. Under sheet-only
culling every difference is under 1% (exhaust-particle timing), the green wash is gone, and the decks
still render: strand-coloured pixels 49% on 1QJ8, 52% on 1LDG, 24% on 1TIM at real trench sections.

One thing that could have sunk this and didn't: in a β-barrel you fly inside the lumen and see the far
wall from its inner side, which culling would delete. It doesn't, because `rail.js` already picks each
sheet's normal toward the emptier side, so the face you see across the lumen is the front face.

| 1LDG / 1M56 | old fit | fit off, nothing | C + B + A |
|---|---|---|---|
| camera inside geometry | 0 | 6 / 5 | **0 / 0** |
| lens lurches per run | 230 | 23 | **20 / 15** |

## Boost on a phone (2026-09-13)

Space already boosted — it has always been bound alongside Shift — but **the intro card only listed
Shift**, so it read as missing. A control nobody is told about does not exist. The card now says
`Shift or Space`.

On a phone boost was "a second finger anywhere": it worked, and nothing on screen said so. There is now a
**boost button bottom-right**, mirroring brake bottom-left, wired exactly the same way
(`flyerAction('boostOn'/'boostOff')`, pointerdown/up/cancel/leave, `#boostbtn` added to `uiTouch` so a tap
on it never becomes a steer). The second finger still works.

**The button landed on top of the minimap**, which sits 84 px in the bottom-right corner on phones. The
bottom corners belong to the thumbs, so the minimap moved up 78 px rather than the button moving somewhere
a thumb cannot reach.

Tested: held, 13.8 → 20.5 Å/s; released, back to 8.6. Both directions asserted in `phone_test`, along with
the button being on screen — the same guard that caught the menu row overflowing when the sound button was
added.

## Closing the desktop / phone gap (2026-09-13)

Reported: the game feels good on a phone and not as good on a computer. It is not the hardware — the two
platforms were running **different control schemes**, and only one of them was tuned.

- `laneMode = TOUCH`, so a phone gets a **critically damped spring toward a position**: press and the
  craft goes somewhere definite, let go and it comes back, with the acceleration clamped to `LAT_ACC`.
- A keyboard got `P.vx += acc * dt` — raw force in four directions. No target, no return, no
  proportionality beyond however long you happen to hold a key.

That is the gap. The keys now drive the same spring (`KEY_W = 15`), toward the corridor limit rather than
the finger's 75% ring — a key is a direction, not an aim — with acceleration clamped exactly as the lunge
clamps it, so the reach the fairness model is built on is unchanged.

**Ruled out: mouse steering.** Prototyped it (hold a button and drag, a 1:1 port of the finger) and it
worked — 2.29 Å while dragging, returning on release, and a bare mouse move correctly did nothing (0.670 Å
of drift, identical to a run with no mouse events at all, which is the auto-assist). Reverted: *"mouse is
very unnatural for a game like this on the computer."* A tunnel runner is a keyboard game.

**The tuning that mattered was `KEY_BACK`, and the first value was wrong.** At 5.5 the axis ramps out in
0.18 s, so a 0.15 s tap and a 1 s hold both pinned the craft to the wall — *less* expressive than the raw
acceleration it replaced, because a key's only proportionality is how long you hold it:

| `KEY_BACK` | 0.15 s tap | 0.35 s | 1 s hold |
|---|---|---|---|
| 5.5 | 1.45 Å | 1.46 Å | 2.46 Å |
| 3.0 | 0.92 Å | 1.46 Å | 2.46 Å |
| **2.0** | **0.64 Å** | **1.44 Å** | **2.46 Å** |
| 1.4 | 0.47 Å | 1.02 Å | 2.46 Å |

At 2.0 a tap is a nudge, a third of a second is a lane change, and a hold pins you to the wall. Reach is
if anything better than the old model's 2.17 Å, because a sustained hold carries into the `WALL_GIVE`
zone where the corridor opens out to the real surface.

**A gap in the harness worth naming:** the oracle, the autopilot and `CASUAL` all steer through their own
branches, and `phone_test` drives touch. **Nothing in the six gates exercises the keyboard path at all**,
so this change is covered only by the ad-hoc runs above. Worth a permanent check.

## A quieter visual design (2026-09-14)

The owner asked for a considered, restrained visual treatment and approved a combined pass
over the ribbon, lighting, craft and interface. The opening now presents the ribbon as a
slowly moving sculpture with a short invitation and an explicit Begin flight button. The
manual, Clustal key and scientific credits are available in a native help dialog before and
during play. Opening it pauses the run and releases held controls; closing or Escape resumes
it. The desktop menu is now visible too. System fonts remove the Google Fonts dependency.
Small-phone and landscape layouts are checked separately. The old phone introduction's
instruction to dodge sheet side chains was incorrect; the help now says to collect them.

The HUD groups score and combo, with quieter fold metadata, a single turn chevron and one
stable reward message. The persistent desktop manual and legend moved into help. The craft
has a pearl-grey hull and dark canopy, with illumination concentrated at the engines. Its
geometry, footprint and collision shape are unchanged.

**The lighting diagnosis in the old handover was wrong.** `begin()` already transformed the
main light from world into view space. The added term is a camera fill, preserving visibility
inside helices, with a broader, weaker specular highlight. A restrained AO approximation is
baked into ribbon colours using directional Cα density within 9 Å and interpolated along the
backbone. Both the collection glow and its base preserve that shading, and restart restores
all base colours. Geometry carries its own ring/subdivision layout so glow writes stay aligned.

**The first tessellation increase was too expensive on phones.** A 12-point profile and
eight samples per residue nearly doubled ribbon triangles. Software-renderer medians at
390×760, with an actual pixel readback after each frozen draw, were:

| Fold | Before | First candidate | Final phone geometry |
|---|---:|---:|---:|
| Bundle | 11.8 ms | 20.8 ms | 12.3 ms |
| 1LDG | 27.2 ms | 40.0 ms | 28.4 ms |
| 1M56 | 50.4 ms | 71.3 ms | 54.0 ms |

Phones and narrow windows therefore retain five longitudinal samples and use the rounder
12-point cross-section: 20% more ribbon triangles, roughly 4–7% more measured render time.
Larger desktop views use eight samples. A prospective 16-bit overflow from the finer mesh
selects the old 10 × 5 layout for larger imports. These are SwiftShader measurements on a
shared machine, not physical-phone frame rates. `gl.finish()` alone misleadingly measured
mostly command submission; `readPixels()` is what waits for the rendered result here.

**Additive blending was ignoring alpha.** `ONE, ONE` meant the cofactor x-ray and ghost
draws ignored their supplied distance fade. `SRC_ALPHA, ONE` fixes that; effects with fade
already in vertex colour retain alpha 1. Cofactor x-ray strength is now 0.22, and its cyan
shape is legible instead of clipping to a white silhouette. Near ribbon fades, side-chain
hard cuts and strand-only back-face culling are unchanged.

`tools/visual_test.js` exercises help, pause/resume, keyboard activation, focused-menu Escape,
six actual flight viewpoints, small-phone/landscape layouts, and the largest campaign fold
without the index extension. Captures explicitly step beyond the preview: its rounded status
can say zero a frame before the old residue is refreshed. The phone harness now opens the
help to check the mechanics and taps the real Begin button.

The autopilot and oracle sweeps, fairness, standalone phone input, no-WebGL fallback and
the whole-campaign chain passed. The chain restores 214/215 side chains, 614,800 points,
with ranks A/B/S over 6.6 minutes. No flight physics or flight-camera constants changed.
The artifact-wrapper phone run also passed all touch, menu, ghost, import and completion
checks. The rebuilt standalone and `docs/index.html` are byte-identical.

## Keyboard diagonals and large-screen responsiveness (2026-09-14)

Reported: diagonal input on PCs feels unreliable, and larger windows get laggier.
There were several actual control bugs, not just a sensitivity setting:

- Coarse-pointer detection sent keyboard events into `laneSwipe`, so a touchscreen PC
  holding Right+Up only lunged upward: the last key won.
- A was listed in the steering map but intercepted by the autopilot shortcut.
- The separate axis ramps survived both release and restart. Adding a second axis
  ramped it from zero; reversing a full axis took a second just to reverse the target.
- The keyboard spring integrated position in its substeps, then the common lateral
  step damped and integrated it again. Its nominal acceleration limit was misleading.

Keyboard now always uses held directions, independent of touch mode. Physical key state
keeps arrow/WASD aliases independent and avoids mistaking overlapping aliases for a
double-tap. Shift/Space boost aliases also release independently. WASD is usable; autopilot
is now **P**, with the shipping help and README updated. Blur, hidden-page, pause and restart
clear held inputs. Touch can take over while the keyboard spring is returning.

The normalized direction responds immediately; only reach ramps (`KEY_RAMP=3`). The
spring uses `KEY_W=20`, integrates once in ≤8 ms substeps, and stays active on release
until settled. The 44 Å/s² steering limit, brake advantage, corner forces, corridor,
camera and forward-speed tuning remain in place. Prior `KEY_BACK` measurements above
included the double integration and stale state, so they do not calibrate this spring.

In the opening bundle at 60 Hz, a 100 ms press moves 0.14 Å and a 300 ms hold moves
0.90 Å. A 300 ms diagonal moves (0.64, 0.64) Å: the same total reach. Adding Up to held
Right produces 0.50 Å upward movement within 150 ms. Releasing Right returns that axis
to 0.05 Å within 300 ms while Up stays at 1.44 Å. A reversal crosses centre by 400 ms
without bypassing the acceleration limit. The same diagonal at 30/60/120 Hz differs by
only 0.01 Å per axis. Desktop and coarse-pointer PC results agree.

`FLYER_CONTROLS=1 node tools/visual_test.js` adds 23 checks per pointer mode covering
all diagonals, added/released axes, reversal, overlapping aliases, repeat, opposition,
reset/blur/hidden/pause, boost, P, touch takeover and frame-rate consistency. It fails
against the prior build and passes against this one. These tests step the real game
and dispatch DOM keyboard events; they do not measure physical keyboard latency.

Rendering now bounds the scene to 2,073,600 pixels, preserving aspect ratio, while
keeping HUD/DOM text at its prior resolution. A 1920×1080 viewport at DPR 2 previously
rendered 3840×2160; it now renders a 1920×1080 scene with a 3840×2160 HUD. This trades
some edge sharpness on large displays for responsiveness, without changing geometry,
lighting, near cuts, culling or AO. Unlit fragments skip lighting, and near cuts happen
before lighting work. No adaptive resolution or additional extensions are introduced.

Sequential SwiftShader frozen-draw medians (55 draws, 5 warmups, one-pixel readback),
1920×1080 at DPR 2, using the same camera state and desktop geometry:

| Fold | Before | After |
|---|---:|---:|
| Bundle | 47.7 ms | 22.4 ms |
| 1LDG | 97.8 ms | 52.6 ms |
| 1M56 | 153.9 ms | 86.2 ms |

That is 44–53% less render time in this software-rendered benchmark, not a prediction
of hardware frame rates. Use `FLYER_BENCH=1 FLYER_VIEWPORT=1920,1080,2 node tools/visual_test.js`
to repeat it. The regular visual suite checks live Retina/4K/ultrawide/small-window
resizing and the separate HUD dimensions, in addition to the existing phone viewpoints.
At the unchanged 390×760 phone resolution, medians were 12.1→13.0, 27.1→26.8 and
54.1→51.0 ms respectively: roughly the same cost, not the large-screen speedup.

The six required gates pass: autopilot, oracle, fairness, phone inputs, no-WebGL fallback
and the complete campaign. Campaign results remain 214/215, 614,800 points, A/B/S ranks.
The keyboard and visual suites pass too. The single-file builds are regenerated.
