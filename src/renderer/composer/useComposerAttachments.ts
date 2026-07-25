import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { PathReferenceSummary } from "../../shared/contracts.js";
import type { InlineComposerEditorHandle } from "./InlineComposerEditor.js";
import { useWindowFileDrop } from "./useWindowFileDrop.js";

export function useComposerAttachments(input: {
  editor: RefObject<InlineComposerEditorHandle | null>;
  projectId?: string;
  draftKey?: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const [pathError, setPathError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const choose = async (mode: "files" | "folder") => {
    try { input.editor.current?.insertPaths(await window.grokDesktop?.choosePaths(mode, input.projectId) || []); setPathError(null); }
    catch (cause) { setPathError(errorText(cause)); }
  };
  const registerFiles = async (files: File[]): Promise<PathReferenceSummary[]> => {
    try {
      if (!window.grokDesktop) throw new Error(t("dropFilesUnavailable"));
      const incoming = await window.grokDesktop.registerDroppedFiles(files, input.projectId);
      if (!incoming.length) throw new Error(t("dropFilesUnavailable"));
      setPathError(null);
      return incoming;
    } catch (cause) { setPathError(errorText(cause)); return []; }
  };
  const registerTextClip = async (text: string): Promise<PathReferenceSummary | null> => {
    try {
      if (!window.grokDesktop) throw new Error(t("dropFilesUnavailable"));
      const ownerKey = input.draftKey || `composer:${input.projectId || "unscoped"}`;
      const incoming = await window.grokDesktop.createTextClip({ text, ownerKey, projectId: input.projectId });
      setPathError(null);
      return incoming;
    } catch (cause) { setPathError(errorText(cause)); return null; }
  };

  useWindowFileDrop(input.enabled, setDragActive, (files, point) => {
    if (!files.length) { setPathError(t("dropFilesUnavailable")); return; }
    void registerFiles(files).then((incoming) => input.editor.current?.insertPaths(incoming, point));
  }, pointInsideConversation);

  return { choose, dragActive, pathError, registerFiles, registerTextClip, setPathError };
}

function pointInsideConversation(point: { x: number; y: number }): boolean {
  const region = document.querySelector<HTMLElement>("[data-conversation-drop-region]");
  if (!region) return false;
  const bounds = region.getBoundingClientRect();
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
