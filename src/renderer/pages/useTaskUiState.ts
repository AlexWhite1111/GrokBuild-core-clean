import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PathReferenceSummary,
  SavedContextResource,
  TaskUiState,
} from "../../shared/contracts.js";
import type { ApiClient } from "../api/ApiClient.js";
import type { ContextSectionId } from "../context/TaskContext.js";
import { pathIdentity } from "./taskPageLogic.js";

export function useTaskUiState(
  api: ApiClient,
  taskId: string,
  projectId?: string,
) {
  const [contextOpen, setContextOpen] = useState(false);
  const [contextFocus, setContextFocus] =
    useState<ContextSectionId>("planning");
  const [savedResources, setSavedResources] = useState<SavedContextResource[]>(
    [],
  );
  const resourceSaveTail = useRef<Promise<void>>(Promise.resolve());
  const latestResourceSave = useRef<Promise<void>>(Promise.resolve());
  const queueResourceSave = useCallback((resources: SavedContextResource[]) => {
    const save = resourceSaveTail.current
      .catch(() => undefined)
      .then(() => api.post(`/ui/tasks/${taskId}`, {
        requestId: crypto.randomUUID(),
        contextResources: resources,
      }))
      .then(() => undefined);
    resourceSaveTail.current = save;
    latestResourceSave.current = save;
    return save;
  }, [api, taskId]);

  useEffect(() => {
    if (!taskId) return;
    let current = true;
    setContextOpen(false);
    setContextFocus("planning");
    setSavedResources([]);
    void api
      .get<TaskUiState>(`/ui/tasks/${taskId}`)
      .then((state) => {
        if (!current) return;
        setContextOpen(state.contextOpen);
        setContextFocus(state.contextSection);
        setSavedResources(state.contextResources);
        const desktop = window.grokDesktop;
        if (!desktop || !state.contextResources.length) return;
        void desktop
          .restorePaths(state.contextResources.map((item) => item.path), projectId)
          .then((paths) => {
            if (!current) return;
            const restored = paths.map((path, index) => ({
              path,
              addedAt:
                state.contextResources[index]?.addedAt ||
                new Date().toISOString(),
            }));
            setSavedResources(restored);
            if (restored.every((item) => item.path.valid !== false)) {
              void queueResourceSave(restored).catch(() => undefined);
            }
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api, taskId, projectId, queueResourceSave]);

  const postState = (body: Record<string, unknown>) =>
    api
      .post(`/ui/tasks/${taskId}`, {
        requestId: crypto.randomUUID(),
        ...body,
      })
      .catch(() => undefined);

  const saveContext = (open: boolean) => {
    setContextOpen(open);
    void postState({ contextOpen: open });
  };
  const openContext = (section: ContextSectionId) => {
    setContextFocus(section);
    void postState({ contextSection: section });
    saveContext(true);
  };
  const closeContext = () => saveContext(false);
  const persistResources = (next: SavedContextResource[]) => {
    setSavedResources(next);
    void queueResourceSave(next).catch(() => undefined);
  };
  const addResources = (paths: PathReferenceSummary[]) => {
    if (!paths.length) return;
    if (contextOpen && contextFocus !== "context") openContext("context");
    const merged = new Map(
      savedResources.map((item) => [pathIdentity(item.path), item]),
    );
    const now = Date.now();
    paths.forEach((path, index) => {
      const key = pathIdentity(path);
      const current = merged.get(key);
      merged.set(key, {
        path,
        addedAt: current?.addedAt || new Date(now + index).toISOString(),
      });
    });
    persistResources(
      [...merged.values()]
        .sort((left, right) => left.addedAt.localeCompare(right.addedAt))
        .slice(-1_024),
    );
  };
  const removeResource = (path: PathReferenceSummary) =>
    persistResources(
      savedResources.filter(
        (item) => pathIdentity(item.path) !== pathIdentity(path),
      ),
    );
  return {
    contextOpen,
    contextFocus,
    savedResources,
    openContext,
    closeContext,
    addResources,
    removeResource,
    flushContextResources: () => latestResourceSave.current,
  };
}
