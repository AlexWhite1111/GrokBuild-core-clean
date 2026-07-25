import type { ThemeSwatchTokens } from "../../shared/contracts.js";

type SwatchVariable =
  | "--theme-swatch-canvas"
  | "--theme-swatch-sidebar"
  | "--theme-swatch-surface"
  | "--theme-swatch-surface-raised"
  | "--theme-swatch-border"
  | "--theme-swatch-accent"
  | "--theme-swatch-text";

export function themeSwatchVariables(
  swatch: ThemeSwatchTokens,
): Record<SwatchVariable, string> {
  return {
    "--theme-swatch-canvas": swatch.canvas,
    "--theme-swatch-sidebar": swatch.sidebar,
    "--theme-swatch-surface": swatch.surface,
    "--theme-swatch-surface-raised": swatch.surfaceRaised,
    "--theme-swatch-border": swatch.border,
    "--theme-swatch-accent": swatch.accent,
    "--theme-swatch-text": swatch.text,
  };
}
