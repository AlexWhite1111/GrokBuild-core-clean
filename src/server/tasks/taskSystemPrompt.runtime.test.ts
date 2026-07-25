import assert from "node:assert/strict";
import test from "node:test";
import type { TaskMessageBlock, TaskSystemPrompt } from "../../shared/contracts.js";
import {
  buildForkContinuation,
  sameTaskSystemPrompt,
  sessionPromptMeta,
} from "./taskSystemPrompt.js";

const rules: TaskSystemPrompt = {
  presetId: "2fd1b14c-a568-4df0-ab51-96afc91e45df",
  title: "Research",
  rules: "Prefer concise experimental evidence.",
  systemPrompt: "You are a rigorous research assistant.",
};

test("session prompt metadata sends native ACP rules and override together", () => {
  assert.deepEqual(sessionPromptMeta(rules), {
    rules: ["Prefer concise experimental evidence."],
    systemPromptOverride: "You are a rigorous research assistant.",
  });
  assert.equal(sessionPromptMeta(null), undefined);
});

test("fork continuation stays a separate rule from the authored prompt", () => {
  const continuation = "Continue from the supplied transcript.";
  assert.deepEqual(sessionPromptMeta(rules, continuation), {
    rules: ["Prefer concise experimental evidence.", continuation],
    systemPromptOverride: "You are a rigorous research assistant.",
  });
  assert.deepEqual(sessionPromptMeta(null, continuation), { rules: [continuation] });
});

test("configured forks carry only visible user and final Grok text", () => {
  const messages: TaskMessageBlock[] = [
    message("user", "Question"),
    message("thought", "private process"),
    message("assistant", "Answer"),
  ];
  const value = buildForkContinuation(messages);
  assert.match(value, /USER:\nQuestion/);
  assert.match(value, /ASSISTANT:\nAnswer/);
  assert.doesNotMatch(value, /private process/);
});

test("system prompt equality compares the frozen task value", () => {
  assert.equal(sameTaskSystemPrompt(rules, { ...rules }), true);
  assert.equal(sameTaskSystemPrompt(rules, { ...rules, rules: "Different" }), false);
  assert.equal(sameTaskSystemPrompt(rules, { ...rules, systemPrompt: "Different" }), false);
  assert.equal(sameTaskSystemPrompt(null, null), true);
  assert.equal(sameTaskSystemPrompt(rules, null), false);
});

function message(role: TaskMessageBlock["role"], text: string): TaskMessageBlock {
  return {
    blockId: `${role}-${text}`,
    role,
    text,
    turnId: "turn",
    streaming: false,
    createdAt: "2026-07-20T00:00:00.000Z",
  };
}
