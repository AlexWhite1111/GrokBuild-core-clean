import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Plus, Save, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CustomModelInventory, CustomModelMutationPreview, CustomModelSummary } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import { Checkbox, Control, Field, Input, Notice, Surface, Text, ThemedSelect } from "../../ui/components/index.js";
import styles from "./CustomModelsPanel.module.css";

interface Draft {
  name: string;
  scope: "user" | "project";
  modelId: string;
  displayName: string;
  description: string;
  baseUrl: string;
  envKey: string;
  apiBackend: "chat_completions" | "responses" | "messages";
  contextWindow: string;
  apiKey: string;
  clearApiKey: boolean;
}

export function CustomModelsPanel() {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const client = useQueryClient();
  const inventory = useQuery({ queryKey: ["management", "custom-models"], queryFn: () => api.get<CustomModelInventory>("/management/custom-models") });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = useMemo(() => inventory.data?.models.find((model) => key(model) === selectedKey) || null, [inventory.data, selectedKey]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [pendingInput, setPendingInput] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<CustomModelMutationPreview | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  useEffect(() => {
    setDraft(selected ? fromModel(selected) : emptyDraft());
    setDiagnostic(null);
  }, [selectedKey, inventory.data]);

  const previewMutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.post<CustomModelMutationPreview>("/management/custom-models/preview", { requestId: crypto.randomUUID(), input }),
    onSuccess: (value, input) => {
      setPendingInput(input);
      setPreview(value);
    },
  });
  const apply = useMutation({
    mutationFn: () => api.post("/management/custom-models/apply", { requestId: crypto.randomUUID(), input: pendingInput, confirmation: preview!.token }),
    onSuccess: async () => {
      const deleted = preview?.action === "delete";
      setPreview(null);
      setPendingInput(null);
      if (deleted) setSelectedKey(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["management", "custom-models"] }),
        client.invalidateQueries({ queryKey: ["management", "account"] }),
        client.invalidateQueries({ queryKey: ["capabilities"] }),
      ]);
    },
  });
  const diagnose = useMutation({
    mutationFn: (name: string) => api.get<{ found: boolean; defaultModel: string | null; error: string | null }>(`/management/custom-models/${encodeURIComponent(name)}/diagnose`),
    onSuccess: (value) => setDiagnostic(value.error || (value.found ? t("modelFound", { default: value.defaultModel || "none" }) : t("modelNotFound"))),
  });
  const saveInput = () => ({
    action: "save",
    scope: draft.scope,
    name: draft.name.trim(),
    modelId: draft.modelId.trim(),
    displayName: draft.displayName.trim() || undefined,
    description: draft.description.trim() || undefined,
    baseUrl: draft.baseUrl.trim() || undefined,
    envKey: draft.envKey.trim() || undefined,
    apiBackend: draft.apiBackend,
    contextWindow: draft.contextWindow ? Number(draft.contextWindow) : undefined,
    apiKey: draft.apiKey || undefined,
    clearApiKey: draft.clearApiKey,
  });

  return <Surface className={styles.panel} appearance="surface" elevation="content">
    <Surface as="aside" appearance="sidebar" shape="none">
      <header>
        <Text as="strong" weight="semibold">{t("customModels")}</Text>
        <Control recipe="quiet" onClick={() => { setSelectedKey(null); setDraft(emptyDraft()); }}><Plus size={13} />{t("newModel")}</Control>
      </header>
      <div>
        {inventory.data?.models.map((model) => <Control recipe="row" key={key(model)} selected={key(model) === selectedKey} onClick={() => setSelectedKey(key(model))}>
          <span><Text as="strong" size="label" weight="semibold" truncate>{model.displayName || model.name}</Text><Text as="small" tone="muted" size="micro" truncate>{model.scope} · {model.modelId || "unset"}</Text></span>
          {inventory.data.defaults[model.scope] === model.name && <Star size={12} fill="currentColor" />}
        </Control>)}
        {!inventory.data?.models.length && <Text as="p" tone="muted" size="caption">{t("noCustomModels")}</Text>}
      </div>
    </Surface>
    <section>
      <header><div><Text as="strong" weight="semibold">{selected ? selected.displayName || selected.name : t("newModel")}</Text><Text as="small" tone="muted" size="micro">{selected ? `${selected.scope} · ${selected.apiKeyConfigured ? t("secretConfigured") : t("secretUnset")}` : t("customModelWriteOnly")}</Text></div></header>
      <div className={styles.form}>
        <Field label={t("customModelName")}><Input disabled={Boolean(selected)} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="local-model" /></Field>
        <Field label={t("scopeLabel")}><ThemedSelect ariaLabel={t("scopeLabel")} disabled={Boolean(selected)} value={draft.scope} options={[{ value: "user", label: t("userScope") }, { value: "project", label: t("projectScope") }]} onValueChange={(value) => setDraft({ ...draft, scope: value as Draft["scope"] })} /></Field>
        <Field label={t("modelIdLabel")}><Input value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} /></Field>
        <Field label={t("displayNameLabel")}><Input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></Field>
        <Field className={styles.wide} label={t("descriptionLabel")}><Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
        <Field className={styles.wide} label={t("baseUrlLabel")}><Input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="http://127.0.0.1:11434/v1" /></Field>
        <Field label={t("apiBackendLabel")}><ThemedSelect ariaLabel={t("apiBackendLabel")} value={draft.apiBackend} options={["chat_completions", "responses", "messages"].map((value) => ({ value, label: value }))} onValueChange={(value) => setDraft({ ...draft, apiBackend: value as Draft["apiBackend"] })} /></Field>
        <Field label={t("contextWindowLabel")}><Input type="number" value={draft.contextWindow} onChange={(event) => setDraft({ ...draft, contextWindow: event.target.value })} /></Field>
        <Field label={t("environmentKeyLabel")}><Input value={draft.envKey} onChange={(event) => setDraft({ ...draft, envKey: event.target.value })} placeholder="LOCAL_API_KEY" /></Field>
        <Field label={t("apiKeyLabel")}><Input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, clearApiKey: false })} placeholder={selected?.apiKeyConfigured ? t("replaceSecret") : t("writeOnlySecret")} /></Field>
        {selected?.apiKeyConfigured && <Checkbox className={styles.check} checked={draft.clearApiKey} onChange={(event) => setDraft({ ...draft, clearApiKey: event.target.checked, apiKey: "" })} label={t("clearStoredSecret")} />}
      </div>
      {diagnostic && <Notice className={styles.diagnostic}>{diagnostic}</Notice>}
      <footer>
        {selected && <>
          <Control recipe="quiet" onClick={() => diagnose.mutate(selected.name)}><Activity size={13} />{t("diagnose")}</Control>
          <Control recipe="quiet" onClick={() => previewMutation.mutate({ action: "set-default", scope: selected.scope, name: selected.name })}><Star size={13} />{t("setDefault")}</Control>
          <Control recipe="danger" onClick={() => previewMutation.mutate({ action: "delete", scope: selected.scope, name: selected.name })}><Trash2 size={13} />{t("delete")}</Control>
        </>}
        <Control recipe="solid" className={styles.primary} disabled={!draft.name.trim() || !draft.modelId.trim()} onClick={() => previewMutation.mutate(saveInput())}><Save size={13} />{t("previewSave")}</Control>
      </footer>
    </section>
    {preview && <SemanticMutationDialog open title={`${t("customModels")} · ${preview.action}`} target={preview.relativeTarget} changes={preview.changes} warnings={preview.warnings} destructive={preview.action === "delete"} pending={apply.isPending} onOpenChange={(open) => { if (!open) setPreview(null); }} onApply={() => apply.mutate()} />}
  </Surface>;
}

function key(model: CustomModelSummary): string { return `${model.scope}:${model.name}`; }
function emptyDraft(): Draft { return { name: "", scope: "user", modelId: "", displayName: "", description: "", baseUrl: "", envKey: "", apiBackend: "chat_completions", contextWindow: "", apiKey: "", clearApiKey: false }; }
function fromModel(model: CustomModelSummary): Draft { return { name: model.name, scope: model.scope, modelId: model.modelId || "", displayName: model.displayName || "", description: model.description || "", baseUrl: model.baseUrl || "", envKey: model.envKey || "", apiBackend: model.apiBackend, contextWindow: model.contextWindow?.toString() || "", apiKey: "", clearApiKey: false }; }
