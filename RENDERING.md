# Handover: improving the rendering

For an agent picking up the visuals. The game works and looks acceptable; this is about
making it look *good*. Read `PLAYTEST.md` for the full engineering history — this file is
the rendering-specific extract, plus the things that will waste your time if nobody says
them out loud.

**Read this whole file before changing a shader.** Several of the obvious ideas have been
tried here and rejected for reasons that are not obvious.

**Visual pass, 2026-09-14:** the baked AO and lighting work below is now implemented. The
opening screen shows the ribbon as a slowly moving sculpture, with an explicit Begin button;
instructions, colour legend and credits live in a keyboard-accessible help dialog that pauses
flight. Phone and desktop share a quieter HUD. The craft has a pearl-grey hull, dark canopy
and small engine accents. Near cuts, element culling, flight physics and flight-camera tuning
are preserved. See the new playtest entry for the geometry/performance tradeoff.

---

## 1. What you are working with

A protein interior at flying speed. The camera is usually a few ångström from a surface,
inside a tube or over a slab, with the whole fold packed around it. Depth perception is
the hard problem: everything is the same three colours and lit the same way.

| file | what it does |
|---|---|
| `gl.js` | the entire renderer. One WebGL1 program. |
| `cartoon.js` | ribbon and baked AO. `RING = 12`; `SUB = 5` on phones/narrow views, 8 on desktop. Larger imports retain the old 10 × 5 budget if the new mesh would cross the 16-bit vertex limit. |
| `game.js` | builds every other mesh and issues all draws. HUD is a separate 2D canvas. |

### The one shader

`gl.js` has a single lit, fogged, two-sided vertex-colour program. Per fragment:

- two-sided normal flip (`gl_FrontFacing`, then a second flip toward the viewer)
- **wrap diffuse** (`wrap = 0.5`) from a fixed world light, plus camera fill (`0.24 · N·V`)
  and a broad satin highlight (`pow(…, 22) * 0.13`); ambient is 0.34
- `uAmbient`, `uUnlit` (to bypass lighting entirely), `uAlpha`
- linear→smoothstep fog to a flat colour
- `uNear` — the near-geometry cut, described in §3

Uniforms: `uProj uView uLight uFog uFogRange uAmbient uUnlit uAlpha uNear`. Attributes:
`aPos aNrm aCol`. That is the whole surface area.

**Correction to the original handover:** the `[0.3, 0.85, 0.45]` light already was fixed in
world space: `begin()` transforms it by the view matrix. The new term is the soft camera
fill, which keeps surfaces readable while the world light supplies changing form cues.

**There is no model matrix.** Every mesh is baked in world space and re-uploaded when it
moves. See §5.

### Draw order, 15 calls a frame

```
ribbon  (near-solid pass)          ┐ only when something is within the band;
side-chain chunks (hard cut)       │ a clearance test each frame decides,
cofactors (hard cut)               │ because two ribbon passes cost real
ribbon  (near shell, blended)      ┘ frames on a phone
glider  (unlit halo, no depth) → glider → glider glow
ghost side chains (alpha 0.5)
ghost craft (additive, no depth)
fx quads (additive)
cofactor x-ray (additive, no depth, distance-faded)
target posts (additive, no depth)
```

Meshes may carry a **second index buffer drawn with back-face culling** (`m.iboCull`).
Only β-strand triangles use it — see §3.

---

## 2. Where the real wins are

The first two are implemented. The others remain candidates, subject to measurement.

### (a) Ambient occlusion, baked into vertex colour — implemented

A protein is all crevices, and nothing in the current pipeline expresses them. Screen-space
AO needs a depth pass and `WEBGL_depth_texture`, which is a real architectural change.

`occlusionField()` uses spatial buckets of Cα atoms within 9 Å, excluding the three nearest
sequence neighbours on either side. A density tensor per residue gives a two-sided,
normal-dependent shading factor, smoothly interpolated along the ribbon. It is an
approximation, not ray-traced visibility. The factor is bounded to 0.76–1 and baked into
`col`, with `ao` retained separately. No new shader attribute or per-frame AO work.

The **glow-on-collect** effect uses that baked base and also scales its gold target by AO.
`updateGlows()` reads `ringSize` and `subdivisions` from the mesh; do not restore the old
hardcoded 10 × 5 offsets. Restart restores all base colours before clearing the glow list.

### (b) A second lighting term — implemented

The original world key is complemented by a camera fill, using the existing view vector.
No additional uniforms or passes. Keep both: the camera fill is necessary inside helices.

### (c) Sphere impostors for side-chain atoms

`game.js` draws atoms as an icosphere (`ICO`, 42 verts / 80 faces; `ICO_LOW` for folds over
500 blocks) and bonds as `CYL_N = 6` cylinders. 1M56 has 48 side chains of ~10 atoms each.
Billboard impostors with an analytic normal in the fragment shader would be both *rounder*
and cheaper. This does need a new attribute or a second program.

### (d) A model matrix

See §5. This is a performance and cleanliness win, not a looks win, but it unblocks others.

### (e) Ribbon tessellation

The 12-point cross-section includes the thin-axis extrema of the elliptical profile. Eight
longitudinal samples made the phone software-rendering benchmark 40–75% slower, so phones
retain five. The final measured phone overhead is roughly 4–7% (software renderer, not a
physical-phone FPS claim). Re-measure before increasing it.

---

## 3. Contracts you must not break

These are load-bearing. Each was arrived at from a specific failure.

**The near-geometry cut (`uNear = [start, end, mode]`).** A helix ribbon is 0.4 Å thick, so
a surface a fraction of an ångström off the lens fills the screen with one flat colour and
the player is blind. The ribbon is drawn **twice**: mode 2 discards everything nearer than
`end`, mode 1 draws only that near shell, alpha-faded to nothing at `start`. The fade is
**squared** (`na = na * na`) because a surface the lens is *inside* covers every direction
at once and the linear version washed the screen milky.

- A **dithered dissolve** was tried first and is worse: a large half-dissolved surface is
  television static. 1AEP turned the top half of the screen to snow.
- **Side chains take a hard cut, not a fade** (`SIDE_SOLID`). They are small and saturated,
  so a half-transparent one on the lens veils the whole view in its own colour — a red
  glutamate over the entire sky on 1QJ8. Cut outright, they are simply not there.
- The band was narrowed 3.4 → 2.2 Å to kill shard artefacts from unsorted blending.

**Back-face culling is per-element and must stay that way.** A β-sheet is a slab you fly
*over* and never inside, so its underside is only ever visible when the camera is somewhere
wrong — cull it. A helix coil is a tube you fly *inside*, where the back face **is** the
wall you are meant to see — culling it eats the helix. Measured by pixel-diffing frames:
global culling changed 10.38% of one 1QJ8 frame (the helix being destroyed); strand-only
changed 0.96% (particle timing). `cartoon.js` emits strand triangles into `idxCull`.

**A β-barrel survives this only by luck worth preserving:** `rail.js` picks each sheet's
normal toward the emptier side, so the face you see across the lumen is the front face.
If you change how sheet normals are chosen, re-check culling.

**No WebGL2, no extensions beyond `OES_element_index_uint`.** The game is a single file
people open from a link on a phone. If you add an extension, handle its absence — see
`tools/nogl_test.js` for the pattern, and note that a missing renderer must still produce
a readable page.

---

## 4. Things already tried and rejected

Do not redo these without new evidence.

| tried | why it failed |
|---|---|
| dithered dissolve for near geometry | half-dissolved large surfaces are TV static |
| fading side chains instead of cutting | veils the entire view in one saturated colour |
| a wider (3.4 Å) fade band | shard artefacts from unsorted blending |
| linear near-fade ramp | milky wash when the lens is inside a surface; squared it |
| global back-face culling | deletes helix interiors, which is most of the game |
| narrowing the fade band to fix the "green wall" | changed nothing — it was a back face, not a fade |
| moving the camera to dodge ribbons | 235 lens lurches a run; that was the felt "bumps" |

That last one is worth understanding before you touch the camera: the corridor fit was
triggered by `ribbonClearAtLeast(pos, 0.9)`, which is true on **74–92% of frames**, while
the lens is genuinely inside geometry on **1–6 frames a fold**. It is now off (`CAM_FIT`),
replaced by a push along the surface normal by exactly the penetration depth.

---

## 5. Known weaknesses, stated plainly

- **No model matrix.** `VS` has only `uProj` and `uView`; every vertex is world-space. The
  craft is rebuilt from scratch and re-uploaded **every frame** (`buildCraft`), and since
  the ghost was added, twice. So are the fx quads and the target posts. Adding `uModel`
  would make the craft a static mesh with a transform, and is the prerequisite for any
  instancing.
- **The craft's silhouette is built from quads with a normal-flip heuristic**, not a
  consistent winding — which is why global culling could not simply be turned on.
- **No shadows, no screen-space AO, no post-processing, no framebuffer.** `antialias: true` is requested
  at context creation and may be ignored on mobile; there is nowhere to put FXAA without
  introducing a render target.
- **Colour is the only material channel.** No textures, no roughness, no matcap.
- **`folds.js` is 112 KB of baked integer coordinates** and the shipped page is 379 KB in
  one file. That is fine, but it bounds how much geometry you can add for free.

---

## 6. How to verify anything you change

**Look at it.** Screenshots are the loop that found every real visual bug here:

```sh
python3 tools/headless_run.py --fold 6 --autopilot --size 390,760 \
        --shot-res 34 --shot /tmp/a.png
```

`--shot-res N` freezes and captures when the craft reaches residue N. `--shot-at T` uses
time instead. **390×760 is the phone viewport and is the one that matters.**

**Pixel-diff two builds** rather than eyeballing whether something changed. This is how the
culling decision was settled:

```python
from PIL import Image, ImageChops
a = Image.open('/tmp/a.png').convert('RGB'); b = Image.open('/tmp/b.png').convert('RGB')
d = ImageChops.difference(a, b); px = d.load(); W, H = d.size
n = sum(1 for y in range(0, H, 2) for x in range(0, W, 2) if sum(px[x, y]) > 30)
print('%.2f%% differ' % (100.0 * n / ((W // 2) * (H // 2))))
```

Under ~1% is exhaust-particle timing, not your change.

**The six checks must all pass before anything ships:**

```sh
python3 tools/acceptance.py          python3 tools/acceptance.py --oracle
python3 tools/fairness.py            node tools/phone_test.js
node tools/nogl_test.js              bash tools/chain_eval.sh
```

Also run `node tools/visual_test.js /tmp/flyer-review` for the opening/help flows, phone and
desktop screenshots, small/landscape layouts, and rendering without the index extension.
It checks the actual reached residue, including the preview's rounded-to-zero status trap.
`FLYER_BENCH=1 node tools/visual_test.js /tmp/flyer-review /absolute/path/to/build.html` measures
55 repeated frozen draws per fold (5 warmups), with a one-pixel readback to wait for GPU work.
Run builds sequentially on an otherwise quiet machine; `gl.finish()` alone understated cost.

**Camera/comfort diagnostics** (these catch rendering changes that quietly move the lens):
`window.CLIPCHK=1` gives `camIn` (frames with the lens inside drawn geometry — should stay
at 0–1 a fold) and `camTight`. `window.BUMPS=1` gives the per-frame lens-step histogram.

Good folds to test on: **1LDG** and **1M56** (dense, worst cases), **1QJ8** (67% β-sheet —
the culling case), **1MBN** (a heme), **the bundle** (clean and simple).

---

## 7. Traps specific to this repo

Every one of these cost real time.

1. **The shipped page is `tools/bundle_template.html`, not `index.html`.** The root
   `index.html` is a bare dev shell with no intro card. A whole session's worth of edits
   once went to the wrong file and silently did nothing. `python3 tools/bundle.py` writes
   `dist/` **and** `docs/index.html` (what GitHub Pages serves).
2. **Verify an edit landed.** A `str.replace` with a stale anchor is a silent no-op. This
   caused three separate wrong conclusions in one day.
3. **`ribbonPenetration()` returns an object** `{depth, ss}`, not a number. Dividing it by
   a scale gives `NaN`, and `NaN` comparisons are all false — so the measurement reports a
   confident, clean zero. `ribbonClear()` and `ribbonClearAtLeast()` return numbers/booleans.
4. **`ribbonClearAtLeast(p, thr)` is not "is the lens inside".** It is true whenever
   anything is within `thr`, which at 0.9 Å is most frames. Use `ribbonPenetration().depth`
   for penetration and `ribbonEscape()` when you need a direction out.
5. **Diagnostics acquire the scope of the bug they were written for and keep it.** One
   logged only `P.t < 2.2` — correct for an opening-frame bug, and then 2% of a 98-second
   fold for everything after. Check an instrument's range before doubting a hypothesis.
6. **Check `uptime` before believing a `phone_test` failure.** This is a shared machine;
   load has hit 60. Timing-dependent checks fail for reasons unrelated to the code.
7. **The per-frame status block sits behind the preview's early return**, so anything
   written there is stale for the 3.2 s orbit at the start of a fold.
8. **Additive draws must respect alpha.** The previous `ONE, ONE` blend ignored `uAlpha`,
   so distance-faded cofactor x-ray and ghost passes were full strength. It is now
   `SRC_ALPHA, ONE`; effect meshes already encode their own fade into vertex colours and
   use `uAlpha = 1`. Cofactor x-ray strength is 0.22, with its existing near-distance fade.

---

## 8. Next visual review

The first pass now combines AO, lighting, a coordinated palette, craft materials and interface
hierarchy. Review it in motion on a physical phone before raising tessellation or adding
effects. Keep comparing 1LDG at residues 34 and 72 and 1M56 at 120, along with the bundle's
helix interior and 1QJ8's sheet. The underlying camera/culling contracts remain the priority.
