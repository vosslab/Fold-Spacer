# Fold Spacer

Fold Spacer is a three-lane WebGL runner through real protein structures. The camera follows the
protein backbone from the N-terminus to the C-terminus; &alpha;-helices, &beta;-sheets, loops, cofactors, and
heavy-atom side chains remain the game world.

The side chains are the obstacles. Press left or right to move among three stable tracks and avoid
their ball-and-stick geometry. A clean pass builds score and combo; a collision knocks the side
chain away, breaks the combo, and costs speed.

## Play

Run the local server:

```sh
./run_web_server.sh
```

The script installs the TypeScript dependencies when needed, builds the Rust/WebAssembly lane
engine, assembles the WebGL game into `dist/`, and serves that exact production artifact.

### Controls

| Action | Keyboard | Touch |
|---|---|---|
| Switch lane | Left/Right or A/D | Swipe left/right |
| Boost | Shift or Space | Boost button |
| Brake | Ctrl | Brake button |
| Sound | M | Menu |
| Restart / next fold | R / N | Menu |

Drop a `.pdb` or `.cif` file onto the game to run through another protein structure.

## Architecture

- `game.js`, `gl.js`, `cartoon.js`, and `rail.js` preserve the mature WebGL protein renderer,
  molecular geometry, camera, and flight path.
- `src/main.ts` is the typed browser boundary for the three-lane controller.
- `crates/fold_spacer_math/` contains deterministic Rust lane interpolation and collision math,
  compiled to `fold_spacer_math.wasm`.
- `tools/bundle_template.html` owns the responsive interface and scientific explanation.
- `tools/bundle.py` assembles the renderer sources into the production page.
- `docs/index.html` is generated for GitHub Pages; `dist/index.html` is the locally served build.

## Build and verify

```sh
./build_github_pages.sh
cargo test --manifest-path crates/fold_spacer_math/Cargo.toml
node --import tsx devel/check_wasm_parity.ts
./run_playwright_tests.sh --build
```

The Playwright smoke suite checks the WebGL view, Rust/Wasm activation, keyboard and touch lane
changes, and the rule that every side-chain encounter ends as either a clean avoidance or a
collision.

## Scientific model

Side chains retain their residue identity, Clustal X colour, and PDB-derived heavy-atom geometry.
Selected side chains are deliberately displaced into one of the three tracks so they can function
as readable obstacles. Secondary structure is computed from C&alpha; geometry. This is an educational
game interpretation, not a molecular-dynamics simulation.

Structures come from the RCSB Protein Data Bank and are credited in the game. Secondary-structure
assignment follows P-SEA; residue colours follow Clustal X.

MIT licensed.
