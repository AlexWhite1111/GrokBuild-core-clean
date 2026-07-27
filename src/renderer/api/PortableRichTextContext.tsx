import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  DEFAULT_RICH_TEXT_RENDER_POLICY,
  type RichTextLevel,
  type RichTextMediaPlacement,
  type RichTextRenderPolicy,
  type RichTextRenderResponse,
} from "../../shared/contracts.js";
import { WeightedLruCache } from "../../shared/WeightedLruCache.js";
import type { ApiClient } from "./ApiClient.js";

interface PortableRenderer {
  cached(input: RenderInput): RichTextRenderResponse | null;
  render(input: RenderInput): Promise<RichTextRenderResponse>;
}

interface RenderInput {
  text: string;
  level: RichTextLevel;
  taskId?: string;
  placements: RichTextMediaPlacement[];
  policy: RichTextRenderPolicy;
}

const EMPTY_PLACEMENTS: RichTextMediaPlacement[] = [];
const MAX_RESOLVED_ENTRIES = 96;
const MAX_RESOLVED_WEIGHT = 16 * 1024 * 1024;

const PortableRichTextContext = createContext<PortableRenderer | null>(null);

export function PortableRichTextProvider({ api, enabled, children }: PropsWithChildren<{ api: ApiClient; enabled: boolean }>) {
  const renderer = useMemo(() => enabled ? createRenderer(api) : null, [api, enabled]);
  return <PortableRichTextContext.Provider value={renderer}>{children}</PortableRichTextContext.Provider>;
}

export function usePortableRichText(
  text: string,
  level: RichTextLevel,
  enabled = true,
  taskId?: string,
  placements: RichTextMediaPlacement[] = EMPTY_PLACEMENTS,
  policy: RichTextRenderPolicy = DEFAULT_RICH_TEXT_RENDER_POLICY,
): RichTextRenderResponse | null {
  const renderer = useContext(PortableRichTextContext);
  const input = useMemo(() => ({ text, level, taskId, placements, policy }), [level, placements, policy, taskId, text]);
  // Disabled streaming callers must not manufacture a cumulative-text cache
  // key on every frame; the exact key is needed only for an actual render.
  const key = enabled ? renderKey(input) : null;
  const [resolved, setResolved] = useState<{ key: string; response: RichTextRenderResponse } | null>(() => {
    const response = key ? renderer?.cached(input) || null : null;
    return response && key ? { key, response } : null;
  });
  useEffect(() => {
    let active = true;
    if (!key) return () => { active = false; };
    const cached = renderer?.cached(input) || null;
    if (cached) setResolved({ key, response: cached });
    else if (renderer) void renderer.render(input).then((response) => { if (active) setResolved({ key, response }); }).catch(() => undefined);
    return () => { active = false; };
  }, [input, key, renderer]);
  return key && resolved?.key === key ? resolved.response : null;
}

function createRenderer(api: ApiClient): PortableRenderer {
  const resolved = new WeightedLruCache<string, RichTextRenderResponse>(
    MAX_RESOLVED_ENTRIES,
    MAX_RESOLVED_WEIGHT,
  );
  const pending = new Map<string, Promise<RichTextRenderResponse>>();
  const keyOf = renderKey;
  return {
    cached(input) { return resolved.get(keyOf(input)) || null; },
    render(input) {
      const key = keyOf(input);
      const cached = resolved.get(key);
      if (cached) return Promise.resolve(cached);
      const existing = pending.get(key);
      if (existing) return existing;
      const request = api.post<RichTextRenderResponse>("/render/rich-text", input).then((response) => {
        pending.delete(key);
        resolved.set(key, response, renderWeight(key, input));
        return response;
      }, (error) => { pending.delete(key); throw error; });
      pending.set(key, request);
      return request;
    },
  };
}

function renderWeight(key: string, input: RenderInput): number {
  return 2_048
    + key.length * 2
    + input.text.length * 8
    + input.placements.length * 128;
}

function renderKey(input: RenderInput): string {
  const placements = input.placements.map((item) => `${item.kind}:${item.syntax}:${item.anchor.start}:${item.anchor.end}`).join(",");
  return `${input.taskId || "global"}\0${input.level}\0${JSON.stringify(input.policy)}\0${placements}\0${input.text}`;
}
