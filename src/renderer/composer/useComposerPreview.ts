import { useCallback, useEffect, useState } from "react";
import { DEFAULT_RICH_TEXT_RENDER_POLICY, type ComposerRichTextPreviewResponse, type RichTextRenderPolicy } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { composerHasContent, composerInput, type ComposerNode } from "./composerDocument.js";

export function useComposerPreview(input: {
  nodes: ComposerNode[];
  enabled: boolean;
  projectId?: string;
  policy?: RichTextRenderPolicy;
}) {
  const { api } = useBootstrap();
  const [scopeId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<ComposerRichTextPreviewResponse | null>(null);

  useEffect(() => {
    if (!input.enabled || !input.projectId || !composerHasContent(input.nodes)) {
      setPreview(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void api.post<ComposerRichTextPreviewResponse>("/render/composer-preview", {
        requestId: crypto.randomUUID(),
        scopeId,
        projectId: input.projectId,
        document: composerInput(input.nodes),
        policy: input.policy || DEFAULT_RICH_TEXT_RENDER_POLICY,
      }).then((value) => { if (active) setPreview(value); }).catch(() => undefined);
    }, 140);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, input.enabled, input.nodes, input.policy, input.projectId, scopeId]);

  return {
    scopeId,
    preview,
    clearPreview: useCallback(() => setPreview(null), []),
  };
}
