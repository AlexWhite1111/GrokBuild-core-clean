import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_UI_PREFERENCES } from "../../shared/contracts.js";
import { JsonStateStore } from "./JsonStateStore.js";
import { UiStateStore } from "./UiStateStore.js";

test("legacy corner scale migrates once to a direct pixel radius", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grok-ui-state-"));
  try {
    const state = new JsonStateStore(path.join(root, "app-state.json"));
    const legacy = {
      ...DEFAULT_UI_PREFERENCES,
      cornerScale: 179,
    } as Record<string, unknown>;
    delete legacy.cornerRadius;
    state.set("ui.preferences", legacy);

    const preferences = new UiStateStore(state).preferences();
    assert.equal(preferences.cornerRadius, 27);

    const persisted = state.get<Record<string, unknown>>("ui.preferences");
    assert.equal(persisted?.cornerRadius, 27);
    assert.equal(persisted?.cornerScale, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("older UI preferences receive the canonical code preview policy", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grok-ui-state-"));
  try {
    const state = new JsonStateStore(path.join(root, "app-state.json"));
    const stored = { ...DEFAULT_UI_PREFERENCES } as Record<string, unknown>;
    delete stored.codePreview;
    delete stored.streamingFrameIntervalMs;
    state.set("ui.preferences", stored);

    const preferences = new UiStateStore(state).preferences();
    assert.deepEqual(preferences.codePreview, {
      interactive: true,
      languages: { html: true, css: true, javascript: true, typescript: true },
    });
    assert.equal(preferences.streamingFrameIntervalMs, 50);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy streaming refresh rates migrate to equivalent frame intervals", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grok-ui-state-"));
  try {
    const state = new JsonStateStore(path.join(root, "app-state.json"));
    const uiState = new UiStateStore(state);
    for (const [refreshHz, intervalMs] of [
      [10, 100],
      [15, 67],
      [20, 50],
      [30, 33],
      [60, 17],
    ] as const) {
      const legacy = {
        ...DEFAULT_UI_PREFERENCES,
        streamingRefreshHz: refreshHz,
      } as Record<string, unknown>;
      delete legacy.streamingFrameIntervalMs;
      state.set("ui.preferences", legacy);

      assert.equal(uiState.preferences().streamingFrameIntervalMs, intervalMs);
      const persisted = state.get<Record<string, unknown>>("ui.preferences");
      assert.equal(persisted?.streamingFrameIntervalMs, intervalMs);
      assert.equal(persisted?.streamingRefreshHz, undefined);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("transferDraft moves a new-task draft to the official task key", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grok-ui-state-"));
  try {
    const uiState = new UiStateStore(new JsonStateStore(path.join(root, "app-state.json")));
    uiState.saveDraft("new:window-1", "{\"text\":\"queued draft\"}");

    assert.deepEqual(
      uiState.transferDraft("new:window-1", "task:official-session"),
      { document: "{\"text\":\"queued draft\"}" },
    );
    assert.deepEqual(uiState.draft("new:window-1"), { document: null });
    assert.deepEqual(uiState.draft("task:official-session"), {
      document: "{\"text\":\"queued draft\"}",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saving identical UI state does not replace the atomic state file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grok-ui-state-"));
  try {
    const file = path.join(root, "app-state.json");
    const state = new JsonStateStore(file);
    const value = { followLatest: true, itemId: null, fallbackIndex: 0, offset: 0 };
    state.set("task.ui.official", value);
    const inode = statSync(file).ino;

    state.set("task.ui.official", structuredClone(value));

    assert.equal(statSync(file).ino, inode);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
