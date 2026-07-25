import assert from "node:assert/strict";
import test from "node:test";
import { shouldApplyTaskProjection } from "./taskProjectionVersion.js";

test("projection epochs reset revision ordering across actor lifetimes", () => {
  assert.equal(shouldApplyTaskProjection(
    { projectionEpoch: "runtime:old", revision: 200 },
    { projectionEpoch: "runtime:new", revision: 1 },
  ), true);
  assert.equal(shouldApplyTaskProjection(
    { projectionEpoch: "runtime:new", revision: 2 },
    { projectionEpoch: "runtime:new", revision: 1 },
  ), false);
  assert.equal(shouldApplyTaskProjection(
    { projectionEpoch: "runtime:new", revision: 2 },
    { projectionEpoch: "runtime:new", revision: 3 },
  ), true);
});
