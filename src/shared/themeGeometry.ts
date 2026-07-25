import type { ThemeManifestV1 } from "./contracts/theme.js";

export type ThemeTypographyRole = keyof ThemeManifestV1["typography"];

export const CORNER_RADIUS_MIN = 4;
export const CORNER_RADIUS_MAX = 64;
export const CORNER_RADIUS_DEFAULT = 15;

export function cornerRadiusFromLegacyScale(value: unknown): number {
  const scale = typeof value === "number" && Number.isFinite(value) ? value : 100;
  return Math.min(
    CORNER_RADIUS_MAX,
    Math.max(CORNER_RADIUS_MIN, Math.round(CORNER_RADIUS_DEFAULT * scale / 100)),
  );
}

/**
 * Layout geometry belongs to the product rather than an individual visual
 * theme. V1 manifests still carry these fields for import compatibility, but
 * every theme is normalized to one restrained application geometry before it
 * is stored, previewed, or rendered.
 */
export const GLOBAL_THEME_GEOMETRY = {
  typography: {
    ui: { size: 13, lineHeight: 1.46, letterSpacing: 0 },
    body: { size: 15, lineHeight: 1.68, letterSpacing: 0 },
    heading: { size: 17, lineHeight: 1.34, letterSpacing: -0.012 },
    code: { size: 13, lineHeight: 1.58, letterSpacing: 0 },
    numeric: { size: 12, lineHeight: 1.36, letterSpacing: 0 },
  },
  typeScale: {
    microCompact: 9.5,
    micro: 10,
    caption: 10.5,
    captionRelaxed: 11,
    label: 11.5,
    labelRelaxed: 12,
    control: 12.5,
    controlRelaxed: 13,
    ui: 13,
    uiRelaxed: 13.5,
    bodyCompact: 13.5,
    body: 14,
    bodyRelaxed: 14.5,
    copy: 15,
    titleCompact: 16,
    title: 17,
    titleRelaxed: 18,
    heading: 19,
    headingLarge: 21,
    display: 23,
    displayLarge: 26,
  },
  density: { unit: 4, controlHeight: 34, compactControlHeight: 28, threadGap: 24 },
  radii: { small: 10, medium: 15, large: 20, pill: 999 },
  borders: { hairline: 0.5, regular: 1, strong: 1 },
} as const;

export function normalizeThemeGeometry(theme: ThemeManifestV1): ThemeManifestV1 {
  const typography = Object.fromEntries(
    (Object.entries(theme.typography) as Array<
      [ThemeTypographyRole, ThemeManifestV1["typography"][ThemeTypographyRole]]
    >).map(([role, value]) => [
      role,
      { ...value, ...GLOBAL_THEME_GEOMETRY.typography[role] },
    ]),
  ) as ThemeManifestV1["typography"];

  return {
    ...theme,
    typography,
    density: { ...GLOBAL_THEME_GEOMETRY.density },
    effects: {
      ...theme.effects,
      radii: { ...GLOBAL_THEME_GEOMETRY.radii },
      borders: { ...GLOBAL_THEME_GEOMETRY.borders },
    },
  };
}
