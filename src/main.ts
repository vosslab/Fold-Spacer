import { loadRunnerMath } from "./wasm_math";
import type { RunnerMath } from "./wasm_math";

export type Lane = -1 | 0 | 1;

export type FoldSpacerLaneEngine = {
  readonly kind: "rust-wasm";
  getLane: () => Lane;
  setLane: (lane: number) => Lane;
  shift: (direction: -1 | 1) => Lane;
  targetX: (laneSpacing: number) => number;
  easeToward: (current: number, target: number, response: number, deltaSeconds: number) => number;
  collision: (
    playerLaneX: number,
    objectLaneX: number,
    playerDistance: number,
    objectDistance: number,
    laneTolerance: number,
    distanceTolerance: number,
  ) => boolean;
};

declare global {
  interface Window {
    foldSpacerLaneEngine?: FoldSpacerLaneEngine;
    foldSpacerLaneError?: string;
  }
}

function clampLane(value: number): Lane {
  return Math.max(-1, Math.min(1, Math.round(value))) as Lane;
}

function createLaneEngine(math: RunnerMath): FoldSpacerLaneEngine {
  let lane: Lane = 0;
  return {
    kind: "rust-wasm",
    getLane: (): Lane => lane,
    setLane: (nextLane: number): Lane => {
      lane = clampLane(nextLane);
      return lane;
    },
    shift: (direction: -1 | 1): Lane => {
      lane = clampLane(lane + direction);
      return lane;
    },
    targetX: (laneSpacing: number): number => math.laneTarget(lane, laneSpacing),
    easeToward: math.easeToward,
    collision: (...values): boolean => math.runnerCollision(...values) === 1,
  };
}

async function initializeLaneEngine(): Promise<void> {
  const math = await loadRunnerMath();
  window.foldSpacerLaneEngine = createLaneEngine(math);
  window.dispatchEvent(new CustomEvent("fold-spacer-lanes-ready"));
}

void initializeLaneEngine().catch((error: unknown): void => {
  window.foldSpacerLaneError = error instanceof Error ? error.message : "Unknown Rust/Wasm error";
  window.dispatchEvent(new CustomEvent("fold-spacer-lanes-error"));
});
