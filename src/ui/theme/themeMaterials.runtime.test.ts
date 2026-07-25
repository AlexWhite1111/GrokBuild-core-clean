import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ThemeManifestV1 } from "../../shared/contracts.js";
import { themeMaterialVariables } from "./themeMaterials.js";
import { themeVariables } from "./themeVariables.js";

const COLORS: ThemeManifestV1["colors"] = {
  canvas: "#f5f1e8",
  sidebar: "#eee9de",
  surface: "#f8f5ee",
  surfaceRaised: "#fcfaf5",
  surfaceMuted: "#eae4d8",
  border: "#d9d1c4",
  borderStrong: "#c7bcaf",
  text: "#292722",
  textSecondary: "#57534c",
  textMuted: "#6c675e",
  accent: "#8a493c",
  accentText: "#fff9f2",
  focus: "#a15849",
  success: "#52705a",
  warning: "#94652b",
  danger: "#a14840",
  info: "#4e6f76",
};

function materialTheme(
  recipe: "precision" | "editorial" | "gilded" | undefined,
): ThemeManifestV1 {
  const component: ThemeManifestV1["components"]["composer"] = {
    background: COLORS.surface,
    foreground: COLORS.text,
    border: "transparent",
    accent: COLORS.accent,
    muted: COLORS.textMuted,
  };
  const typographyRole = {
    family: "system-ui",
    size: 14,
    weight: 400,
    lineHeight: 1.5,
    letterSpacing: 0,
    color: COLORS.text,
  };
  return {
    $schema: "grok-build://schemas/theme-v1.json",
    schemaVersion: 1,
    id: `fixture-${recipe ?? "custom"}`,
    name: "Fixture",
    appearance: "light",
    personality: recipe
      ? {
          pairId: `fixture-${recipe}`,
          pairName: recipe,
          role: "day",
          recipe,
          tagline: "fixture",
        }
      : undefined,
    colors: COLORS,
    typography: {
      ui: typographyRole,
      body: typographyRole,
      heading: typographyRole,
      code: typographyRole,
      numeric: typographyRole,
    },
    density: {
      unit: 4,
      controlHeight: 34,
      compactControlHeight: 28,
      threadGap: 24,
    },
    effects: {
      radii: { small: 10, medium: 15, large: 20, pill: 999 },
      borders: { hairline: 0.5, regular: 1, strong: 1 },
      shadows: {
        veryLow: "none",
        low: "none",
        medium: "none",
        high: "none",
        veryHigh: "none",
      },
      blur: { low: 2, medium: 4, high: 8 },
      motion: { fast: 100, normal: 180, slow: 280, easing: "ease" },
    },
    backgrounds: [{ type: "color", color: COLORS.canvas, opacity: 1 }],
    components: {
      composer: component,
      button: component,
      form: component,
      menu: { ...component, border: COLORS.border },
      chip: component,
      message: component,
      drawer: component,
      todo: component,
      diff: component,
      permission: component,
      question: component,
      code: { ...component, border: COLORS.border },
      table: { ...component, border: COLORS.border },
      terminal: { ...component, border: COLORS.border },
    },
    syntax: {
      plain: COLORS.text,
      comment: COLORS.textMuted,
      keyword: COLORS.accent,
      string: COLORS.success,
      number: COLORS.warning,
      function: COLORS.info,
      type: COLORS.info,
      variable: COLORS.textSecondary,
    },
    ansi: {
      black: COLORS.text,
      red: COLORS.danger,
      green: COLORS.success,
      yellow: COLORS.warning,
      blue: COLORS.info,
      magenta: COLORS.accent,
      cyan: COLORS.info,
      white: COLORS.surfaceRaised,
    },
    diff: {
      addedBackground: COLORS.surfaceMuted,
      addedText: COLORS.success,
      removedBackground: COLORS.surfaceMuted,
      removedText: COLORS.danger,
      hunkBackground: COLORS.surfaceMuted,
      lineNumber: COLORS.textMuted,
    },
    assets: [],
  };
}

test("minimal material projection stays flat for every built-in recipe", () => {
  for (const recipe of ["precision", "editorial", "gilded"] as const) {
    const variables = themeMaterialVariables(materialTheme(recipe));
    assert.equal(variables["--surface-backdrop-filter"], "none");
    assert.equal(variables["--menu-backdrop-filter"], "none");
    assert.equal(variables["--theme-decoration-image"], "none");
    assert.equal(variables["--theme-decoration-opacity"], "0");
    assert.equal(variables["--shadow-selected"], "none");
    assert.equal(variables["--shadow-primary-action"], "none");
    assert.equal(variables["--shadow-control-stroke"], "0 0 0 0 transparent");
    const projected = themeVariables(materialTheme(recipe));
    assert.equal(projected["--shadow-layout-start"], "none");
    assert.equal(projected["--shadow-layout-end"], "none");
    assert.match(
      variables["--shadow-menu-stroke"],
      /var\(--border-hairline, \.5px\)/,
    );
  }
});

test("custom themes retain their authored blur capability", () => {
  const variables = themeMaterialVariables(materialTheme(undefined));
  assert.equal(
    variables["--menu-backdrop-filter"],
    "blur(var(--blur-medium, 0px))",
  );
});

test("editorial material routes authored component borders and gray inline code", () => {
  const theme = materialTheme("editorial");
  theme.components.composer = {
    ...theme.components.composer,
    background: COLORS.surfaceRaised,
    border: COLORS.border,
  };
  theme.components.question = {
    ...theme.components.question,
    background: COLORS.surfaceRaised,
    border: COLORS.border,
  };

  const variables = themeMaterialVariables(theme);
  assert.equal(variables["--background-question"], COLORS.surfaceRaised);
  assert.equal(variables["--background-message"], COLORS.surfaceRaised);
  assert.equal(variables["--background-inline-code"], COLORS.surfaceMuted);
  assert.equal(variables["--color-inline-code"], COLORS.textSecondary);
  assert.equal(
    variables["--color-message-user"],
    variables["--color-navigation-selected"],
  );
  assert.equal(
    variables["--color-navigation-selected"],
    `color-mix(in srgb, ${COLORS.accent} 10%, ${COLORS.surfaceMuted})`,
  );
  assert.equal(
    variables["--shadow-message-elevation"],
    variables["--shadow-message-user-elevation"],
  );
  assert.equal(
    variables["--shadow-message-elevation"],
    "var(--shadow-content)",
  );
  assert.doesNotMatch(variables["--color-interactive-hover"], /transparent/);
  assert.notEqual(
    variables["--color-interactive-hover"],
    variables["--color-interactive-selected"],
  );
  assert.notEqual(
    variables["--color-interactive-selected"],
    variables["--color-interactive-pressed"],
  );
  assert.equal(
    variables["--background-form-active"],
    COLORS.accent,
  );
  assert.match(variables["--background-form-track"], /color-mix/);
  assert.equal(variables["--color-primary-action-icon"], undefined);
  assert.equal(variables["--color-composer-send-foreground"], undefined);
  assert.equal(variables["--shadow-composer-elevation"], "var(--shadow-control)");
  for (const token of [
    "--shadow-composer-stroke",
    "--shadow-question-stroke",
    "--shadow-inline-code-stroke",
  ]) {
    assert.match(variables[token], /var\(--border-hairline, \.5px\)/);
  }
});

test("composer send backgrounds and text selection colors follow appearance semantics", () => {
  const light = themeMaterialVariables(materialTheme("editorial"));
  assert.equal(
    light["--background-composer-send-idle"],
    `color-mix(in srgb, ${COLORS.accent} 58%, ${COLORS.surface})`,
  );
  assert.equal(light["--background-composer-send-active"], COLORS.accent);
  assert.equal(light["--selection-background"], COLORS.accent);

  const darkTheme = materialTheme("editorial");
  darkTheme.appearance = "dark";
  const dark = themeMaterialVariables(darkTheme);
  assert.equal(
    dark["--background-composer-send-idle"],
    `color-mix(in srgb, ${COLORS.accent} 58%, ${COLORS.surface})`,
  );
  assert.equal(
    dark["--background-composer-send-active"],
    COLORS.accent,
  );
  assert.equal(dark["--selection-background"], COLORS.accent);
});

test("control CSS preserves selected surfaces and routes all solid content through one authored foreground", () => {
  const control = readFileSync(
    new URL("../components/Control.module.css", import.meta.url),
    "utf8",
  );
  const feedback = readFileSync(
    new URL("../components/Feedback.module.css", import.meta.url),
    "utf8",
  );
  const composer = readFileSync(
    new URL("../../renderer/composer/Composer.module.css", import.meta.url),
    "utf8",
  );
  const semantic = readFileSync(
    new URL("./semantic.css", import.meta.url),
    "utf8",
  );
  const field = readFileSync(
    new URL("../components/Field.module.css", import.meta.url),
    "utf8",
  );
  const surface = readFileSync(
    new URL("../components/Surface.module.css", import.meta.url),
    "utf8",
  );
  const selection = readFileSync(
    new URL("../components/Selection.module.css", import.meta.url),
    "utf8",
  );

  assert.match(control, /--control-on-tone:\s*var\(--component-button-foreground,\s*var\(--color-accent-text\)\)/);
  assert.match(control, /data-appearance="solid"\][^{]*\{[^}]*color:\s*var\(--control-on-tone\)/);
  assert.doesNotMatch(control, /data-appearance="solid"\]\[data-icon-only="true"\]/);
  for (const source of [control, feedback, composer, semantic]) {
    assert.doesNotMatch(source, /--color-primary-action-icon|--color-composer-send-foreground|--control-icon-on-tone|--feedback-on-accent/);
  }
  assert.match(feedback, /data-tone="onAccent"[^}]+--component-button-foreground/);
  assert.match(composer, /--control-disabled-background:\s*var\(--background-composer-send-idle\)/);
  assert.match(composer, /--background-primary-action:\s*var\(--background-composer-send-active\)/);
  assert.match(control, /--control-disabled-background/);
  assert.match(
    control,
    /data-hover="surface"\]:hover:not\(\[data-selected="true"\]\):not\(\[aria-current="page"\]\)/,
  );
  assert.match(control, /aria-current="page"[^}]+--color-navigation-selected/);
  assert.match(field, /--background-form-track/);
  assert.match(field, /--background-form-active/);
  assert.match(field, /--color-form-active-foreground/);
  assert.match(field, /::-webkit-slider-runnable-track/);
  assert.match(field, /::-webkit-slider-thumb/);
  assert.match(surface, /--shadow-message-elevation/);
  assert.match(surface, /--shadow-message-user-elevation/);
  assert.match(selection, /--shadow-selection-rest/);
});

test("K2 radius uses one hierarchy and provides a Safari shape path", () => {
  const minimum = themeVariables(materialTheme(undefined), { cornerRadius: 4 });
  assert.equal(minimum["--radius-detail"], "2px");
  assert.equal(minimum["--radius-surface"], "4px");
  assert.equal(minimum["--corner-curve"], "squircle");

  const maximum = themeVariables(materialTheme(undefined), { cornerRadius: 64 });
  assert.equal(maximum["--radius-detail"], "21.3px");
  assert.equal(maximum["--radius-control"], "42.7px");
  assert.equal(maximum["--radius-surface"], "64px");
  assert.equal(maximum["--radius-dialog"], "85.3px");
  assert.match(maximum["--clip-k2-surface"], /^shape\(/);
  assert.match(maximum["--clip-k2-surface"], /curve to/);
  const globalCss = readFileSync(new URL("../../renderer/styles/global.css", import.meta.url), "utf8");
  assert.doesNotMatch(globalCss, /radius-mobile|radius-desktop/);
  assert.match(globalCss, /\[data-shape="surface"\]\s*\{\s*border-radius:\s*0;\s*clip-path:\s*var\(--clip-k2-surface\)/);
  assert.match(globalCss, /clip-path:\s*var\(--clip-k2-surface\)/);
});

test("background opacity is honored for every accepted CSS color form", () => {
  const theme = materialTheme(undefined);
  theme.backgrounds = [
    { type: "color", color: "rgba(20, 30, 40, .8)", opacity: 0.25 },
  ];
  assert.equal(
    themeVariables(theme)["--app-background"],
    "linear-gradient(color-mix(in srgb, rgba(20, 30, 40, .8) 25%, transparent), color-mix(in srgb, rgba(20, 30, 40, .8) 25%, transparent))",
  );
});

test("theme projection defines font roles without resolving their application scope", () => {
  const theme = materialTheme(undefined);
  theme.typography.ui = { ...theme.typography.ui, family: "Fixture UI" };
  theme.typography.body = { ...theme.typography.body, family: "Fixture Body" };
  theme.typography.heading = {
    ...theme.typography.heading,
    family: "Fixture Heading",
  };
  theme.typography.code = { ...theme.typography.code, family: "Fixture Code" };
  theme.typography.numeric = {
    ...theme.typography.numeric,
    family: "Fixture Numeric",
  };

  const variables = themeVariables(theme);
  for (const role of ["ui", "body", "heading", "code", "numeric"] as const) {
    assert.match(variables[`--theme-font-${role}`], /Fixture/);
    assert.equal(variables[`--font-${role}`], undefined);
  }
  assert.equal(variables["--theme-font-primary"], "var(--theme-font-body)");
});

test("font scope CSS routes every semantic family through one scope matrix", () => {
  const styles = readFileSync(new URL("./components.css", import.meta.url), "utf8");
  const globalRule = styles.match(
    /html\[data-font-family-scope="global"\]\s*\{(?<body>[^}]+)\}/,
  )?.groups?.body;
  const fallbackRule = styles.match(
    /html\[data-font-family-scope="conversation"\],\s*html\[data-font-family-scope="content"\]\s*\{(?<body>[^}]+)\}/,
  )?.groups?.body;
  const scopedRule = styles.match(
    /html\[data-font-family-scope="conversation"\]\s*\[data-typography-scope="conversation"\],\s*html\[data-font-family-scope="content"\]\s*\[data-typography-scope="content"\]\s*\{(?<body>[^}]+)\}/,
  )?.groups?.body;

  assert.ok(globalRule);
  assert.ok(fallbackRule);
  assert.ok(scopedRule);
  for (const role of ["ui", "body", "heading"] as const) {
    assert.match(globalRule, new RegExp(`--font-${role}: var\\(--theme-font-primary\\)`));
  }
  for (const role of ["code", "numeric"] as const) {
    assert.match(globalRule, new RegExp(`--font-${role}: var\\(--theme-font-${role}\\)`));
  }
  for (const role of ["ui", "body", "heading", "code", "numeric"] as const) {
    assert.match(fallbackRule, new RegExp(`--font-${role}:`));
  }
  for (const role of ["body", "heading", "code", "numeric"] as const) {
    assert.match(scopedRule, new RegExp(`--font-${role}: var\\(--theme-font-${role}\\)`));
  }
  assert.doesNotMatch(scopedRule, /--font-ui:/);
  assert.doesNotMatch(
    styles,
    /data-font-family-scope="conversation"\]\s*\[data-typography-scope="content"\]/,
  );
});
