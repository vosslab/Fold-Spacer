import { expect, test } from "@playwright/test";
import type { FoldSpacerLaneEngine } from "../../src/main";

type GameStatus = {
  done: boolean;
  err: string | null;
  fixed: number;
  lane: number;
  laneEngine: string;
  missed: number;
  nextObstacle: { distance: number; lane: number; residue: string } | null;
  s: number;
  total: number;
};

declare global {
  interface Window {
    flyerStatus: () => GameStatus;
    flyerSkipPreview: () => void;
    foldSpacerLaneEngine?: FoldSpacerLaneEngine;
    frame: (deltaSeconds: number, forced?: boolean) => void;
  }
}

test("WebGL protein runner uses the Rust/Wasm three-lane controller", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A world within/i })).toBeVisible();
  await page.waitForFunction(() => window.foldSpacerLaneEngine?.kind === "rust-wasm");
  await expect(page.locator("#gl")).toBeVisible();

  await page.getByRole("button", { name: /Begin run/i }).click();
  await page.waitForFunction(() => window.flyerStatus().laneEngine === "rust-wasm");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => page.evaluate(() => window.flyerStatus().lane)).toBe(1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => page.evaluate(() => window.flyerStatus().lane)).toBe(-1);

  const status = await page.evaluate(() => window.flyerStatus());
  expect(status.err).toBeNull();
  expect(status.total).toBeGreaterThan(0);
  expect(status.nextObstacle).not.toBeNull();
  expect([-1, 0, 1]).toContain(status.nextObstacle?.lane);
});

test("real side chains resolve as avoided obstacles or collisions", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.foldSpacerLaneEngine?.kind === "rust-wasm");
  await page.getByRole("button", { name: /Begin run/i }).click();
  const status = await page.evaluate(() => {
    for (let index = 0; index < 12_000 && !window.flyerStatus().done; index += 1) {
      window.frame(1 / 60, true);
    }
    return window.flyerStatus();
  });
  expect(status.err).toBeNull();
  expect(status.done).toBe(true);
  expect(status.fixed).toBeGreaterThan(0);
  expect(status.missed).toBeGreaterThan(0);
  expect(status.fixed + status.missed).toBe(status.total);
});

test("phone swipe switches one lane while retaining the WebGL view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");
  await page.waitForFunction(() => window.foldSpacerLaneEngine?.kind === "rust-wasm");
  await page.getByRole("button", { name: /Begin run/i }).click();
  await page.evaluate(() => window.flyerSkipPreview());
  await page.waitForFunction(() => window.flyerStatus().s > 0);

  const stage = page.locator("#stage");
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await stage.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    clientX: box.x + 290,
    clientY: box.y + 380,
  });
  await stage.dispatchEvent("pointermove", {
    pointerId: 7,
    pointerType: "touch",
    clientX: box.x + 80,
    clientY: box.y + 380,
  });
  await stage.dispatchEvent("pointerup", {
    pointerId: 7,
    pointerType: "touch",
    clientX: box.x + 80,
    clientY: box.y + 380,
  });
  await expect.poll(async () => page.evaluate(() => window.flyerStatus().lane)).toBe(-1);
  await expect(page.locator("#gl")).toBeVisible();
});
