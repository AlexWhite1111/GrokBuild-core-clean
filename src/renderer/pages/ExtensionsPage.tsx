import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Boxes, Cable, ChevronRight, FileCode2, Puzzle, ScrollText } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ExtensionInventorySnapshot, PluginCatalogSnapshot } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { ExtensionActions, type ExtensionActionEntry } from "../extensions/ExtensionActions.js";
import { Badge, Control, Input, Notice, SegmentedControl, Surface, TabsList, TabsRoot, TabsTrigger, Text } from "../../ui/components/index.js";
import styles from "./ExtensionsPage.module.css";

const categories = [["plugins", "Plugins", Puzzle], ["mcp", "MCP", Cable], ["skills", "Skills", FileCode2], ["hooks", "Hooks", Boxes], ["agents", "Agents", Bot], ["rules", "Rules", ScrollText]] as const;

export function ExtensionsPage({ category = "plugins", basePath = "/settings/extensions" }: { category?: string; basePath?: string }) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const inventory = useQuery({ queryKey: ["management", "extensions"], queryFn: () => api.get<ExtensionInventorySnapshot>("/management/extensions") });
  const marketplace = useQuery({ queryKey: ["management", "marketplace"], queryFn: () => api.get<PluginCatalogSnapshot>("/management/marketplace"), enabled: category === "plugins" });
  const [space, setSpace] = useState<"installed" | "marketplace">("installed");
  const [query, setQuery] = useState("");
  useEffect(() => setSpace("installed"), [category]);
  const marketplaceSpace = category === "plugins" && space === "marketplace";
  const entriesPending = inventory.isPending || marketplaceSpace && marketplace.isPending;
  const entriesError = inventory.error ?? (marketplaceSpace ? marketplace.error : null);
  const entries = useMemo(() => extensionEntries(category, inventory.data, marketplaceSpace ? marketplace.data : undefined)
    .filter((entry) => `${entry.name} ${entry.source} ${entry.detail}`.toLowerCase().includes(query.toLowerCase())), [category, inventory.data, marketplace.data, marketplaceSpace, query]);
  const [selectedId, setSelectedId] = useState("");
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  return <main className={styles.page}>
    <header><Text as="h1" font="heading" size="title" weight="semibold">{t("extensionsLabel")}</Text><Text as="p" tone="muted" size="label">{t("extensionsSubtitle")}</Text></header>
    <TabsRoot value={category} className={styles.categories}><TabsList>{categories.map(([id, label, Icon]) => <TabsTrigger asChild value={id} key={id}><NavLink to={`${basePath}/${id}`}><Icon size={14} />{label}</NavLink></TabsTrigger>)}</TabsList></TabsRoot>
    <Surface className={styles.workspace} appearance="surface" elevation="content">
      <section className={styles.center}>
        <header><SegmentedControl value={space} options={category === "plugins" ? [{ value: "installed", label: t("installed") }, { value: "marketplace", label: t("marketplace") }] : [{ value: "installed", label: t("installed") }]} onChange={setSpace} /><Input appearance="surface" density="compact" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchExtensions")} aria-label={t("searchExtensions")} /></header>
        <div className={styles.list}>{entries.map((entry) => <Control recipe="row" key={entry.id} selected={selected?.id === entry.id} onClick={() => setSelectedId(entry.id)}><Badge iconOnly>{entry.icon}</Badge><span><Text as="strong" size="body" weight="medium" truncate>{entry.name}</Text><Text as="small" tone="secondary" size="caption" truncate>{entry.detail}</Text></span><span className={styles.tags}><Badge shape="pill">{entry.scope}</Badge><Badge shape="pill" tone={statusTone(entry.status)}>{entry.status}</Badge><ChevronRight size={13} /></span></Control>)}{entriesPending && <Text tone="muted" size="label" className={styles.empty}>{t("loading")}</Text>}{entriesError && <Notice tone="danger" density="compact" role="alert">{errorText(entriesError)}</Notice>}{!entriesPending && !entriesError && !entries.length && <Text tone="muted" size="label" className={styles.empty}>{t("noExtensionEntries", { category })}</Text>}</div>
      </section>
      <Surface as="aside" appearance="plain" className={styles.detail}>
        {entriesPending ? <Notice density="compact">{t("loading")}</Notice> : entriesError ? <Notice tone="danger" density="compact" role="alert">{errorText(entriesError)}</Notice> : selected ? <><div className={styles.detailHeader}><Badge iconOnly className={styles.detailIcon}>{selected.icon}</Badge><span><Text as="h2" font="heading" size="title" weight="semibold">{selected.name}</Text><Text as="p" tone="secondary" size="label">{selected.detail}</Text></span><span className={styles.detailBadges}><Badge shape="pill">{selected.scope}</Badge><Badge shape="pill" tone={statusTone(selected.status)}>{selected.status}</Badge></span></div><Surface as="section" appearance="muted" shape="control" className={styles.metadata}><Metadata label={t("scopeCanonical")} value={selected.scope} /><Metadata label={t("source")} value={selected.source} code /><Metadata label={t("status")} value={selected.status} /><Metadata label={t("editableLabel")} value={<><FileCode2 size={12} />{selected.editable ? t("yes") : t("readOnlyLabel")}</>} /></Surface></> : <Notice density="compact" className={styles.emptyDetail}>{t("createFirstExtension", { category })}</Notice>}
        {!entriesPending && !entriesError && <Notice density="compact" className={styles.boundary}>{t("extensionMutationBoundary")}</Notice>}
        {!entriesPending && !entriesError && <ExtensionActions category={category} entry={selected} marketplace={marketplaceSpace} />}
      </Surface>
    </Surface>
  </main>;
}

function Metadata({ label, value, code = false }: { label: string; value: React.ReactNode; code?: boolean }) {
  return <div><Text size="caption" tone="muted">{label}</Text><Text as="div" size="label" font={code ? "code" : "ui"}>{value}</Text></div>;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "info" {
  if (status === "Enabled" || status === "Active" || status === "Installed") return "success";
  if (status === "Disabled") return "neutral";
  if (status === "Error" || status === "Unavailable") return "warning";
  return "info";
}

function errorText(value: unknown): string { return value instanceof Error ? value.message : String(value); }

interface Entry extends ExtensionActionEntry { detail: string; source: string; icon: React.ReactNode }

function extensionEntries(category: string, inventory?: ExtensionInventorySnapshot, market?: PluginCatalogSnapshot): Entry[] {
  if (!inventory) return [];
  if (market) return market.plugins.map((item) => ({ id: `market:${item.marketplace ?? "market"}:${item.name}`, name: item.name, detail: item.description || `${item.components.skills} skills · ${item.components.commands} commands`, source: item.marketplace || "Marketplace", scope: "Available", status: item.status, editable: true, icon: <Puzzle size={16} /> }));
  if (category === "plugins") return inventory.plugins.map((item) => ({ id: item.id, name: item.name, detail: `${item.skills} skills · ${item.agents} agents · ${item.mcpServers} MCP`, source: item.relativePath ?? "Grok plugin", scope: item.scope, status: item.enabled ? "Enabled" : "Disabled", editable: item.editable, documentKind: item.editable ? "plugin" : undefined, icon: <Puzzle size={16} /> }));
  if (category === "mcp") return inventory.mcpServers.map((item) => ({ id: item.id, name: item.name, detail: `${item.transport} · ${item.environmentKeys.length} env · ${item.headerNames.length} headers`, source: item.sourceType, scope: item.scope, status: item.enabled ? "Enabled" : "Disabled", editable: item.editable, icon: <Cable size={16} /> }));
  if (category === "skills") return inventory.skills.map((item) => ({ id: item.id, name: item.name, detail: item.description, source: item.relativePath ?? item.sourceType, scope: item.scope, status: item.enabled ? "Enabled" : "Disabled", editable: item.editable, documentKind: "skill", icon: <FileCode2 size={16} /> }));
  if (category === "hooks") return inventory.hooks.map((item) => ({ id: item.id, name: item.name, detail: `${item.event} · ${item.hookType}`, source: item.relativePath ?? item.sourceType, scope: item.scope, status: item.enabled ? "Enabled" : "Disabled", editable: item.editable, documentKind: "hook", icon: <Boxes size={16} /> }));
  if (category === "agents") return inventory.agents.map((item) => ({ id: item.id, name: item.name, detail: item.description, source: item.relativePath ?? item.sourceType, scope: item.scope, status: item.enabled ? "Enabled" : "Disabled", editable: item.editable, documentKind: "agent", icon: <Bot size={16} /> }));
  return inventory.projectRules.map((item) => ({ id: item.id, name: item.name, detail: `${item.fileType} · ${item.approxTokens} tokens`, source: item.relativePath ?? item.sourceType, scope: item.scope, status: item.enabled ? "Active" : "Disabled", editable: item.editable, documentKind: "rule", icon: <ScrollText size={16} /> }));
}
