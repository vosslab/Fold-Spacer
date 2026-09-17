// eslint.config.local.js - consumer-owned ESLint overrides.
//
// Add repo-specific ESLint config objects here: extra browser-context globs,
// per-tool globals, or local rule tweaks. This file ships once via the noexist
// bucket and is never overwritten by propagation, so your edits survive. The
// canonical eslint.config.js imports and spreads this array AFTER its own config,
// so entries here refine or override the canonical rules.
//
// Example: give two named node tools browser globals for page.evaluate() use,
// without loosening no-undef across all tools.
//
//   import globals from "globals";
//   export default [
//     {
//       files: ["tools/scene_to_png.mjs", "tools/svg_picker/**"],
//       languageOptions: { globals: { ...globals.browser } },
//     },
//   ];
//
import globals from "globals";

const browserSources = [
  "cartoon.js",
  "folds.js",
  "src/game/runtime.js",
  "gl.js",
  "music.js",
  "parse.js",
  "rail.js",
  "ss.js",
  "tools/chain_eval.js",
];

const runtimeGlobals = {
  AA1: "readonly",
  FOLDS: "readonly",
  buildRail: "readonly",
  buildRibbon: "readonly",
  createFlightAudio: "readonly",
  createRenderer: "readonly",
  helixWeight: "readonly",
  lookAt: "readonly",
  parseStructure: "readonly",
  perspective: "readonly",
  psea: "readonly",
};

export default [
  {
    // Compiled Pages output is verified through its TypeScript source and build.
    ignores: ["docs/main.js"],
  },
  {
    files: browserSources,
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...runtimeGlobals },
    },
    rules: {
      // These scripts predate the TypeScript boundary and intentionally expose
      // cross-file browser globals. New code remains strict under src/.
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-assignment": "off",
    },
  },
  {
    // These established command-line utilities are CommonJS programs even though
    // the modern application boundary is TypeScript/ES modules.
    files: ["cartoon.js", "tools/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Legacy browser-driving scripts embed expressions evaluated in the page.
    files: ["tools/**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
