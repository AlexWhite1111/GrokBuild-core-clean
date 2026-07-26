import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Control } from "../../ui/components/index.js";
import type { ComposerProps, ComposerSettings } from "./composerTypes.js";
import styles from "./Composer.module.css";

export type UpPanel = "add" | "model" | "permission" | "sandbox" | "systemPrompt";
export interface ChoicePanel {
  value: string;
  choices: Array<{ value: string; label: string }>;
  locked?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function ChoiceTrigger({ panel, label, open, locked, disabled, grouped, onToggle }: {
  panel: Exclude<UpPanel, "add">;
  label: string | ReactNode;
  open: boolean;
  locked?: boolean;
  disabled?: boolean;
  grouped?: boolean;
  onToggle: (value: UpPanel | null | ((current: UpPanel | null) => UpPanel | null)) => void;
}) {
  return <Control recipe="text" hover="surface" density="compact" shape="control" className={styles.optionTrigger} data-choice-panel={panel} data-grouped={grouped || undefined} selected={open} aria-expanded={open} disabled={locked || disabled} onClick={() => onToggle((current) => current === panel ? null : panel)}><span>{label}</span>{locked && <Lock size={8} />}</Control>;
}

export function setSetting<Key extends keyof ComposerSettings>(props: ComposerProps, key: Key, value: ComposerSettings[Key]): void {
  props.onSettingsChange({ ...props.settings, [key]: value });
}

export function modelChoices(props: ComposerProps): Array<{ value: string; label: string }> {
  const option = props.taskConfigOptions?.find((item) => item.category === "model");
  return (option?.options.map((item) => ({ value: item.value, label: item.name }))
    || props.modelChoices?.map((item) => ({ value: item.id, label: item.name || item.id }))
    || props.capabilities.acp.models.map((item) => ({ value: item.id, label: item.id }))).slice(0, 100);
}

export function effortChoices(props: ComposerProps): Array<{ value: string; label: string }> {
  const option = props.taskConfigOptions?.find((item) => item.category === "thought_level" || /effort|reasoning/i.test(item.id));
  const values = option?.options.map((item) => item.value)
    || props.capabilities.acp.models.find((item) => item.id === props.settings.modelId)?.reasoningEfforts
    || [];
  return values.map((value) => ({ value, label: value }));
}

export function systemPromptLabel(value: ComposerSettings["systemPrompt"]): string {
  return value?.title || "System";
}
