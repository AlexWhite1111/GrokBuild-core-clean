import assert from "node:assert/strict";
import test from "node:test";
import { labelColorForBackground } from "./mermaidLabelContrast.js";

test("Mermaid labels choose a readable tone for custom node fills", () => {
  assert.equal(labelColorForBackground("#3d2a1a"), "#ffffff");
  assert.equal(labelColorForBackground("rgb(26, 42, 61)"), "#ffffff");
  assert.equal(labelColorForBackground("#f3eadc"), "#111111");
  assert.equal(labelColorForBackground("rgba(61, 42, 26, .5)", "rgb(255, 255, 255)"), "#111111");
  assert.equal(labelColorForBackground("none"), null);
  assert.equal(labelColorForBackground("url(#gradient)"), null);
});
