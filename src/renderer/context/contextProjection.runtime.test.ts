import assert from "node:assert/strict";
import test from "node:test";
import type { TaskMessageBlock } from "../../shared/contracts.js";
import { sameTaskResourceInputs } from "./contextProjection.js";

test("text-only streaming replacements preserve context resource inputs", () => {
  const previous = message("A");
  const next = {
    ...message("AB"),
    paths: previous.paths?.map((path) => ({ ...path })),
    media: previous.media?.map((item) => ({
      ...item,
      anchor: item.anchor ? { ...item.anchor } : undefined,
    })),
  };

  assert.equal(sameTaskResourceInputs([previous], [next]), true);
  assert.equal(sameTaskResourceInputs([previous], [{
    ...next,
    media: next.media?.map((item) => ({ ...item, mediaId: "media-2" })),
  }]), false);
});

function message(text: string): TaskMessageBlock {
  return {
    blockId: "assistant",
    role: "assistant",
    text,
    turnId: "turn",
    streaming: true,
    createdAt: "2026-07-20T00:00:00.000Z",
    paths: [{
      refId: "00000000-0000-4000-8000-000000000001",
      name: "input.txt",
      kind: "generic",
      displayPath: "input.txt",
      serializedPath: "@input.txt",
      sizeBytes: 1,
      withinProject: true,
      valid: true,
      isDirectory: false,
    }],
    media: [{
      mediaId: "media-1",
      placementId: "placement-1",
      kind: "image",
      name: "figure.png",
      mimeType: "image/png",
      sizeBytes: 1,
      source: "acp",
      syntax: "structured",
      anchor: { start: 0, end: 1 },
    }],
  };
}
