import assert from "node:assert/strict";
import test from "node:test";
import { nextMediaSizePreset } from "./mediaSizing.js";

test("media size presets cycle by rendered size rather than semantic name", () => {
  const presets = [
    { mode: "native", size: 2400 },
    { mode: "comfortable", size: 520 },
    { mode: "fill", size: 900 },
  ] as const;
  assert.equal(nextMediaSizePreset(520, presets).mode, "fill");
  assert.equal(nextMediaSizePreset(900, presets).mode, "native");
  assert.equal(nextMediaSizePreset(2400, presets).mode, "comfortable");
});

test("media size presets skip visually duplicate sizes", () => {
  const presets = [
    { mode: "native", size: 800 },
    { mode: "comfortable", size: 806 },
    { mode: "fill", size: 1200 },
  ] as const;
  assert.equal(nextMediaSizePreset(800, presets).mode, "fill");
});
