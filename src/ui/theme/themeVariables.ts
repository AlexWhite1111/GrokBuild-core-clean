import type { ThemeManifestV1 } from "../../shared/contracts.js";
import {
  CORNER_RADIUS_DEFAULT,
  CORNER_RADIUS_MAX,
  CORNER_RADIUS_MIN,
  GLOBAL_THEME_GEOMETRY,
  type ThemeTypographyRole,
} from "../../shared/themeGeometry.js";
import { themeMaterialVariables } from "./themeMaterials.js";

export const CORNER_RADIUS_PREVIEW_EVENT = "grok-build:corner-radius-preview";
export const THEME_APPLIED_EVENT = "grok-build:theme-applied";
export const THEME_PREVIEW_EVENT = "grok-build:theme-preview";

export function themeVariables(
  theme: ThemeManifestV1,
  options: {
    cornerRadius?: number;
    reduceMotion?: boolean;
  } = {},
): Record<string, string> {
  const variables: Record<string, string> = themeMaterialVariables(theme);
  for (const [name, value] of Object.entries(theme.colors))
    variables[`--color-${kebab(name)}`] = value;
  variables["--color-media-canvas"] = "#000";
  variables["--color-inverse-surface"] = "#fff";
  for (const [name, value] of Object.entries(GLOBAL_THEME_GEOMETRY.density)) {
    const floor =
      name === "controlHeight"
        ? "--platform-control-min"
        : name === "compactControlHeight"
          ? "--platform-compact-control-min"
          : null;
    variables[`--density-${kebab(name)}`] = floor
      ? `max(calc(${value}px * var(--layout-density-scale, 1)), var(${floor}, 0px))`
      : `calc(${value}px * var(--layout-density-scale, 1))`;
  }
  for (const [name, value] of Object.entries(GLOBAL_THEME_GEOMETRY.typeScale))
    variables[`--type-${kebab(name)}`] =
      `calc(${value}px * var(--font-scale, 1))`;
  for (const [role, value] of Object.entries(theme.typography) as Array<
    [ThemeTypographyRole, ThemeManifestV1["typography"][ThemeTypographyRole]]
  >) {
    const geometry = GLOBAL_THEME_GEOMETRY.typography[role];
    const family = value.assetId
      ? `"GrokTheme-${value.assetId}", ${value.family}`
      : value.family;
    const portableRole = role === "ui" || role === "body" || role === "heading";
    const themeFamily =
      portableRole && !value.assetId
        ? `var(--font-${role}-portable, ${family})`
        : family;
    variables[`--theme-font-${role}`] = themeFamily;
    variables[`--font-${role}-size`] =
      `calc(${geometry.size}px * var(--font-scale, 1))`;
    variables[`--font-${role}-weight`] =
      `clamp(100, calc(${value.weight} + var(--font-weight-adjust, 0)), 900)`;
    variables[`--font-${role}-line-height`] =
      `calc(${geometry.lineHeight} * var(--line-spacing-scale, 1))`;
    variables[`--font-${role}-spacing`] =
      `calc(${geometry.letterSpacing}em + var(--letter-spacing-adjust, 0em))`;
    variables[`--font-${role}-color`] = value.color;
  }
  variables["--theme-font-primary"] = "var(--theme-font-body)";
  const cornerRadius =
    clamp(
      options.cornerRadius ?? CORNER_RADIUS_DEFAULT,
      CORNER_RADIUS_MIN,
      CORNER_RADIUS_MAX,
  );
  const cornerRatio = cornerRadius / GLOBAL_THEME_GEOMETRY.radii.medium;
  const detailRadius = Math.max(2, GLOBAL_THEME_GEOMETRY.radii.small / 2 * cornerRatio);
  const controlRadius = GLOBAL_THEME_GEOMETRY.radii.small * cornerRatio;
  const dialogRadius = GLOBAL_THEME_GEOMETRY.radii.large * cornerRatio;
  variables["--radius-none"] = "0px";
  variables["--radius-detail"] = radius(detailRadius);
  variables["--radius-control"] = radius(controlRadius);
  variables["--radius-surface"] = radius(cornerRadius);
  variables["--radius-dialog"] = radius(dialogRadius);
  variables["--clip-k2-detail"] = squircleClip(detailRadius);
  variables["--clip-k2-control"] = squircleClip(controlRadius);
  variables["--clip-k2-surface"] = squircleClip(cornerRadius);
  variables["--clip-k2-dialog"] = squircleClip(dialogRadius);
  variables["--radius-pill"] = `${GLOBAL_THEME_GEOMETRY.radii.pill}px`;
  variables["--radius-round"] = "50%";
  variables["--corner-curve"] = "squircle";
  variables["--corner-curve-round"] = "round";
  variables["--shadow-none"] = "none";
  variables["--shadow-very-low"] = theme.effects.shadows.veryLow;
  variables["--shadow-low"] = theme.effects.shadows.low;
  variables["--shadow-medium"] = theme.effects.shadows.medium;
  variables["--shadow-high"] = theme.effects.shadows.high;
  variables["--shadow-very-high"] = theme.effects.shadows.veryHigh;
  variables["--shadow-content"] = shadowLayer(theme.effects.shadows.veryLow);
  variables["--shadow-control"] = shadowLayer(theme.effects.shadows.low);
  variables["--shadow-floating"] = shadowLayer(theme.effects.shadows.medium);
  variables["--shadow-popover"] = shadowLayer(theme.effects.shadows.high);
  variables["--shadow-modal"] = shadowLayer(theme.effects.shadows.veryHigh);
  if (theme.personality) {
    variables["--shadow-layout-start"] = "none";
    variables["--shadow-layout-end"] = "none";
  } else {
    const layoutShadowColor =
      theme.appearance === "dark"
        ? "color-mix(in srgb, black 46%, transparent)"
        : `color-mix(in srgb, ${theme.colors.text} 10%, transparent)`;
    variables["--shadow-layout-start"] =
      `-8px 0 18px -16px ${layoutShadowColor}`;
    variables["--shadow-layout-end"] =
      `8px 0 18px -16px ${layoutShadowColor}`;
  }
  const table = theme.components.table;
  variables["--color-table-surface"] = table.background;
  variables["--color-table-header"] = table.accent;
  variables["--color-table-grid"] = table.border;
  variables["--color-table-text"] = table.foreground;
  variables["--color-table-header-text"] = theme.colors.text;
  variables["--heading-h1-color"] =
    `color-mix(in srgb, ${theme.colors.text} 78%, ${theme.colors.accent})`;
  variables["--heading-h2-color"] =
    `color-mix(in srgb, ${theme.colors.text} 88%, ${theme.colors.accent})`;
  variables["--heading-h3-color"] =
    `color-mix(in srgb, ${theme.colors.text} 92%, ${theme.colors.info})`;
  for (const [name, value] of Object.entries(theme.effects.borders))
    variables[`--border-${kebab(name)}`] = `${value}px`;
  for (const [name, value] of Object.entries(theme.effects.blur))
    variables[`--blur-${kebab(name)}`] = `${value}px`;
  variables["--thread-edge-size"] =
    "calc(56px * var(--layout-density-scale, 1))";
  variables["--thread-edge-top-size"] =
    "calc(28px * var(--layout-density-scale, 1))";
  variables["--motion-fast"] =
    `${options.reduceMotion ? 0 : theme.effects.motion.fast}ms`;
  variables["--motion-normal"] =
    `${options.reduceMotion ? 0 : theme.effects.motion.normal}ms`;
  variables["--motion-slow"] =
    `${options.reduceMotion ? 0 : theme.effects.motion.slow}ms`;
  variables["--motion-easing"] = theme.effects.motion.easing;
  for (const [component, tokens] of Object.entries(theme.components)) {
    if (!tokens) continue;
    for (const [name, value] of Object.entries(tokens))
      variables[`--component-${kebab(component)}-${kebab(name)}`] = value;
  }
  for (const [name, value] of Object.entries(theme.syntax))
    variables[`--syntax-${kebab(name)}`] = value;
  for (const [name, value] of Object.entries(theme.ansi))
    variables[`--ansi-${kebab(name)}`] = value;
  for (const [name, value] of Object.entries(theme.diff))
    variables[`--diff-${kebab(name)}`] = value;
  variables["--app-background"] = backgroundValue(theme);
  return variables;
}

function backgroundValue(theme: ThemeManifestV1): string {
  // Manifests describe backgrounds from foundation to decoration. CSS paints
  // the first background image on top, so reverse whole logical layers while
  // preserving the internal order of composite asset layers.
  const layers = [...theme.backgrounds].reverse().flatMap((layer) => {
    if (layer.type === "gradient") return [layer.value];
    if (layer.type === "color")
      return [
        `linear-gradient(${withOpacity(layer.color, layer.opacity)}, ${withOpacity(layer.color, layer.opacity)})`,
      ];
    if (layer.type === "asset") {
      const mask = Math.round((1 - layer.opacity) * 10_000) / 100;
      const maskColor = `color-mix(in srgb, ${theme.colors.canvas} ${mask}%, transparent)`;
      return [
        `linear-gradient(${maskColor}, ${maskColor})`,
        `url("/theme-assets/${layer.assetId}")`,
      ];
    }
    if (layer.type === "noise") {
      const speckle = `color-mix(in srgb, ${theme.colors.text} ${Math.round(layer.opacity * 10_000) / 100}%, transparent)`;
      return [
        `repeating-radial-gradient(circle at 30% 20%, ${speckle} 0 1px, transparent 1px ${Math.max(2, layer.scale * 4)}px)`,
      ];
    }
    if (layer.type === "vibrancy")
      return [
        `linear-gradient(rgba(255,255,255,${layer.opacity * 0.025}), rgba(255,255,255,${layer.opacity * 0.025}))`,
      ];
    return [];
  });
  return layers.join(", ") || theme.colors.canvas;
}

export function themeFontFaces(theme: ThemeManifestV1): string {
  return theme.assets
    .filter((asset) => asset.kind === "font")
    .map((asset) => {
      const format = asset.fileName.toLowerCase().endsWith(".woff2")
        ? "woff2"
        : asset.fileName.toLowerCase().endsWith(".otf")
          ? "opentype"
          : "truetype";
      return `@font-face{font-family:"GrokTheme-${asset.id}";src:url("/theme-assets/${asset.id}") format("${format}");font-display:swap;}`;
    })
    .join("\n");
}

function withOpacity(color: string, opacity: number): string {
  if (opacity === 1) return color;
  const percentage = Math.round(opacity * 10_000) / 100;
  return `color-mix(in srgb, ${color} ${percentage}%, transparent)`;
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function radius(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}px`;
}

function squircleClip(value: number): string {
  const edge = radius(value * 0.5609);
  const shoulder = radius(value * 0.3181);
  const midpoint = radius(value * 0.1591);
  const extent = radius(value);
  const right = (offset: string) => `calc(100% - ${offset})`;
  const bottom = right;
  return [
    `shape(from ${extent} 0`,
    `hline to ${right(extent)}`,
    `curve to ${right(midpoint)} ${midpoint} with ${right(edge)} 0 / ${right(shoulder)} 0`,
    `curve to 100% ${extent} with 100% ${shoulder} / 100% ${edge}`,
    `vline to ${bottom(extent)}`,
    `curve to ${right(midpoint)} ${bottom(midpoint)} with 100% ${bottom(edge)} / 100% ${bottom(shoulder)}`,
    `curve to ${right(extent)} 100% with ${right(shoulder)} 100% / ${right(edge)} 100%`,
    `hline to ${extent}`,
    `curve to ${midpoint} ${bottom(midpoint)} with ${edge} 100% / ${shoulder} 100%`,
    `curve to 0 ${bottom(extent)} with 0 ${bottom(shoulder)} / 0 ${bottom(edge)}`,
    `vline to ${extent}`,
    `curve to ${midpoint} ${midpoint} with 0 ${edge} / 0 ${shoulder}`,
    `curve to ${extent} 0 with ${shoulder} 0 / ${edge} 0`,
    "close)",
  ].join(", ");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function shadowLayer(value: string): string {
  return value.trim().toLowerCase() === "none" ? "0 0 0 0 transparent" : value;
}
