import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { TaskConfigOption, TaskSnapshot } from "../../shared/contracts.js";

function sanitizeTaskConfigOptions(options: SessionConfigOption[] | null | undefined): TaskConfigOption[] {
  return (options || []).flatMap((option) => {
    if (!option.id || !option.name) return [];
    return [{
      id: option.id,
      name: option.name,
      description: option.description || null,
      category: option.category || null,
      type: option.type,
      currentValue: option.currentValue,
      options: option.type === "select" ? flattenOptions(option.options) : [],
    }];
  });
}

export function applyTaskConfigOptions(snapshot: TaskSnapshot, options: SessionConfigOption[] | null | undefined): void {
  snapshot.configOptions = sanitizeTaskConfigOptions(options);
  const model = snapshot.configOptions.find((option) => option.category === "model");
  const effort = snapshot.configOptions.find((option) => option.category === "thought_level" || /(?:effort|reasoning)/i.test(option.id));
  if (model && typeof model.currentValue === "string") snapshot.modelId = model.currentValue;
  if (effort && typeof effort.currentValue === "string" && ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort.currentValue)) snapshot.effort = effort.currentValue as TaskSnapshot["effort"];
}

function flattenOptions(options: unknown): TaskConfigOption["options"] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.value === "string" && typeof item.name === "string") return [{ value: item.value, name: item.name, description: typeof item.description === "string" ? item.description : null }];
    return Array.isArray(item.options) ? flattenOptions(item.options) : [];
  });
}
