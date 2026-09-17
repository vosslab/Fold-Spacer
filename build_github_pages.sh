#!/usr/bin/env bash
# build_github_pages.sh - canonical production build for GitHub Pages.
#
# Front door: run this directly as ./build_github_pages.sh. It is the
# interface for everyone, no npm knowledge required. The npm run build
# alias is an optional mirror that points right back at this script.
#
# Contract:
#   - Wipes dist/ from scratch.
#   - Type-checks via 'tsc --noEmit -p tsconfig.json'.
#   - Resolves the entry: src/main.ts preferred, src/init.ts legacy fallback.
#     Aborts with an actionable error if neither exists.
#   - Verifies the authored WebGL shell in tools/bundle_template.html.
#   - Bundles the entry into dist/main.js with esbuild (ESM, es2020,
#     browser, minified, with sourcemap).
#   - Assembles the WebGL renderer into the authored shell.
#   - Writes dist/.nojekyll so GitHub Pages serves files starting with _.
#   - Asserts dist/index.html and dist/main.js exist before exiting.
#
# Hard rule: never produces single-file output. ESM only.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Resolve entry point.
if [ -f "src/main.ts" ]; then
	ENTRY="src/main.ts"
elif [ -f "src/init.ts" ]; then
	ENTRY="src/init.ts"
	echo "WARNING: using legacy src/init.ts. Rename to src/main.ts." >&2
else
	echo "ERROR: no entry point. Create src/main.ts (preferred) or src/init.ts." >&2
	exit 1
fi

test -f tools/bundle_template.html

rm -rf dist
mkdir -p dist

npx tsc --noEmit -p tsconfig.json

npx esbuild "$ENTRY" \
	--bundle \
	--format=esm \
	--target=es2020 \
	--platform=browser \
	--minify \
	--sourcemap \
	--outfile=dist/main.js

# Build the host-neutral Rust calculation core for the browser target.
cargo build \
	--manifest-path crates/fold_spacer_math/Cargo.toml \
	--target wasm32-unknown-unknown \
	--release \
	--target-dir target
cp target/wasm32-unknown-unknown/release/fold_spacer_math.wasm dist/fold_spacer_math.wasm

# Assemble the established WebGL protein renderer and polished game shell.
source source_me.sh
python3 tools/bundle.py
cp dist/main.js docs/main.js
cp dist/fold_spacer_math.wasm docs/fold_spacer_math.wasm
touch docs/.nojekyll
touch dist/.nojekyll

test -f dist/index.html
test -f dist/main.js
test -f dist/fold_spacer_math.wasm
test -f docs/main.js
test -f docs/fold_spacer_math.wasm

echo "Built dist/ (GitHub Pages-ready)."
