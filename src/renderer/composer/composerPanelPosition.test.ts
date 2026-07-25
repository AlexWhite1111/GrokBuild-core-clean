import assert from "node:assert/strict";
import test from "node:test";
import { composerPanelPosition } from "./composerPanelPosition.js";

test("composer popover centers on its real trigger and remains inside the shell", () => {
  assert.deepEqual(composerPanelPosition(
    { left: 100, top: 200, width: 600 },
    { left: 340, top: 430, width: 80 },
    { width: 180, height: 140 },
  ), { left: 190, top: 84 });

  assert.deepEqual(composerPanelPosition(
    { left: 100, top: 200, width: 300 },
    { left: 102, top: 430, width: 30 },
    { width: 180, height: 140 },
  ), { left: 8, top: 84 });
});
