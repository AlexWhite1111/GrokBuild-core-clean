import { ThemeManifestV1Schema, type ThemeManifestV1 } from "../../shared/contracts.js";

export function themeCandidateFromMarkdown(markdown: string): ThemeManifestV1 | null {
  const fences = markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/gi);
  for (const match of fences) {
    if (!match[1] || match[1].length > 1_000_000) continue;
    try {
      const parsed = ThemeManifestV1Schema.safeParse(JSON.parse(match[1]) as unknown);
      if (parsed.success) return parsed.data;
    } catch { /* A normal or incomplete JSON block is not a theme candidate. */ }
  }
  return null;
}
