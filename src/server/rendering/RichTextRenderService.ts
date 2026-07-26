import type { Root } from "hast";
import { parseRichTextDocument, type RichTextLevel } from "../../shared/richTextPipeline.js";
import {
  DEFAULT_RICH_TEXT_RENDER_POLICY,
  type RichTextMediaPlacement,
  type RichTextRenderPolicy,
} from "../../shared/contracts.js";
import { WeightedLruCache } from "../../shared/WeightedLruCache.js";

const MAX_CACHE_ENTRIES = 96;
const MAX_CACHE_WEIGHT = 16 * 1024 * 1024;

/** Produces one sanitized HAST document shared by desktop and LAN renderers. */
export class RichTextRenderService {
  readonly #cache = new WeightedLruCache<string, Root>(
    MAX_CACHE_ENTRIES,
    MAX_CACHE_WEIGHT,
  );

  render(
    text: string,
    level: RichTextLevel = "media",
    placements: RichTextMediaPlacement[] = [],
    policy: RichTextRenderPolicy = DEFAULT_RICH_TEXT_RENDER_POLICY,
  ): Root {
    const placementKey = placements.map((item) => `${item.kind}:${item.syntax}:${item.anchor.start}:${item.anchor.end}`).join(",");
    const key = `${level}\0${JSON.stringify(policy)}\0${placementKey}\0${text}`;
    const cached = this.#cache.get(key);
    if (cached) return structuredClone(cached);
    const document = parseRichTextDocument(text, { level, mediaPlacements: placements, renderPolicy: policy });
    this.#cache.set(
      key,
      document,
      2_048 + key.length * 2 + text.length * 8 + placements.length * 128,
    );
    return structuredClone(document);
  }
}
