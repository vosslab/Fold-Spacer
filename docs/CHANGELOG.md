## 2026-09-16

### Fixes and Maintenance

- Synchronized shared style guides, tests, and repository support files from the starter template.
- Synchronized shared style guides, tests, and repository support files from the starter template.

### Changed

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
