import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Folder, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TaskSearchResult } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { useProjectIntents, useWorkspace } from "../api/hooks.js";
import { Control, Input, Modal, Spinner, Text } from "../../ui/components/index.js";
import styles from "./CommandPalette.module.css";

type PaletteResult =
  | { id: string; kind: "project"; label: string; detail: string }
  | { id: string; kind: "task"; label: string; detail: string; projectName: string };

export function CommandPalette({ mode, onClose }: { mode: "commands" | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const navigate = useNavigate();
  const workspace = useWorkspace().data;
  const projects = useProjectIntents();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [matches, setMatches] = useState<TaskSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);

  useEffect(() => {
    if (!mode) return;
    setQuery("");
    setSelected(0);
    setMatches([]);
    setSearching(false);
  }, [mode]);
  useEffect(() => {
    const sequence = ++searchSequence.current;
    const normalized = query.trim();
    if (!mode || !normalized) {
      setMatches((current) => current.length ? [] : current);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api.get<{ results: TaskSearchResult[] }>(`/search?query=${encodeURIComponent(normalized)}`)
        .then((value) => { if (sequence === searchSequence.current) setMatches(value.results); })
        .catch(() => { if (sequence === searchSequence.current) setMatches([]); })
        .finally(() => { if (sequence === searchSequence.current) setSearching(false); });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [api, mode, query]);

  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo<PaletteResult[]>(() => {
    if (!normalized) return [...workspace.tasks]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 12)
      .map((task) => ({ id: task.taskId, kind: "task", label: task.title, detail: task.naturalStatus || task.status, projectName: projectName(workspace.projects, task.projectId) }));
    const projectMatches: PaletteResult[] = workspace.projects
      .filter((project) => `${project.name} ${project.displayPath}`.toLocaleLowerCase().includes(normalized))
      .map((project) => ({ id: project.projectId, kind: "project", label: project.name, detail: project.displayPath }));
    const taskMatches: PaletteResult[] = matches.map((result) => ({
      id: result.task.taskId,
      kind: "task",
      label: result.task.title,
      detail: result.match === "prompt" ? result.excerpt || t("promptMatch") : t("titleMatch"),
      projectName: result.projectName,
    }));
    return [...projectMatches, ...taskMatches].slice(0, 60);
  }, [matches, normalized, t, workspace.projects, workspace.tasks]);
  useEffect(() => setSelected((value) => Math.min(value, Math.max(0, results.length - 1))), [results.length]);

  const choose = async (result: PaletteResult) => {
    if (result.kind === "project") {
      await projects.activate.mutateAsync(result.id);
      navigate("/new");
    } else navigate(`/tasks/${result.id}`);
    onClose();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((value) => results.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0);
    } else if (event.key === "Enter" && results[selected]) {
      event.preventDefault();
      void choose(results[selected]);
    }
  };

  return <Modal open={mode !== null} onOpenChange={(open) => { if (!open) onClose(); }} title={t("searchTitle")} titleHidden kind="palette" placement="top" size="wide">
    <div className={styles.search}><Search size={17} /><Input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={onKeyDown} placeholder={t("commandSearchPlaceholder")} />{searching && <Spinner size="compact" />}</div>
    {!normalized && results.length > 0 && <Text as="div" className={styles.hint} tone="muted" size="caption">{t("recentTasks")}</Text>}
    <div className={styles.results}>{results.map((result, index) => <Control recipe="row" key={`${result.kind}:${result.id}`} className={styles.result} disabled={projects.activate.isPending} onClick={() => void choose(result)} onMouseEnter={() => setSelected(index)} selected={index === selected}>
      {result.kind === "project" ? <Folder size={15} /> : <FileText size={15} />}
      <span><Text as="strong" size="body" weight="medium" truncate><Highlight text={result.label} query={query} /></Text><Text as="small" tone="muted" size="label">{result.kind === "task" && <Text as="em" tone="secondary" size="label">{result.projectName}</Text>}<Highlight text={result.detail} query={query} /></Text></span>
    </Control>)}{!results.length && !searching && <Text as="div" className={styles.empty} tone="muted" size="label">{t("noResults")}</Text>}</div>
  </Modal>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const lower = text.toLocaleLowerCase();
  const term = terms.find((value) => lower.includes(value.toLocaleLowerCase()));
  if (!term) return <>{text}</>;
  const start = lower.indexOf(term.toLocaleLowerCase());
  return <>{text.slice(0, start)}<Text as="span" tone="accent">{text.slice(start, start + term.length)}</Text>{text.slice(start + term.length)}</>;
}

function projectName(projects: Array<{ projectId: string; name: string }>, projectId: string): string {
  return projects.find((project) => project.projectId === projectId)?.name || "Project";
}
