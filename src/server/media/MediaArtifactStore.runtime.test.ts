import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TaskMessageBlock } from "../../shared/contracts.js";
import { MediaArtifactStore } from "./MediaArtifactStore.js";

test("same-session media aliases hydrate user and assistant messages through one contract", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-session-media-"));
  const projectPath = path.join(root, "project");
  const grokHome = path.join(root, ".grok");
  const sessionId = "019f0000-0000-7000-8000-000000000031";
  const sessionRoot = path.join(
    grokHome,
    "sessions",
    encodeURIComponent(path.resolve(projectPath)),
    sessionId,
  );
  fs.mkdirSync(path.join(sessionRoot, "images"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(sessionRoot, "images", "1.jpg"), Buffer.from("session-image"));

  const store = new MediaArtifactStore({ maintenanceIntervalMs: false });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const source = "![1](images/1.jpg)";
  const messages: TaskMessageBlock[] = [
    message("user-message", "user", source),
    message("assistant-message", "assistant", source),
  ];
  store.hydrateMessages(sessionId, projectPath, messages, { grokHome, sessionId });

  for (const item of messages) {
    assert.equal(item.media?.length, 1);
    assert.equal(item.media?.[0]?.source, "local");
    assert.equal(item.media?.[0]?.mimeType, "image/jpeg");
    assert.deepEqual(item.media?.[0]?.anchor, {
      start: 0,
      end: source.length,
      sourceStart: 5,
      sourceEnd: 17,
    });
  }
  assert.equal(messages[0]?.media?.[0]?.mediaId, messages[1]?.media?.[0]?.mediaId);
  assert.deepEqual(
    fs.readFileSync(store.resolveLease(store.lease(sessionId, messages[0]!.media![0]!.mediaId).ticket).canonicalPath!),
    Buffer.from("session-image"),
  );
});

test("session media aliases do not search without the active session or escape into a sibling session", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-session-media-boundary-"));
  const projectPath = path.join(root, "project");
  const grokHome = path.join(root, ".grok");
  const activeSessionId = "019f0000-0000-7000-8000-000000000041";
  const siblingSessionId = "019f0000-0000-7000-8000-000000000042";
  const workspaceRoot = path.join(grokHome, "sessions", encodeURIComponent(path.resolve(projectPath)));
  fs.mkdirSync(path.join(workspaceRoot, activeSessionId), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, siblingSessionId, "images"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, siblingSessionId, "images", "1.jpg"), Buffer.from("sibling-image"));

  const store = new MediaArtifactStore({ maintenanceIntervalMs: false });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.deepEqual(
    store.discoverInText(activeSessionId, projectPath, "![1](images/1.jpg)"),
    [],
  );
  assert.deepEqual(
    store.discoverInText(
      activeSessionId,
      projectPath,
      `![1](../${siblingSessionId}/images/1.jpg)`,
      { grokHome, sessionId: activeSessionId },
    ),
    [],
  );
});

function message(blockId: string, role: TaskMessageBlock["role"], text: string): TaskMessageBlock {
  return {
    blockId,
    role,
    text,
    turnId: "turn",
    streaming: false,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}
