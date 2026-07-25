import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftSnapshot } from "../../shared/contracts.js";
import type { ApiClient } from "../api/ApiClient.js";
import { SerialWriteQueue } from "../api/SerialWriteQueue.js";
import { composerHasContent, restoreDraft, serializeDraft, textNodes, type ComposerNode } from "./composerDocument.js";

export function useComposerDraft({ api, draftKey, initialDraft = "", projectId }: { api: ApiClient; draftKey?: string; initialDraft?: string; projectId?: string }) {
  const [nodes, setNodeState] = useState<ComposerNode[]>(() => textNodes(initialDraft));
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const nodesRef = useRef(nodes);
  const editRevisionRef = useRef(0);
  const keyRef = useRef<string | undefined>(draftKey);
  const loadedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const writes = useRef(new SerialWriteQueue());

  const replaceNodes = useCallback((next: ComposerNode[]) => {
    nodesRef.current = next;
    setNodeState(next);
  }, []);

  const setNodes = useCallback((next: ComposerNode[]) => {
    editRevisionRef.current += 1;
    loadedRef.current = true;
    setLoadedKey(keyRef.current || "local");
    replaceNodes(next);
  }, [replaceNodes]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const persist = useCallback((key: string, value: ComposerNode[]) => {
    const snapshot = value.map((node) => node.type === "text" ? { ...node } : { type: "path" as const, path: { ...node.path } });
    return writes.current.enqueue(async () => {
      const document = composerHasContent(snapshot) ? serializeDraft(snapshot) : null;
      await api.post("/ui/drafts", { requestId: crypto.randomUUID(), key, document });
    });
  }, [api]);

  const flush = useCallback(() => {
    cancelTimer();
    const key = keyRef.current;
    if (!key || !loadedRef.current) return;
    void persist(key, nodesRef.current).catch(() => undefined);
  }, [cancelTimer, persist]);

  useEffect(() => {
    let cancelled = false;
    keyRef.current = draftKey;
    loadedRef.current = false;
    editRevisionRef.current = 0;
    setLoadedKey(null);
    replaceNodes(textNodes(initialDraft));
    if (!draftKey) {
      loadedRef.current = true;
      setLoadedKey(draftKey || "local");
      return () => { cancelled = true; };
    }
    const loadRevision = editRevisionRef.current;
    void api.get<DraftSnapshot>(`/ui/drafts/${encodeURIComponent(draftKey)}`).then(async (value) => {
      if (!value.document) return;
      const restored = await restoreDraft(value.document, (paths) => window.grokDesktop ? window.grokDesktop.restorePaths(paths, projectId) : Promise.resolve(paths));
      if (!cancelled && keyRef.current === draftKey && editRevisionRef.current === loadRevision) replaceNodes(restored);
    }).catch(() => undefined).finally(() => {
      if (!cancelled && keyRef.current === draftKey) {
        loadedRef.current = true;
        setLoadedKey(draftKey);
      }
    });
    return () => {
      cancelled = true;
      if (keyRef.current === draftKey) flush();
    };
  }, [api, draftKey, flush, initialDraft, projectId, replaceNodes]);

  useEffect(() => {
    cancelTimer();
    if (!draftKey || loadedKey !== draftKey) return;
    const snapshot = nodes;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void persist(draftKey, snapshot).catch(() => undefined);
    }, 300);
    return cancelTimer;
  }, [cancelTimer, draftKey, loadedKey, nodes, persist]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [flush]);

  const clear = useCallback(() => {
    cancelTimer();
    const key = keyRef.current;
    const empty: ComposerNode[] = [];
    editRevisionRef.current += 1;
    replaceNodes(empty);
    if (key && loadedRef.current) void persist(key, empty).catch(() => undefined);
  }, [cancelTimer, persist, replaceNodes]);

  return { nodes, setNodes, clear };
}
