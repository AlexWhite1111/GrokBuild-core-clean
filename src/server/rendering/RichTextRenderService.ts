import type { Root } from "hast";
import { parseRichTextDocument, type RichTextLevel } from "../../shared/richTextPipeline.js";
import {
  DEFAULT_RICH_TEXT_RENDER_POLICY,
  type RichTextMediaPlacement,
  type RichTextRenderPolicy,
} from "../../shared/contracts.js";

const CACHE_LIMIT = 512;

/** Produces one sanitized HAST document shared by desktop and LAN renderers. */
export class RichTextRenderService {
  readonly #cache = new Map<string, Root>();

  render(
    text: string,
    level: RichTextLevel = "media",
    placements: RichTextMediaPlacement[] = [],
    policy: RichTextRenderPolicy = DEFAULT_RICH_TEXT_RENDER_POLICY,
  ): Root {
    const placementKey = placements.map((item) => `${item.kind}:${item.syntax}:${item.anchor.start}:${item.anchor.end}`).join(",");
    const key = `${level}\0${JSON.stringify(policy)}\0${placementKey}\0${text}`;
    const cached = this.#cache.get(key);
    if (cached) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return structuredClone(cached);
    }
    const document = parseRichTextDocument(text, { level, mediaPlacements: placements, renderPolicy: policy });
    this.#cache.set(key, document);
    if (this.#cache.size > CACHE_LIMIT) this.#cache.delete(this.#cache.keys().next().value!);
    return structuredClone(document);
  }
}
