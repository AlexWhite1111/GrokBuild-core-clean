import assert from "node:assert/strict";
import test from "node:test";
import { withAcpStageDeadline } from "./OfficialAcpClient.js";

test("an ACP activation hard limit reports the exact stalled stage", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const operation = withAcpStageDeadline(new Promise<never>(() => undefined), "initialize", 120_000);
  const rejection = assert.rejects(
    operation,
    /Grok ACP initialize did not complete within 120 seconds/,
  );

  t.mock.timers.tick(119_999);
  await Promise.resolve();
  t.mock.timers.tick(1);
  await rejection;
});
