import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type { ConfigFieldSnapshot, ConfigInventory, ConfigMutationPreview } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import { Control, Input, Notice, Surface, Switch, Text, ThemedSelect } from "../../ui/components/index.js";
import styles from "./SettingsPanels.module.css";

type ConfigValue = boolean | number | string | null;

export function ConfigSettings() {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["management", "config"], queryFn: () => api.get<ConfigInventory>("/management/config") });
  const [query, setQuery] = useState("");
  const [changes, setChanges] = useState<Record<string, ConfigValue>>({});
  const [preview, setPreview] = useState<ConfigMutationPreview | null>(null);
  const fields = useMemo(() => (config.data?.fields || []).filter((field) => `${field.label} ${field.id} ${field.description} ${field.source}`.toLowerCase().includes(query.toLowerCase())), [config.data?.fields, query]);
  const previewMutation = useMutation({ mutationFn: () => api.post<ConfigMutationPreview>("/management/config/preview", { requestId: crypto.randomUUID(), input: { changes } }), onSuccess: setPreview });
  const apply = useMutation({ mutationFn: () => api.post("/management/config/apply", { requestId: crypto.randomUUID(), input: { changes }, confirmation: preview!.token }), onSuccess: async () => { setPreview(null); setChanges({}); await client.invalidateQueries({ queryKey: ["management", "config"] }); } });
  const set = (id: string, value: ConfigValue) => setChanges((current) => ({ ...current, [id]: value }));
  return <div className={styles.stack}>
    <div className={styles.search}><Search size={14} /><Input appearance="surface" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("configSearch")} /></div>
    <Surface className={styles.configList} appearance="surface" elevation="content">{fields.map((field) => <div key={field.id}><span><Text as="strong" weight="semibold">{field.label}</Text><Text as="code" tone="info" font="code" size="caption">{field.id}</Text><Text as="small" tone="muted" size="caption">{field.description}</Text></span><div className={styles.configControl}><ConfigInput field={field} value={Object.hasOwn(changes, field.id) ? changes[field.id] : field.configuredValue ?? field.value} onChange={(value) => set(field.id, value)} /><Text as="small" tone="muted" size="caption">{field.source} · {field.applies}</Text><Control recipe="text" density="compact" aria-label={t("removeUserOverride", { id: field.id })} onClick={() => set(field.id, null)}><RotateCcw size={11} />{t("useInherited")}</Control></div></div>)}</Surface>
    {config.data && <Notice>{config.data.boundary}</Notice>}
    <Surface className={styles.pendingBar} appearance="raised" elevation="content"><Text tone="muted" size="label">{Object.keys(changes).length ? t("changesPending", { count: Object.keys(changes).length }) : t("noPendingChanges")}</Text><Control recipe="solid" disabled={!Object.keys(changes).length || previewMutation.isPending} onClick={() => previewMutation.mutate()}><SlidersHorizontal size={13} />{t("generateSemanticDiff")}</Control></Surface>
    {preview && <SemanticMutationDialog open title={t("applyGrokConfig")} changes={preview.changes.map((change) => ({ field: `${change.label} · ${change.id}`, before: change.before, after: change.after }))} warnings={preview.warnings} pending={apply.isPending} onOpenChange={(open) => { if (!open) setPreview(null); }} onApply={() => apply.mutate()} />}
  </div>;
}

function ConfigInput({ field, value, onChange }: { field: ConfigFieldSnapshot; value: ConfigValue; onChange(value: ConfigValue): void }) {
  if (field.kind === "boolean") return <Switch checked={value === true} onChange={(event) => onChange(event.target.checked)} label={value === true ? "On" : "Off"} />;
  if (field.kind === "enum") return <ThemedSelect ariaLabel={field.label} value={typeof value === "string" ? value : ""} options={field.options.map((option) => ({ value: option, label: option }))} onValueChange={onChange} />;
  return <Input type="number" min={field.min ?? undefined} max={field.max ?? undefined} step={field.kind === "integer" ? 1 : "any"} value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />;
}
