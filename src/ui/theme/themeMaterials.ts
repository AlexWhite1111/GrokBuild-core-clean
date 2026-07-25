import type { ThemeManifestV1 } from "../../shared/contracts.js";

type Variables = Record<string, string>;
type Recipe = NonNullable<ThemeManifestV1["personality"]>["recipe"] | "custom";

/**
 * Material projection is intentionally quiet. Theme identity comes from
 * palette, typography, and spacing; strokes and effects are reserved for
 * controls that need an explicit boundary (menus, code, tables).
 */
export function themeMaterialVariables(theme: ThemeManifestV1): Variables {
  const recipe: Recipe = theme.personality?.recipe ?? "custom";
  return {
    ...commonVariables(theme),
    ...recipeVariables(theme, recipe),
  };
}

function commonVariables(theme: ThemeManifestV1): Variables {
  const { colors, components } = theme;
  const dark = theme.appearance === "dark";
  return {
    "--color-overlay-soft": dark ? "rgba(0,0,0,.24)" : "rgba(24,22,20,.12)",
    "--color-overlay": dark ? "rgba(0,0,0,.34)" : "rgba(24,22,20,.20)",
    "--color-overlay-strong": dark ? "rgba(0,0,0,.52)" : "rgba(24,22,20,.34)",
    "--color-accent-soft": mix(colors.accent, dark ? 13 : 9, "transparent"),
    "--color-success-soft": mix(colors.success, dark ? 13 : 9, "transparent"),
    "--color-warning-soft": mix(colors.warning, dark ? 13 : 9, "transparent"),
    "--color-danger-soft": mix(colors.danger, dark ? 13 : 9, "transparent"),
    "--color-info-soft": mix(colors.info, dark ? 13 : 9, "transparent"),
    "--color-interactive-disabled": mix(colors.textMuted, 44, "transparent"),
    "--color-navigation-selected": "var(--color-interactive-selected)",
    "--shadow-selection-rest": `inset 0 0 0 var(--border-regular, 1px) ${mix(
      colors.textSecondary,
      dark ? 66 : 72,
      "transparent",
    )}`,
    "--color-media-backdrop": mix(colors.canvas, dark ? 72 : 52, "transparent"),
    "--color-border-subtle": mix(colors.border, dark ? 58 : 52, "transparent"),
    "--background-canvas": colors.canvas,
    "--background-sidebar": colors.sidebar,
    "--background-sidebar-footer": `linear-gradient(transparent, ${colors.sidebar} 42%)`,
    "--background-surface": colors.surface,
    "--background-surface-raised": colors.surfaceRaised,
    "--background-surface-muted": colors.surfaceMuted,
    "--background-drawer": components.drawer.background,
    "--background-menu": components.menu.background,
    "--background-composer": components.composer.background,
    "--background-message": components.message.background,
    "--background-question": components.question.background,
    "--background-code": components.code.background,
    "--background-inline-code": components.code.background,
    "--background-terminal": components.terminal.background,
    "--background-control-quiet": "transparent",
    "--background-control-floating": components.button.background,
    "--background-form": components.form.background,
    "--background-form-track": components.form.background,
    "--background-form-active": components.form.accent,
    "--background-form-active-hover": mix(
      components.form.accent,
      dark ? 86 : 91,
      colors.text,
    ),
    "--background-form-active-pressed": mix(
      components.form.accent,
      dark ? 78 : 84,
      colors.text,
    ),
    "--color-form-thumb": colors.textMuted,
    "--color-form-active-foreground": "var(--color-inverse-surface)",
    "--background-primary-action": "var(--control-tone)",
    "--background-primary-action-hover": mix(
      "var(--control-tone)",
      dark ? 86 : 91,
      colors.text,
    ),
    "--background-primary-action-pressed": mix(
      "var(--control-tone)",
      dark ? 78 : 84,
      colors.text,
    ),
    "--background-primary-action-sheen": "none",
    "--background-composer-send-idle": mix(
      colors.accent,
      58,
      components.composer.background,
    ),
    "--background-composer-send-active": colors.accent,
    "--background-composer-send-active-hover": mix(
      colors.accent,
      90,
      colors.text,
    ),
    "--background-composer-send-active-pressed": mix(
      colors.accent,
      82,
      colors.text,
    ),
    "--selection-background": colors.accent,
    "--scrollbar-thumb": mix(colors.textMuted, dark ? 28 : 24, "transparent"),
    "--scrollbar-thumb-hover": mix(colors.textMuted, dark ? 54 : 48, "transparent"),
    "--color-scrollbar-thumb": mix(colors.textMuted, dark ? 28 : 24, "transparent"),
    "--surface-backdrop-filter": "none",
    "--menu-backdrop-filter": "none",
    "--modal-backdrop-filter": "none",
    "--sidebar-backdrop-filter": "none",
    "--composer-backdrop-filter": "none",
    "--shadow-surface-stroke": transparentStroke(),
    "--shadow-raised-stroke": transparentStroke(),
    "--shadow-muted-stroke": transparentStroke(),
    "--shadow-menu-stroke": hairlineStroke(components.menu.border, dark ? 64 : 48),
    "--shadow-composer-stroke": hairlineStroke(components.composer.border, dark ? 64 : 52),
    "--shadow-composer-elevation": "var(--shadow-control)",
    "--shadow-question-stroke": hairlineStroke(components.question.border, dark ? 64 : 52),
    "--shadow-message-stroke": transparentStroke(),
    "--shadow-message-user-stroke": transparentStroke(),
    "--shadow-message-elevation": "var(--shadow-content)",
    "--shadow-message-user-elevation": "var(--shadow-content)",
    "--shadow-code-stroke": hairlineStroke(components.code.border, dark ? 68 : 54),
    "--color-inline-code": components.code.foreground,
    "--shadow-inline-code-stroke": hairlineStroke(components.code.border, dark ? 68 : 54),
    "--shadow-control-stroke": transparentStroke(),
    "--shadow-input-stroke": transparentStroke(),
    "--shadow-selected": "none",
    "--shadow-primary-action": "none",
    "--shadow-primary-action-hover": "none",
    "--theme-decoration-image": "none",
    "--theme-decoration-size": "auto",
    "--theme-decoration-position": "0 0",
    "--theme-decoration-opacity": "0",
    "--theme-decoration-blend": "normal",
  };
}

function recipeVariables(theme: ThemeManifestV1, recipe: Recipe): Variables {
  const { colors } = theme;
  const dark = theme.appearance === "dark";
  const selectedPercent = recipe === "gilded" ? 10 : recipe === "precision" ? 9 : 8;
  const userPercent = recipe === "gilded" ? 10 : recipe === "precision" ? 8 : 7;
  const hoverPercent = dark ? 68 : 72;

  const variables: Variables = {
    "--color-interactive-hover": mix(colors.surfaceMuted, hoverPercent, "transparent"),
    "--color-interactive-selected": mix(
      colors.accent,
      dark ? selectedPercent + 3 : selectedPercent,
      colors.surfaceMuted,
    ),
    "--color-interactive-pressed": mix(
      colors.accent,
      dark ? selectedPercent + 8 : selectedPercent + 5,
      colors.surfaceMuted,
    ),
    "--color-control-hover": mix(colors.surfaceMuted, hoverPercent, "transparent"),
    "--color-drag-active": mix(colors.accent, dark ? 13 : 9, colors.surfaceMuted),
    "--color-message-user": mix(
      colors.accent,
      dark ? userPercent + 3 : userPercent,
      colors.surfaceRaised,
    ),
  };

  if (recipe === "editorial") {
    const hover = mix(
      colors.accent,
      dark ? 8 : 6,
      colors.surfaceMuted,
    );
    const selected = mix(
      colors.accent,
      dark ? 17 : 15,
      colors.surfaceMuted,
    );
    const navigationSelected = dark
      ? selected
      : mix(colors.accent, 10, colors.surfaceMuted);
    const pressed = mix(
      colors.accent,
      dark ? 25 : 22,
      colors.surfaceMuted,
    );
    variables["--color-interactive-hover"] = hover;
    variables["--color-interactive-selected"] = selected;
    variables["--color-interactive-pressed"] = pressed;
    variables["--color-control-hover"] = hover;
    variables["--color-navigation-selected"] = navigationSelected;
    variables["--color-message-user"] = navigationSelected;
    variables["--background-message"] = colors.surfaceRaised;
    variables["--background-form"] = mix(
      colors.surfaceMuted,
      dark ? 88 : 92,
      colors.surface,
    );
    variables["--background-form-track"] = mix(
      colors.borderStrong,
      dark ? 58 : 46,
      colors.surfaceMuted,
    );
    variables["--background-form-active"] = colors.accent;
    variables["--color-form-thumb"] = dark
      ? colors.textSecondary
      : colors.surfaceRaised;
    variables["--background-inline-code"] = colors.surfaceMuted;
    variables["--color-inline-code"] = colors.textSecondary;
    variables["--shadow-inline-code-stroke"] = hairlineStroke(
      colors.border,
      dark ? 54 : 42,
    );
  } else if (recipe === "precision") {
    variables["--background-control-floating"] = colors.surfaceRaised;
    variables["--background-form"] = colors.surfaceMuted;
  } else if (recipe === "gilded") {
    variables["--background-form"] = mix(
      colors.surfaceMuted,
      dark ? 92 : 94,
      colors.surface,
    );
  } else {
    variables["--surface-backdrop-filter"] = "blur(var(--blur-low, 0px))";
    variables["--menu-backdrop-filter"] = "blur(var(--blur-medium, 0px))";
    variables["--modal-backdrop-filter"] = "blur(var(--blur-high, 0px))";
    variables["--composer-backdrop-filter"] = "blur(var(--blur-low, 0px))";
  }

  return variables;
}

function mix(color: string, percent: number, other: string): string {
  return `color-mix(in srgb, ${color} ${percent}%, ${other})`;
}

function transparentStroke(): string {
  return "0 0 0 0 transparent";
}

function hairlineStroke(color: string, percent: number): string {
  if (color === "transparent") return transparentStroke();
  return `inset 0 0 0 var(--border-hairline, .5px) ${mix(color, percent, "transparent")}`;
}
