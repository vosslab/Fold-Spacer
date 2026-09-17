export type RunnerMath = {
  advanceDistance: (distance: number, speed: number, deltaSeconds: number) => number;
  laneTarget: (lane: number, laneSpacing: number) => number;
  easeToward: (current: number, target: number, response: number, deltaSeconds: number) => number;
  runnerCollision: (
    playerLaneX: number,
    objectLaneX: number,
    playerDistance: number,
    objectDistance: number,
    laneTolerance: number,
    distanceTolerance: number,
  ) => number;
  residueScore: (structureCode: number, combo: number) => number;
};

type WasmNumberFunction = (...values: number[]) => number;

function requireNumberFunction(exports: WebAssembly.Exports, name: string): WasmNumberFunction {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new Error(`Rust/Wasm export is missing: ${name}`);
  }
  // WebAssembly.Exports exposes functions as Function. This assertion is isolated at the adapter.
  return value as WasmNumberFunction;
}

export async function loadRunnerMath(): Promise<RunnerMath> {
  const response = await fetch("fold_spacer_math.wasm");
  if (!response.ok) {
    throw new Error(`Could not load Rust/Wasm calculations (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {});
  const exports = result.instance.exports;

  return {
    advanceDistance: requireNumberFunction(exports, "advance_distance"),
    laneTarget: requireNumberFunction(exports, "lane_target"),
    easeToward: requireNumberFunction(exports, "ease_toward"),
    runnerCollision: requireNumberFunction(exports, "runner_collision"),
    residueScore: requireNumberFunction(exports, "residue_score"),
  };
}
