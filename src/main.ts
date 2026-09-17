import { createRunner } from "./runner/controller";
import { loadRunnerMath } from "./wasm_math";
import type { FoldSpacerLaneEngine, FoldSpacerRunner } from "./runner/contracts";

export type { FoldSpacerLaneEngine, FoldSpacerRunner, Lane } from "./runner/contracts";

declare global {
  interface Window {
    foldSpacerLaneEngine?: FoldSpacerLaneEngine;
    foldSpacerLaneError?: string;
    foldSpacerRunner?: FoldSpacerRunner;
  }
}

async function initializeRunner(): Promise<void> {
  const runner = createRunner(await loadRunnerMath());
  window.foldSpacerRunner = runner;
  window.foldSpacerLaneEngine = runner.lanes;
  window.dispatchEvent(new CustomEvent("fold-spacer-lanes-ready"));
}

void initializeRunner().catch((error: unknown): void => {
  window.foldSpacerLaneError = error instanceof Error ? error.message : "Unknown Rust/Wasm error";
  window.dispatchEvent(new CustomEvent("fold-spacer-lanes-error"));
});
