import assert from "node:assert/strict";
import test from "node:test";
import { matplotlibInteractivePage } from "./MatplotlibInteractivePage.js";

test("interactive Matplotlib documents are compatible with opaque-origin iframe isolation", () => {
  const html = matplotlibInteractivePage({
    runId: "00000000-0000-4000-8000-000000000001",
    token: "A".repeat(43),
    figureId: 7,
    detail: false,
    animated: true,
  });

  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /event\.source !== parent/);
  assert.match(html, /parent\.postMessage\([^\n]+, '\*'\)/);
  assert.doesNotMatch(html, /event\.origin !== location\.origin/);
  assert.doesNotMatch(html, /postMessage\([^\n]+location\.origin\)/);
});
