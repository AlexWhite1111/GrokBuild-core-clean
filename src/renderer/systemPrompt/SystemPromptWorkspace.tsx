import { Check, Code2, Eye, FilePlus2, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RichTextRenderPolicy, SystemPromptPreset, TaskSystemPrompt } from "../../shared/contracts.js";
import { Control, Divider, Field, Input, Notice, Surface, Switch, Text, TextArea, UiIcon, WorkspaceDetail } from "../../ui/components/index.js";
import { useSystemPromptPresetIntents, useWorkspace } from "../api/hooks.js";
import { RichContent } from "../thread/RichContent.js";
import styles from "./SystemPromptWorkspace.module.css";

type Selection = "current" | "system" | "new" | string;
interface PromptDraft {
  presetId?: string;
  title: string;
  rules: string;
  systemPrompt: string;
  pinned: boolean;
}

const EMPTY_PROMPT: PromptDraft = { title: "", rules: "", systemPrompt: "", pinned: true };

export function SystemPromptWorkspace({ current, taskId, renderPolicy, mediaScale, applyDisabled = false, applyHint, onApply, onClose }: {
  current: TaskSystemPrompt | null;
  taskId?: string;
  renderPolicy?: RichTextRenderPolicy;
  mediaScale?: number;
  applyDisabled?: boolean;
  applyHint?: string;
  onApply: (prompt: TaskSystemPrompt | null) => void;
  onClose: () => void;
}) {
  const workspace = useWorkspace().data;
  const intents = useSystemPromptPresetIntents();
  const [selection, setSelection] = useState<Selection>("current");
  const [view, setView] = useState<"preview" | "source">("preview");
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_PROMPT);
  const [error, setError] = useState<string | null>(null);
  const selectedPreset = workspace.systemPromptPresets.find((preset) => preset.presetId === selection);
  const currentPreset = current && workspace.systemPromptPresets.find((preset) => preset.presetId === current.presetId);
  const systemSelected = selection === "system" || (selection === "current" && !current);
  const valid = Boolean(draft.title.trim() && (draft.systemPrompt.trim() || draft.rules.trim()));

  useEffect(() => {
    setError(null);
    if (selection === "new" || selection === "system") {
      setDraft(EMPTY_PROMPT);
      if (selection === "new") setView("source");
      return;
    }
    if (selection === "current") {
      setDraft(current ? { ...current, pinned: currentPreset?.pinned ?? true } : EMPTY_PROMPT);
      return;
    }
    const preset = workspace.systemPromptPresets.find((item) => item.presetId === selection);
    if (preset) setDraft(draftFromPreset(preset));
    else setSelection("current");
  }, [selection, current?.presetId, current?.title, current?.rules, current?.systemPrompt, currentPreset?.pinned, workspace.systemPromptPresets]);

  const save = async (apply: boolean) => {
    if (!valid) return;
    if (apply && applyDisabled) return;
    setError(null);
    try {
      const next = await intents.save.mutateAsync({
        presetId: draft.presetId,
        title: draft.title.trim(),
        rules: draft.rules.trim(),
        systemPrompt: draft.systemPrompt.trim(),
        pinned: draft.pinned,
      });
      const saved = draft.presetId
        ? next.systemPromptPresets.find((item) => item.presetId === draft.presetId)
        : next.systemPromptPresets.find((item) => item.title === draft.title.trim() && item.systemPrompt === draft.systemPrompt.trim() && item.rules === draft.rules.trim());
      if (!saved) return;
      setSelection(saved.presetId);
      if (apply) onApply(taskPrompt(saved));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async () => {
    if (!selectedPreset) return;
    setError(null);
    try {
      await intents.delete.mutateAsync(selectedPreset.presetId);
      setSelection("current");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const actions = <>
    {!systemSelected && <Control recipe="icon" density="titlebar" aria-label={view === "preview" ? "Edit Markdown" : "Preview Markdown"} title={view === "preview" ? "Edit Markdown" : "Preview Markdown"} onClick={() => setView((currentView) => currentView === "preview" ? "source" : "preview")}><UiIcon source={view === "preview" ? Code2 : Eye} /></Control>}
    <Control recipe="icon" density="titlebar" aria-label="Close" title="Close" onClick={onClose}><UiIcon source={X} /></Control>
  </>;

  return <WorkspaceDetail actions={actions}>
    <div className={styles.workspace}>
      <Surface as="aside" appearance="sidebar" shape="none" className={styles.sidebar}>
        <Text as="span" tone="secondary" size="label" weight="semibold" className={styles.sectionLabel}>Current</Text>
        <PromptRow selected={selection === "current"} title={current?.title || "System"} detail={current ? promptKind(current) : "Built-in"} onClick={() => setSelection("current")} />
        <Divider className={styles.divider} />
        <Text as="span" tone="secondary" size="label" weight="semibold" className={styles.sectionLabel}>Presets</Text>
        <PromptRow selected={selection === "system"} title="System" detail="Built-in" onClick={() => setSelection("system")} />
        <Control recipe="row" selected={selection === "new"} onClick={() => setSelection("new")}><FilePlus2 size={13} /><Text as="span" size="body" truncate>New preset</Text></Control>
        {workspace.systemPromptPresets.map((preset) => <PromptRow key={preset.presetId} selected={selection === preset.presetId} title={preset.title} detail={preset.pinned ? "Common" : promptKind(preset)} onClick={() => setSelection(preset.presetId)} />)}
      </Surface>

      <section className={styles.editor}>
        {error && <Notice tone="danger" role="alert">{error}</Notice>}
        {applyDisabled && applyHint && <Notice density="compact">{applyHint}</Notice>}
        {systemSelected ? <div className={styles.systemState}>
          <div className={styles.heading}><Text as="h1" size="title" weight="semibold">System</Text><Text as="p" tone="secondary" size="body">Use Grok’s built-in system prompt for this session.</Text></div>
          {current && <Control recipe="solid" disabled={applyDisabled} onClick={() => onApply(null)}><Check size={13} />Use System</Control>}
        </div> : <>
          <header className={styles.editorHeader}>
            <div className={styles.heading}><Text as="h1" size="title" weight="semibold">{selection === "new" ? "New preset" : draft.title || "System Prompt"}</Text><Text as="p" tone="secondary" size="body">The override replaces Grok’s built-in prompt; Rules are appended afterward.</Text></div>
            <Switch checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} label="Show in Composer" />
          </header>

          {view === "source" ? <div className={styles.fields}>
            <Field label="Title"><Input appearance="surface" value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
            <Field label="System Prompt Override" hint="Replaces Grok’s built-in system prompt for this session."><TextArea appearance="surface" minLines={10} maxLines={30} value={draft.systemPrompt} maxLength={100_000} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} /></Field>
            <Field label="Rules" hint="Additional rules appended after the built-in prompt or this override."><TextArea appearance="surface" minLines={8} maxLines={24} value={draft.rules} maxLength={100_000} onChange={(event) => setDraft({ ...draft, rules: event.target.value })} /></Field>
          </div> : <div className={styles.preview}>
            <PromptPreview title="System Prompt Override" text={draft.systemPrompt} taskId={taskId} renderPolicy={renderPolicy} mediaScale={mediaScale} />
            <PromptPreview title="Rules" text={draft.rules} taskId={taskId} renderPolicy={renderPolicy} mediaScale={mediaScale} />
          </div>}

          <footer className={styles.actions}>
            <Control recipe="solid" disabled={!valid || intents.save.isPending} onClick={() => void save(selection === "current" && !applyDisabled)}><Save size={13} />{selection === "current" && !applyDisabled ? "Save & Apply" : "Save"}</Control>
            {selection !== "current" && selection !== "new" && <Control recipe="quiet" disabled={!valid || intents.save.isPending || applyDisabled} onClick={() => void save(true)}><Check size={13} />Use</Control>}
            {selectedPreset && <Control recipe="danger" disabled={intents.delete.isPending} onClick={() => void remove()}><Trash2 size={13} />Delete</Control>}
          </footer>
        </>}
      </section>
    </div>
  </WorkspaceDetail>;
}

function PromptRow({ selected, title, detail, onClick }: { selected: boolean; title: string; detail: string; onClick: () => void }) {
  return <Control recipe="row" selected={selected} onClick={onClick}><Text as="span" size="body" truncate>{title}</Text><Text as="small" tone="secondary" size="caption">{detail}</Text></Control>;
}

function PromptPreview({ title, text, taskId, renderPolicy, mediaScale }: { title: string; text: string; taskId?: string; renderPolicy?: RichTextRenderPolicy; mediaScale?: number }) {
  return <Surface as="section" appearance="surface" elevation="content" className={styles.previewSection}>
    <Text as="h2" size="body" weight="semibold">{title}</Text>
    {text ? <RichContent taskId={taskId} text={text} renderPolicy={renderPolicy} mediaScale={mediaScale} /> : <Text as="p" tone="secondary" size="body">Empty</Text>}
  </Surface>;
}

function promptKind(value: Pick<TaskSystemPrompt, "rules" | "systemPrompt">): string {
  if (value.systemPrompt && value.rules) return "Override + Rules";
  return value.systemPrompt ? "Override" : "Rules";
}

function draftFromPreset(preset: SystemPromptPreset): PromptDraft {
  return { presetId: preset.presetId, title: preset.title, rules: preset.rules, systemPrompt: preset.systemPrompt, pinned: preset.pinned };
}

function taskPrompt(preset: SystemPromptPreset): TaskSystemPrompt {
  return { presetId: preset.presetId, title: preset.title, rules: preset.rules, systemPrompt: preset.systemPrompt };
}
