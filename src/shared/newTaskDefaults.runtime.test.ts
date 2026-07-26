import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceProjection } from "./contracts.js";
import { ProjectDefaultsSchema, TaskCreateSchema } from "./contracts.js";
import {
  resolveNewTaskDefaults,
  resolveNewTaskPermission,
} from "./newTaskDefaults.js";

type Modes = WorkspaceProjection["supervisor"]["permissionModes"];

test("new tasks use the saved permission when the runtime verifies it", () => {
  const modes: Modes = [
    { mode: "ask", available: true },
    { mode: "alwaysApprove", available: true },
  ];

  assert.equal(resolveNewTaskPermission("alwaysApprove", modes), "alwaysApprove");
});

test("a temporary capability gap resolves one task to Ask without changing the saved value", () => {
  const saved = "alwaysApprove" as const;
  const modes: Modes = [
    { mode: "ask", available: true },
    { mode: "alwaysApprove", available: false, reason: "Still connecting" },
  ];

  assert.equal(resolveNewTaskPermission(saved, modes), "ask");
  assert.equal(saved, "alwaysApprove");
});

test("task creation requires an explicit permission resolved from project defaults", () => {
  const parsed = TaskCreateSchema.safeParse({
    requestId: "3ed72d17-2fb4-4203-a161-8c4059a11f8b",
    projectId: "project-fixture",
    workMode: "normal",
    sandbox: "workspace",
    systemPrompt: null,
  });

  assert.equal(parsed.success, false);
});

test("one resolver carries every supported project default into a new task", () => {
  const modes: Modes = [
    { mode: "ask", available: true },
    { mode: "alwaysApprove", available: true },
  ];
  const preset = {
    presetId: "2d7c819d-d7a0-48d6-9cdb-c51893e98d1c",
    title: "Focused",
    rules: "Be concise.",
    systemPrompt: "Work carefully.",
    pinned: true,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };

  assert.deepEqual(resolveNewTaskDefaults({
    modelId: "grok-4.5",
    effort: "high",
    permission: "alwaysApprove",
    sandbox: "workspace",
    systemPromptPresetId: preset.presetId,
  }, modes, "grok-default", [preset]), {
    modelId: "grok-4.5",
    effort: "high",
    permission: "alwaysApprove",
    sandbox: "workspace",
    systemPrompt: {
      presetId: preset.presetId,
      title: "Focused",
      rules: "Be concise.",
      systemPrompt: "Work carefully.",
    },
  });
});

test("unsupported legacy defaults are removed while supported defaults persist", () => {
  const defaults = ProjectDefaultsSchema.parse({
    modelId: null,
    effort: null,
    workMode: "plan",
    permission: "ask",
    sandbox: "off",
    systemPromptPresetId: null,
  });

  assert.equal("workMode" in defaults, false);
  assert.deepEqual(resolveNewTaskDefaults(defaults, [
    { mode: "ask", available: true },
  ], "grok-default", []), {
    modelId: "grok-default",
    effort: null,
    permission: "ask",
    sandbox: "off",
    systemPrompt: null,
  });
});
