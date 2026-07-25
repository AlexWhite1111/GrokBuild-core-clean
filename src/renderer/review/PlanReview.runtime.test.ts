import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Plan review keeps Reject, Discuss, Approve in official outcome order", () => {
  const source = readFileSync(new URL("./PlanReview.tsx", import.meta.url), "utf8");
  const reject = source.indexOf('onClick={() => void decide("abandoned")}');
  const discuss = source.indexOf('onClick={() => void decide("cancelled")}');
  const approve = source.indexOf('onClick={() => void decide("approved")}');

  assert.ok(reject >= 0 && discuss > reject && approve > discuss);
  assert.match(source, /decide\("cancelled", draft\)/);
  assert.doesNotMatch(source, /changes_requested|revisionPending/);
});

test("an official Plan Gate cannot be hidden and does not depend on gate position", () => {
  const source = readFileSync(new URL("../pages/TaskPage.tsx", import.meta.url), "utf8");

  assert.match(source, /snapshot\?\.gates\.find\(\(gate\) => gate\.kind === "planReview"\)/);
  assert.match(source, /\{planGate \|\| mainView\.kind === "plan" \? \(/);
  assert.match(source, /onClose=\{planGate \? undefined : \(\) => setMainView\(\{ kind: "thread" \}\)\}/);
  assert.doesNotMatch(source, /revisionPending/);
});
