import fs from "node:fs";

type WasmNumberFunction = (...values: number[]) => number;

function field(fields: readonly string[], index: number): string {
  const value = fields[index];
  if (value === undefined) {
    throw new Error(`Fixture field ${index} is missing`);
  }
  return value;
}

function numberField(fields: readonly string[], index: number): number {
  const value = Number(field(fields, index));
  if (!Number.isFinite(value)) {
    throw new Error(`Fixture field ${index} is not finite`);
  }
  return value;
}

function requireFunction(exports: WebAssembly.Exports, name: string): WasmNumberFunction {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new Error(`Wasm export is missing: ${name}`);
  }
  // WebAssembly.Exports uses Function; keep the callable assertion inside this adapter.
  return value as WasmNumberFunction;
}

function assertClose(actual: number, expected: number): void {
  if (Math.abs(actual - expected) >= 0.000_01) {
    throw new Error(`Wasm parity mismatch: ${actual} != ${expected}`);
  }
}

function checkLine(exports: WebAssembly.Exports, fields: readonly string[]): void {
  const operation = field(fields, 0);
  const wasmFunction = requireFunction(exports, operation);
  if (operation === "advance_distance") {
    const actual = wasmFunction(
      numberField(fields, 1),
      numberField(fields, 2),
      numberField(fields, 3),
    );
    assertClose(actual, numberField(fields, 4));
    return;
  }
  if (operation === "lane_target") {
    const actual = wasmFunction(numberField(fields, 1), numberField(fields, 2));
    assertClose(actual, numberField(fields, 3));
    return;
  }
  if (operation === "runner_collision") {
    const actual = wasmFunction(
      numberField(fields, 1),
      numberField(fields, 2),
      numberField(fields, 3),
      numberField(fields, 4),
      numberField(fields, 5),
      numberField(fields, 6),
    );
    assertClose(actual, numberField(fields, 7));
    return;
  }
  if (operation === "residue_score") {
    const actual = wasmFunction(numberField(fields, 1), numberField(fields, 2));
    assertClose(actual, numberField(fields, 3));
    return;
  }
  throw new Error(`Unknown parity operation: ${operation}`);
}

function main(): void {
  const wasmBytes = Uint8Array.from(
    fs.readFileSync("target/wasm32-unknown-unknown/release/fold_spacer_math.wasm"),
  );
  const wasmModule = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(wasmModule, {});
  const fixture = fs.readFileSync("tests/fixtures/runner_math.tsv", "utf8");
  const lines = fixture.split(/\r?\n/u).filter(function isFixtureLine(line: string): boolean {
    return line.length > 0 && !line.startsWith("#");
  });
  for (const line of lines) {
    checkLine(instance.exports, line.split(/\s+/u));
  }
  process.stdout.write(`PASS: ${lines.length} native/Wasm parity fixtures matched.\n`);
}

main();
