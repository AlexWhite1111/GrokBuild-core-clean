import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, ChevronDown, ChevronUp, Download, FilePlus2, Power, RefreshCw, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExtensionDocumentDetail, ExtensionDocumentKind, ExtensionMutationPreview, McpConfigDetail } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import { Badge, Checkbox, Control, Field, Input, Notice, Surface, Text, TextArea, ThemedSelect } from "../../ui/components/index.js";
import styles from "./ExtensionActions.module.css";

export interface ExtensionActionEntry {
  id: string;
  name: string;
  scope: string;
  status: string;
  editable: boolean;
  documentKind?: ExtensionDocumentKind;
}

interface ExtensionActionsProps {
  category: string;
  entry: ExtensionActionEntry | null;
  marketplace: boolean;
}

export function ExtensionActions({ category, entry, marketplace }: ExtensionActionsProps) {
  if (category === "plugins") return <PluginActions entry={entry} marketplace={marketplace} />;
  if (category === "mcp") return <McpActions entry={entry} />;
  const kind = kindForCategory(category);
  return kind ? <DocumentActions kind={kind} entry={entry} /> : null;
}

function PluginActions({ entry, marketplace }: { entry: ExtensionActionEntry | null; marketplace: boolean }) {
  const { t } = useTranslation();
  const [pluginSource, setPluginSource] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [creating, setCreating] = useCreating(entry);
  const flow = useMutationFlow("plugin");
  const manifest = useDocumentDetail(entry, "plugin", !marketplace);
  const pluginAction = (action: "enable" | "disable" | "update" | "uninstall") => entry && flow.open({ action, name: entry.name, keepData: action === "uninstall" });
  return <div className={styles.actions}>
    {!marketplace && <><Control recipe="quiet" className={styles.expandControl} onClick={() => setCreating((value) => !value)}><FilePlus2 size={13} />{t("newExtensionDocument", { kind: "Plugin" })}{creating ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</Control>{creating && <NewDocumentForm kind="plugin" onCreated={() => setCreating(false)} />}</>}
    {marketplace ? <Surface as="section" appearance="muted" elevation="none">
      <Text as="h3" size="label" weight="semibold">{t("installFromSource")}</Text>
      <Field label={t("source")}><Input appearance="surface" value={pluginSource} onChange={(event) => setPluginSource(event.target.value)} placeholder="Git URL, user/repo, or local path" /></Field>
      <Checkbox checked={trusted} onChange={(event) => setTrusted(event.target.checked)} label={t("trustPlugin")} />
      <Control recipe="quiet" disabled={!pluginSource.trim() || !trusted} onClick={() => flow.open({ action: "install", source: pluginSource.trim(), trust: trusted })}><Download size={12} />{t("previewInstall")}</Control>
    </Surface> : entry ? <><Surface as="section" appearance="muted" elevation="none">
      <Text as="h3" size="label" weight="semibold">{t("pluginActions")}</Text>
      <Text size="caption" tone="muted">{t("pluginOfficialCliDetail")}</Text>
      <div className={styles.buttonRow}>
        <Control recipe="quiet" onClick={() => pluginAction(entry.status === "Enabled" ? "disable" : "enable")}><Power size={12} />{entry.status === "Enabled" ? t("disable") : t("enable")}</Control>
        <Control recipe="quiet" onClick={() => pluginAction("update")}><RefreshCw size={12} />{t("update")}</Control>
        <Control recipe="danger" onClick={() => pluginAction("uninstall")}><Trash2 size={12} />{t("uninstall")}</Control>
      </div>
    </Surface>{manifest.isError && <Notice tone="danger" density="compact" role="alert">{errorText(manifest.error)}</Notice>}{manifest.data && <DocumentEditor key={`${manifest.data.id}:${manifest.data.revision}`} detail={manifest.data} />}</> : null}
    <MutationFeedback flow={flow} />
  </div>;
}

function McpActions({ entry }: { entry: ExtensionActionEntry | null }) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const [creating, setCreating] = useCreating(entry);
  const editableScope = entry?.scope === "user" || entry?.scope === "project" ? entry.scope : null;
  const detail = useQuery({
    queryKey: ["management", "extension-mcp", entry?.id],
    queryFn: () => api.get<McpConfigDetail>(`/management/extensions/mcp/${encodeURIComponent(entry!.name)}?scope=${editableScope}`),
    enabled: Boolean(entry?.editable && editableScope),
  });
  return <div className={styles.actions}>
    <Control recipe="quiet" className={styles.expandControl} onClick={() => setCreating((value) => !value)}><FilePlus2 size={13} />{t("newMcpServer")}{creating ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</Control>
    {creating && <McpForm key="new-mcp" />}
    {entry && !entry.editable && <Notice density="compact">{t("extensionReadOnlySource")}</Notice>}
    {detail.isError && <Notice tone="danger" density="compact" role="alert">{errorText(detail.error)}</Notice>}
    {detail.data && <McpForm key={detail.data.id} detail={detail.data} />}
  </div>;
}

function McpForm({ detail }: { detail?: McpConfigDetail }) {
  const { t } = useTranslation();
  const [name, setName] = useState(detail?.name ?? "");
  const [scope, setScope] = useState<"user" | "project">(detail?.scope ?? "user");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">(detail?.transport ?? "stdio");
  const [target, setTarget] = useState(detail?.target ?? "");
  const [args, setArgs] = useState(detail?.args.join("\n") ?? "");
  const [enabled, setEnabled] = useState(detail?.enabled ?? true);
  const [environment, setEnvironment] = useState("");
  const [removeEnvironment, setRemoveEnvironment] = useState("");
  const [headers, setHeaders] = useState("");
  const [removeHeaders, setRemoveHeaders] = useState("");
  const [formError, setFormError] = useState("");
  const flow = useMutationFlow("mcp");
  useEffect(() => {
    if (!detail) return;
    setName(detail.name); setScope(detail.scope); setTransport(detail.transport); setTarget(detail.target ?? "");
    setArgs(detail.args.join("\n")); setEnabled(detail.enabled); setEnvironment(""); setRemoveEnvironment(""); setHeaders(""); setRemoveHeaders("");
  }, [detail]);
  const submit = (action: "add" | "remove") => {
    try {
      setFormError("");
      flow.open(action === "remove" ? { action, name: detail!.name, scope: detail!.scope } : {
        action,
        name: name.trim(),
        scope,
        transport,
        target: target.trim(),
        args: transport === "stdio" ? args.split(/\r?\n/).filter((item) => item.length > 0) : [],
        enabled,
        env: parseAssignments(environment, "="),
        removeEnvironmentKeys: splitKeys(removeEnvironment),
        headers: parseAssignments(headers, ":"),
        removeHeaderNames: splitKeys(removeHeaders),
      });
    } catch (error) { setFormError(errorText(error)); }
  };
  return <Surface as="section" appearance="muted" elevation="none">
    <Text as="h3" size="label" weight="semibold">{detail ? t("editMcpServer") : t("addMcpServer")}</Text>
    <div className={styles.row}><Field label={t("extensionName")}><Input appearance="surface" value={name} disabled={Boolean(detail)} onChange={(event) => setName(event.target.value)} placeholder="server-name" /></Field><Field label={t("scopeLabel")}><ThemedSelect ariaLabel={t("scopeLabel")} disabled={Boolean(detail)} value={scope} options={[{ value: "user", label: t("userScope") }, { value: "project", label: t("projectScope") }]} onValueChange={(value) => setScope(value as typeof scope)} /></Field></div>
    <div className={`${styles.row} ${styles.targetRow}`}><Field label={t("transportLabel")}><ThemedSelect ariaLabel={t("transportLabel")} value={transport} options={["stdio", "http", "sse"].map((value) => ({ value, label: value }))} onValueChange={(value) => setTransport(value as typeof transport)} /></Field><Field label={t("targetLabel")}><Input appearance="surface" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={detail?.targetConfigured && !detail.target ? t("storedTargetPlaceholder") : transport === "stdio" ? "command" : "https://…"} /></Field></div>
    {transport === "stdio" && <Field label={t("oneArgPerLine")}><TextArea appearance="surface" className={styles.codeInput} minLines={3} maxLines={8} value={args} onChange={(event) => setArgs(event.target.value)} /></Field>}
    <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} label={t("enabledAfterSave")} />
    {detail && <SecretKeyList title={t("configuredEnvironmentKeys")} values={detail.environmentKeys} />}
    <Field label={t("writeOnlyEnvironment")}><TextArea appearance="surface" className={styles.codeInput} minLines={2} maxLines={6} value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="TOKEN=${TOKEN}" /></Field>
    {detail && <Input appearance="surface" value={removeEnvironment} onChange={(event) => setRemoveEnvironment(event.target.value)} placeholder={t("removeEnvironmentKeys")} aria-label={t("removeEnvironmentKeys")} />}
    {detail && <SecretKeyList title={t("configuredHeaderNames")} values={detail.headerNames} />}
    <Field label={t("writeOnlyHeaders")}><TextArea appearance="surface" className={styles.codeInput} minLines={2} maxLines={6} value={headers} onChange={(event) => setHeaders(event.target.value)} placeholder="Authorization: Bearer ${TOKEN}" /></Field>
    {detail && <Input appearance="surface" value={removeHeaders} onChange={(event) => setRemoveHeaders(event.target.value)} placeholder={t("removeHeaderNames")} aria-label={t("removeHeaderNames")} />}
    <Text size="caption" tone="muted">{t("mcpWriteOnlyHint")}</Text>
    <div className={styles.buttonRow}><Control recipe="quiet" disabled={!name.trim() || (!target.trim() && !detail?.targetConfigured)} onClick={() => submit("add")}><Cable size={12} />{detail ? t("previewSave") : t("previewMcp")}</Control>{detail && <Control recipe="danger" onClick={() => submit("remove")}><Trash2 size={12} />{t("remove")}</Control>}</div>
    {formError && <Notice tone="danger" density="compact" role="alert">{formError}</Notice>}
    <MutationFeedback flow={flow} />
  </Surface>;
}

function SecretKeyList({ title, values }: { title: string; values: string[] }) {
  return <div className={styles.secretList}><Text size="caption" tone="muted">{title}</Text><span>{values.length ? values.map((value) => <Badge shape="pill" key={value}>{value}</Badge>) : <Text size="caption" tone="muted">—</Text>}</span></div>;
}

function DocumentActions({ kind, entry }: { kind: ExtensionDocumentKind; entry: ExtensionActionEntry | null }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useCreating(entry);
  const detail = useDocumentDetail(entry, kind);
  return <div className={styles.actions}>
    <Control recipe="quiet" className={styles.expandControl} onClick={() => setCreating((value) => !value)}><FilePlus2 size={13} />{t("newExtensionDocument", { kind: kindLabel(kind) })}{creating ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</Control>
    {creating && <NewDocumentForm kind={kind} onCreated={() => setCreating(false)} />}
    {entry && !entry.editable && <Notice density="compact">{t("extensionReadOnlySource")}</Notice>}
    {detail.isError && <Notice tone="danger" density="compact" role="alert">{errorText(detail.error)}</Notice>}
    {detail.data && <DocumentEditor key={`${detail.data.id}:${detail.data.revision}`} detail={detail.data} />}
  </div>;
}

function NewDocumentForm({ kind, onCreated }: { kind: ExtensionDocumentKind; onCreated(): void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [content, setContent] = useState("");
  const flow = useMutationFlow("document", onCreated);
  const changeName = (value: string) => { setName(value); if (!content.trim()) setContent(documentTemplate(kind, value || "new-extension")); };
  return <Surface as="section" appearance="muted" elevation="none">
    <Text as="h3" size="label" weight="semibold">{t("createExtensionDocument", { kind: kindLabel(kind) })}</Text>
    <div className={styles.row}><Field label={t("extensionName")}><Input appearance="surface" value={name} onChange={(event) => changeName(event.target.value)} placeholder="lowercase-kebab-name" /></Field><Field label={t("scopeLabel")}><ThemedSelect ariaLabel={t("scopeLabel")} value={scope} options={[{ value: "user", label: t("userScope") }, { value: "project", label: t("projectScope") }]} onValueChange={(value) => setScope(value as typeof scope)} /></Field></div>
    <Field label={t("documentContent")}><TextArea appearance="surface" className={styles.documentEditor} minLines={12} maxLines={30} value={content} onChange={(event) => setContent(event.target.value)} /></Field>
    <Control recipe="quiet" disabled={!name.trim() || kind !== "rule" && !content.trim()} onClick={() => flow.open({ action: "create", kind, name: name.trim(), scope, content })}><FilePlus2 size={12} />{t("previewCreate")}</Control>
    <MutationFeedback flow={flow} />
  </Surface>;
}

function DocumentEditor({ detail }: { detail: ExtensionDocumentDetail }) {
  const { t } = useTranslation();
  const [content, setContent] = useState(detail.content);
  const flow = useMutationFlow("document");
  useEffect(() => setContent(detail.content), [detail.content]);
  const base = { kind: detail.kind, id: detail.id, expectedRevision: detail.revision };
  return <Surface as="section" appearance="muted" elevation="none">
    <div className={styles.editorTitle}><span><Text as="h3" size="label" weight="semibold">{t("editExtensionDocument", { kind: kindLabel(detail.kind) })}</Text><Text size="caption" tone="muted" font="code">{detail.relativePath}</Text></span><Badge shape="pill">{detail.language}</Badge></div>
    {detail.writeOnlyValuesRedacted && <Notice tone="warning" density="compact">{t("writeOnlyValuesRedacted")}</Notice>}
    <Field label={t("documentContent")}><TextArea appearance="surface" className={styles.documentEditor} minLines={14} maxLines={36} value={content} onChange={(event) => setContent(event.target.value)} /></Field>
    <div className={styles.buttonRow}>
      <Control recipe="quiet" disabled={content === detail.content} onClick={() => flow.open({ ...base, action: "save", content })}><Save size={12} />{t("previewSave")}</Control>
      {detail.kind !== "plugin" && <Control recipe="quiet" onClick={() => flow.open({ ...base, action: "toggle", enabled: !detail.enabled })}><Power size={12} />{detail.enabled ? t("disable") : t("enable")}</Control>}
      {detail.kind !== "plugin" && <Control recipe="danger" onClick={() => flow.open({ ...base, action: "delete" })}><Trash2 size={12} />{t("remove")}</Control>}
    </div>
    <MutationFeedback flow={flow} />
  </Surface>;
}

interface MutationFlow {
  open(input: Record<string, unknown>): void;
  close(): void;
  apply(): void;
  preview: ExtensionMutationPreview | null;
  previewPending: boolean;
  applyPending: boolean;
  error: unknown;
}

function useCreating(entry: ExtensionActionEntry | null) {
  const state = useState(!entry);
  useEffect(() => { if (entry) state[1](false); }, [entry?.id]);
  return state;
}

function useDocumentDetail(entry: ExtensionActionEntry | null, kind: ExtensionDocumentKind, enabled = true) {
  const { api } = useBootstrap();
  return useQuery({
    queryKey: ["management", "extension-document", entry?.id],
    queryFn: () => api.get<ExtensionDocumentDetail>(`/management/extensions/document/${entry!.id}`),
    enabled: Boolean(enabled && entry?.editable && entry.documentKind === kind),
  });
}

function useMutationFlow(endpoint: "plugin" | "mcp" | "document", onApplied?: () => void): MutationFlow {
  const { api } = useBootstrap();
  const client = useQueryClient();
  const [pendingInput, setPendingInput] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<ExtensionMutationPreview | null>(null);
  const previewMutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.post<ExtensionMutationPreview>(`/management/extensions/${endpoint}/preview`, { requestId: crypto.randomUUID(), input }),
    onSuccess: (value, input) => { setPreview(value); setPendingInput(input); },
  });
  const applyMutation = useMutation({
    mutationFn: () => api.post(`/management/extensions/${endpoint}/apply`, { requestId: crypto.randomUUID(), input: pendingInput, confirmation: preview!.token }),
    onSuccess: async () => {
      setPreview(null); setPendingInput(null);
      await client.invalidateQueries({ queryKey: ["management", "extensions"] });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["management", "marketplace"] }),
        client.invalidateQueries({ queryKey: ["management", "extension-document"] }),
        client.invalidateQueries({ queryKey: ["management", "extension-mcp"] }),
      ]);
      onApplied?.();
    },
  });
  return {
    open: (input) => { previewMutation.reset(); applyMutation.reset(); previewMutation.mutate(input); },
    close: () => { previewMutation.reset(); applyMutation.reset(); setPreview(null); setPendingInput(null); },
    apply: () => applyMutation.mutate(),
    preview,
    previewPending: previewMutation.isPending,
    applyPending: applyMutation.isPending,
    error: previewMutation.error ?? applyMutation.error,
  };
}

function MutationFeedback({ flow }: { flow: MutationFlow }) {
  if (!flow.preview && !flow.error && !flow.previewPending) return null;
  return <>
    {flow.previewPending && <Text size="caption" tone="muted">Preparing semantic diff…</Text>}
    {flow.error && <Notice tone="danger" density="compact" role="alert">{errorText(flow.error)}</Notice>}
    {flow.preview && <SemanticMutationDialog open title={`${flow.preview.domain.toUpperCase()} · ${flow.preview.action}`} target={flow.preview.target} changes={flow.preview.changes} warnings={flow.preview.warnings} destructive={flow.preview.action === "uninstall" || flow.preview.action === "remove" || flow.preview.action === "delete"} pending={flow.applyPending} onOpenChange={(open) => { if (!open) flow.close(); }} onApply={flow.apply} />}
  </>;
}

function kindForCategory(category: string): ExtensionDocumentKind | null {
  if (category === "skills") return "skill";
  if (category === "hooks") return "hook";
  if (category === "agents") return "agent";
  if (category === "rules") return "rule";
  return null;
}

function kindLabel(kind: ExtensionDocumentKind): string { return ({ plugin: "Plugin", skill: "Skill", hook: "Hook", agent: "Agent", rule: "Rule" })[kind]; }

function documentTemplate(kind: ExtensionDocumentKind, name: string): string {
  if (kind === "plugin") return `${JSON.stringify({ name, version: "0.1.0", description: "Plugin description" }, null, 2)}\n`;
  if (kind === "hook") return `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo ready", timeout: 5 }] }] } }, null, 2)}\n`;
  if (kind === "rule") return `# ${name}\n\n- Add project instructions here.\n`;
  return `---\nname: ${name}\ndescription: Describe when this ${kind} should be used.\n---\n\n# ${name}\n\nAdd ${kind} instructions here.\n`;
}

function parseAssignments(value: string, separator: "=" | ":"): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const index = line.indexOf(separator);
    if (index <= 0) throw new Error(`Expected KEY${separator}value on each line`);
    const key = line.slice(0, index).trim();
    const item = line.slice(index + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key) || !item) throw new Error(`Invalid key: ${key}`);
    output[key] = item;
  }
  return output;
}

function splitKeys(value: string): string[] { return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean); }
function errorText(value: unknown): string { return value instanceof Error ? value.message : String(value); }
