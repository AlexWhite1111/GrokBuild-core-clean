import { randomUUID } from "node:crypto";
import {
  SystemPromptPresetSchema,
  type SystemPromptPreset,
  type SystemPromptPresetSave,
} from "../../shared/contracts.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";

export class SystemPromptPresetStore {
  constructor(private readonly state: JsonStateStore) {}

  list(): SystemPromptPreset[] {
    const values = this.state.get<unknown[]>("systemPromptPresets");
    return (Array.isArray(values) ? values : [])
      .flatMap((value) => {
        const parsed = SystemPromptPresetSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
  }

  save(input: SystemPromptPresetSave["preset"]): SystemPromptPreset {
    const values = this.list();
    const current = input.presetId ? values.find((preset) => preset.presetId === input.presetId) : undefined;
    const now = new Date().toISOString();
    const value = SystemPromptPresetSchema.parse({
      ...input,
      presetId: input.presetId ?? randomUUID(),
      pinned: input.pinned ?? current?.pinned ?? true,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
    this.state.set("systemPromptPresets", [...values.filter((preset) => preset.presetId !== value.presetId), value]);
    return value;
  }

  delete(presetId: string): void {
    this.state.set("systemPromptPresets", this.list().filter((preset) => preset.presetId !== presetId));
  }
}
