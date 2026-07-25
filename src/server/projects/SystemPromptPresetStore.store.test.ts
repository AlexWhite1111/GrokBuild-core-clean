import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStateStore } from "../storage/JsonStateStore.js";
import { SystemPromptPresetStore } from "./SystemPromptPresetStore.js";

test("system prompt presets persist in non-conversation app state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-system-prompt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "app-state.json");
  const presets = new SystemPromptPresetStore(new JsonStateStore(file));
  const saved = presets.save({
    title: "Research",
    rules: "Prefer reproducible evidence.",
    systemPrompt: "You are a research assistant.",
  });
  assert.equal(saved.pinned, true);
  assert.deepEqual(new SystemPromptPresetStore(new JsonStateStore(file)).list(), [saved]);
  presets.delete(saved.presetId);
  assert.deepEqual(presets.list(), []);
});
