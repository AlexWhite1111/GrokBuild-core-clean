import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("expanded process code detail keeps content layout without a highlighted surface", () => {
  const component = readFileSync(
    new URL("./ProcessGroup.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("./ProcessGroup.module.css", import.meta.url),
    "utf8",
  );
  const codeDetail = css.match(/\.codeDetail\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(component, /open && item\.detailFormat === "code"/);
  assert.match(component, /data-process-item-detail/);
  assert.match(codeDetail, /padding:/);
  assert.match(codeDetail, /font:/);
  assert.doesNotMatch(codeDetail, /\bbackground\s*:/);
  assert.doesNotMatch(codeDetail, /\bbox-shadow\s*:/);
});
