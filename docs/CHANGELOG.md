## 2026-09-16

### Fixes and Maintenance

- Installed the `wasm32-unknown-unknown` target in both Pages workflow sources before the production
  build, fixing the GitHub Actions Rust compilation failure.
- Recovered `game.js` from the latest intact revision after a truncated tool transcript had been
  written into the file, repaired two invalid diagnostic-path references, and restored a passing
  TypeScript, ESLint, Prettier, and Node-test gate.
- Added repository-local lint and formatting boundaries for the established browser runtime,
  CommonJS diagnostic tools, and generated Pages bundle while keeping new TypeScript source strict.
- Synchronized shared style guides, tests, and repository support files from the starter template.
- Synchronized shared style guides, tests, and repository support files from the starter template.

### Changed

- Moved the upstream WebGL runtime from the repository root to `src/game/runtime.js` and split new
  runner contracts, controls, and lane-overlay drawing into focused TypeScript modules.
- Removed the obsolete free-flight, virtual-stick, and lunge integration path; the compatibility
  runtime now follows the stable three-lane controller and is 291 lines smaller than the prior game script.
- Added an editable protein-trench SVG favicon and included it in local and Pages builds.
- Kept the full WebGL protein renderer and replaced free-flight steering with stable left, center,
  and right tracks that follow the backbone-local 3D frame.
- Turned PDB-derived ball-and-stick side chains into the obstacles: clean passes score, while visible
  atom-surface collisions break the combo and reduce speed.
- Added projected three-lane guides, keyboard lane changes, touch swipes, and updated game/help copy.
- Added a depth-anchored three-pip obstacle marker that names the next residue and explicitly marks its
  blocked left, center, or right lane while leaving the two safe lanes hollow.
- Added a strict TypeScript lane adapter backed by deterministic Rust/WebAssembly calculations, with
  native/Wasm parity fixtures and browser smoke coverage.
- Updated the production build to assemble the established WebGL renderer with the TypeScript and
  Wasm assets served by `run_web_server.sh`.
