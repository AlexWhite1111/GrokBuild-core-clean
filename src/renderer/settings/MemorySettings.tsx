import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, FolderTree, Search, Trash2 } from "lucide-react";
import type { MemoryFilePreview, MemoryInventory, MemoryMutationPreview, MemorySearchSnapshot } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import { RichContent } from "../thread/RichContent.js";
import { Control, Field, Input, Notice, SettingCard, Surface, Switch, Text } from "../../ui/components/index.js";
import styles from "./SettingsPanels.module.css";

type MemoryInput = Record<string, unknown>;

export function MemorySettings() {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const client = useQueryClient();
  const memory = useQuery({ queryKey: ["management", "memory"], queryFn: () => api.get<MemoryInventory>("/management/memory") });
  const [selectedId, setSelectedId] = useState("");
  const selected = selectedId || memory.data?.files[0]?.id || "";
  const file = useQuery({ queryKey: ["management", "memory-file", selected], queryFn: () => api.get<MemoryFilePreview>(`/management/memory/file/${encodeURIComponent(selected)}`), enabled: Boolean(selected) });
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const search = useQuery({ queryKey: ["management", "memory-search", searchQuery], queryFn: () => api.get<MemorySearchSnapshot>(`/management/memory/search?query=${encodeURIComponent(searchQuery)}`), enabled: Boolean(searchQuery) });
  const [input, setInput] = useState<MemoryInput | null>(null);
  const [preview, setPreview] = useState<MemoryMutationPreview | null>(null);
  const [allPhrase, setAllPhrase] = useState("");
  const previewMutation = useMutation({ mutationFn: (value: MemoryInput) => api.post<MemoryMutationPreview>("/management/memory/preview", { requestId: crypto.randomUUID(), input: value }), onSuccess: (value, variables) => { setInput(variables); setPreview(value); } });
  const apply = useMutation({ mutationFn: () => api.post("/management/memory/apply", { requestId: crypto.randomUUID(), input, confirmation: preview!.token }), onSuccess: async () => { setPreview(null); setInput(null); setAllPhrase(""); await client.invalidateQueries({ queryKey: ["management", "memory"] }); } });
  useEffect(() => { if (selected && !memory.data?.files.some((entry) => entry.id === selected)) setSelectedId(""); }, [memory.data?.files, selected]);
  const clear = (scope: "global" | "workspace" | "all") => previewMutation.mutate({ action: "clear", scope, ...(scope === "all" ? { confirmAll: allPhrase } : {}) });
  return <div className={styles.stack}>
    <SettingCard title={t("memoryScope")} description={t("memoryScopeDescription")}>
      <div className={styles.memoryActions}><Switch checked={memory.data?.status.effectiveAtNextAgentStart === true} onChange={(event) => previewMutation.mutate({ action: "set-enabled", enabled: event.target.checked })} label={t("enableMemoryNewAgents")} /><div><Control recipe="quiet" onClick={() => clear("global")}>{t("clearGlobal")}</Control><Control recipe="quiet" onClick={() => clear("workspace")}>{t("clearProject")}</Control></div><Field label={t("clearAllConfirm")}><Input value={allPhrase} onChange={(event) => setAllPhrase(event.target.value)} placeholder={t("enterClearAll")} /></Field><Control recipe="danger" disabled={allPhrase !== "CLEAR ALL"} onClick={() => clear("all")}><Trash2 size={12} />Clear All</Control></div>
    </SettingCard>
    <Surface className={styles.memoryWorkspace} appearance="surface" elevation="content">
      <aside><div className={styles.memorySearch}><Search size={12} /><Input appearance="surface" density="compact" value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setSearchQuery(searchText.trim()); }} placeholder={t("localTextSearch")} /></div><div className={styles.memoryTree}><div><FolderTree size={14} /><Text as="strong" size="label" weight="semibold">Global / Project</Text></div>{memory.data?.files.map((entry) => <Control recipe="row" key={entry.id} selected={entry.id === selected} onClick={() => setSelectedId(entry.id)}><FileText size={13} /><Text truncate>{entry.displayPath}</Text><Text as="small" tone="muted" size="micro" truncate>{entry.staleness}</Text></Control>)}</div>{search.data && <div className={styles.memoryResults}>{search.data.results.map((result) => <Control recipe="row" key={result.file.id} onClick={() => setSelectedId(result.file.id)}><Text as="strong" size="caption" weight="semibold">{result.file.displayPath}</Text><Text tone="muted" size="micro">{result.excerpt}</Text></Control>)}</div>}</aside>
      <section className={styles.memoryPreview}>{file.data ? <><header><div><Text as="strong" weight="semibold">{file.data.displayPath}</Text><Text as="small" tone="muted" size="micro">{file.data.scope} · {file.data.sizeBytes} bytes{file.data.contentTruncated ? " · truncated" : ""}</Text></div>{file.data.scope === "session" && <Control recipe="danger" onClick={() => previewMutation.mutate({ action: "delete-session", id: file.data!.id })}><Trash2 size={12} />{t("deleteMemory")}</Control>}</header><article><RichContent text={file.data.content} /></article></> : <Text tone="muted" size="label">{t("selectMemoryPreview")}</Text>}</section>
    </Surface>
    <SettingCard title={t("memoryWriteBoundary")} description={t("memoryWriteBoundaryDescription")}><Notice>{memory.data?.capabilities.hybridSearchReason || t("loading")}</Notice></SettingCard>
    {preview && <SemanticMutationDialog open title={t("confirmMemoryMutation")} target={preview.target} changes={preview.changes} warnings={preview.warnings} destructive={preview.action === "clear" || preview.action === "delete-session"} pending={apply.isPending} onOpenChange={(open) => { if (!open) setPreview(null); }} onApply={() => apply.mutate()} />}
  </div>;
}
