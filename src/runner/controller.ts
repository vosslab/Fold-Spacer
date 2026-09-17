import type { RunnerMath } from "../wasm_math";
import type {
  FoldSpacerLaneEngine,
  FoldSpacerRunner,
  HorizontalDirection,
  Lane,
} from "./contracts";
import { drawLaneOverlay } from "./overlay";

function clampLane(value: number): Lane {
  if (value <= -1) return -1;
  if (value >= 1) return 1;
  return 0;
}

export function createLaneEngine(math: RunnerMath): FoldSpacerLaneEngine {
  let lane: Lane = 0;
  return {
    kind: "rust-wasm",
    getLane: (): Lane => lane,
    setLane: (nextLane: number): Lane => {
      lane = clampLane(Math.round(nextLane));
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

export function createRunner(math: RunnerMath): FoldSpacerRunner {
  const lanes = createLaneEngine(math);
  return {
    kind: "rust-wasm",
    lanes,
    drawOverlay: drawLaneOverlay,
    shiftDirection: (direction: HorizontalDirection): Lane =>
      lanes.shift(direction === "left" ? -1 : 1),
    shiftSwipe: (deltaX: number, deltaY: number): Lane | null => {
      if (Math.abs(deltaX) < 24 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return null;
      return lanes.shift(deltaX < 0 ? -1 : 1);
    },
  };
}
