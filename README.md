# Fold Flyer

A browser tunnel-runner along a real protein backbone. Fly a glider from the N- to the
C-terminus of ten structures from the Protein Data Bank, repairing the fold as you go.

**▶ Play: https://martin-steinegger.github.io/Fold-Spacer/**

No install, no server, no build step to try it — it is one self-contained HTML file that
runs on a phone or a desktop browser.

## The game

Inside an **α-helix** you fly down the axis of the coil. Some side chains start out
pointing inward, which a real helix never does; they pulse white until you fly into one
and knock it outward into its Clustal colour. Dead centre scores double.

Over a **β-sheet** you drop into a trench run: the sheet becomes the floor, you weave
left and right, and every side chain there is yours to collect.

**Cofactors** — the heme, NADH or metal site the fold is actually built around — glow
from inside the protein. They sit 4–5 Å off the flight path, so you cannot fly through
one; instead a ring of pips marks a gate out at the corridor edge on their side, and
claiming one means hugging that wall as you pass. Five of the ten folds carry one.

A **ghost** of your best run on each fold flies alongside you.

Side chains are the real heavy atoms from the PDB entry, drawn as ball-and-stick.
Secondary structure is computed from Cα geometry, not read from the file.

## Controls

|  | keyboard | phone |
|---|---|---|
| steer | arrows or `WASD` | drag from wherever your finger lands |
| boost | `Shift` or `Space` | boost button, bottom right (or a second finger) |
| brake | `Ctrl` — turns harder while slowing | brake button, bottom left |
| barrel roll | double-tap `←` or `→` | a hard sideways flick |
| sound | `M` | sound, in the ⋯ menu |
| autopilot | `A` | ⋯ menu |
| next fold / restart | `N` / `R` | tap the finish card / ⋯ menu |
| colour scheme | `C` | ⋯ menu |

Ride the edge of the corridor and the **slipstream** builds speed. A dead-centre hit
surges you forward. A barrel roll shrugs off a wall while you are inverted.

**Drop a `.pdb` or `.cif` file anywhere on the page** to fly your own structure.

## Build

```sh
python3 tools/bundle.py     # -> docs/index.html, the page that ships
node tools/make_folds.js > folds.js   # rebuild the baked campaign from data/
```

`docs/index.html` is the published site. The repo root's `index.html` is the **dev**
page — it loads the separate `.js` files and has no intro card, so it is not what a
visitor should get.

### Checks

```sh
python3 tools/acceptance.py            # autopilot finishes every fold
python3 tools/acceptance.py --oracle   # a perfect player takes every fold at rank S
python3 tools/fairness.py              # every side chain reachable at the speed you fly
node tools/phone_test.js               # real synthesised touch, phone viewport
node tools/nogl_test.js                # a browser without WebGL says why
bash tools/chain_eval.sh               # the whole campaign in one run
```

These need a headless Chromium (`npx playwright install chromium-headless-shell`).

## Files

| file | role |
|---|---|
| `parse.js` | PDB / mmCIF Cα parser, longest chain, title, authors |
| `ss.js` | P-SEA secondary structure from Cα geometry, and helix weight |
| `rail.js` | the flight path: de-coiled, offset, subdivided, with frames and `nodeAt(s)` |
| `cartoon.js` | cartoon ribbon mesh from Cα only |
| `gl.js` | small WebGL renderer |
| `folds.js` | the ten campaign structures, baked to integers (generated) |
| `game.js` | everything else: flight, collection, camera, HUD, scoring |
| `tools/` | build, and the checks above |
| `PLAYTEST.md` | the engineering log — every measurement, and what was ruled out |
| `RENDERING.md` | handover for anyone improving the visuals: contracts, dead ends, where the wins are |

`PLAYTEST.md` is the interesting one. It records what was tried and rejected as well as
what shipped, with the numbers behind each decision.

## Credits

Structures from the **RCSB Protein Data Bank**; each fold credits its depositors and
publication on its finish card. Secondary structure by **P-SEA** (Labesse *et al.*,
1997). Side-chain colours after **Clustal X** (Thompson *et al.*, 1997).

MIT licensed — see `LICENSE`.
