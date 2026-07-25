import assert from "node:assert/strict";
import test from "node:test";
import { inlineVisualHeightLimit, inlineVisualStageHeight, scaleVisualOffset } from "./VisualCanvasGeometry.js";

test("inline generated visuals have a bounded responsive height", () => {
  assert.equal(inlineVisualHeightLimit(300), 240);
  assert.equal(inlineVisualHeightLimit(800), 480);
  assert.equal(inlineVisualHeightLimit(2_000), 640);
  assert.equal(inlineVisualStageHeight(2_000, 32, 480), 512);
  assert.equal(inlineVisualStageHeight(200, 32, 480), 232);
});

test("pinch and wheel scaling keep the visual point under the moving anchor", () => {
  assert.deepEqual(scaleVisualOffset({
    x: 0,
    y: 0,
    fromZoom: 1,
    toZoom: 2,
    anchorX: 50,
    anchorY: -20,
  }), { x: -50, y: 20 });
  assert.deepEqual(scaleVisualOffset({
    x: 10,
    y: -5,
    fromZoom: 1,
    toZoom: 2,
    anchorX: 50,
    anchorY: 20,
    nextAnchorX: 70,
    nextAnchorY: 35,
  }), { x: -10, y: -15 });
});
