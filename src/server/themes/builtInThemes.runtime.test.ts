import assert from "node:assert/strict";
import test from "node:test";
import { ThemeManifestV1Schema } from "../../shared/contracts.js";
import { BUILT_IN_THEMES } from "./builtInThemes.js";
import { collectThemeWarnings } from "./themeWarnings.js";

const EXPECTED_IDS = new Set([
  "codex-neutral-light",
  "codex-neutral-dark",
  "grok-linen-light",
  "grok-ink-dark",
  "gilded-daylight",
  "midnight-gilded",
]);

test("built-in theme library is six valid themes arranged as three complete day/night pairs", () => {
  assert.equal(BUILT_IN_THEMES.length, 6);
  assert.deepEqual(
    new Set(BUILT_IN_THEMES.map((theme) => theme.id)),
    EXPECTED_IDS,
  );

  const pairs = new Map<string, (typeof BUILT_IN_THEMES)[number][]>();
  for (const theme of BUILT_IN_THEMES) {
    assert.doesNotThrow(() => ThemeManifestV1Schema.parse(theme), theme.id);
    assert.deepEqual(
      collectThemeWarnings(theme),
      [],
      `${theme.id} should ship without accessibility warnings`,
    );
    assert.ok(
      theme.personality,
      `${theme.id} must declare its paired personality`,
    );
    assert.equal(
      theme.appearance,
      theme.personality.role === "day" ? "light" : "dark",
      `${theme.id} role and appearance must agree`,
    );
    assert.deepEqual(theme.effects.blur, { low: 0, medium: 0, high: 0 });
    for (const shadow of Object.values(theme.effects.shadows)) {
      assert.notEqual(shadow, "none");
    }
    assert.equal(theme.backgrounds.length, 1);
    assert.equal(theme.backgrounds[0]?.type, "color");
    assert.equal(
      theme.components.composer.border,
      theme.personality.recipe === "editorial" ? theme.colors.border : "transparent",
    );
    assert.equal(
      theme.components.question.border,
      theme.personality.recipe === "editorial" ? theme.colors.border : "transparent",
    );
    assert.equal(theme.components.form.border, "transparent");
    assert.equal(theme.components.button.border, "transparent");
    assert.equal(theme.components.message.border, "transparent");
    assert.equal(theme.components.drawer.border, "transparent");

    const current = pairs.get(theme.personality.pairId) ?? [];
    current.push(theme);
    pairs.set(theme.personality.pairId, current);
  }

  assert.equal(pairs.size, 3);
  for (const [pairId, themes] of pairs) {
    assert.equal(themes.length, 2, `${pairId} must contain exactly two themes`);
    const day = themes.find((theme) => theme.personality?.role === "day");
    const night = themes.find((theme) => theme.personality?.role === "night");
    assert.ok(day, `${pairId} is missing its day theme`);
    assert.ok(night, `${pairId} is missing its night theme`);
    assert.equal(day.appearance, "light");
    assert.equal(night.appearance, "dark");
    assert.equal(day.personality?.recipe, night.personality?.recipe);
    assert.equal(day.personality?.pairName, night.personality?.pairName);
    assert.notEqual(day.colors.canvas, night.colors.canvas);
    assert.notEqual(day.colors.text, night.colors.text);
  }
});

test("theme personality roles cannot contradict their light or dark appearance", () => {
  const invalid = structuredClone(BUILT_IN_THEMES[0]);
  invalid.personality = { ...invalid.personality!, role: "night" };
  const result = ThemeManifestV1Schema.safeParse(invalid);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) => issue.path.join(".") === "personality.role",
      ),
    );
  }
});

test("the three theme pairs stay minimal while retaining distinct Chinese design signatures", () => {
  const recipeRepresentatives = new Map<
    string,
    (typeof BUILT_IN_THEMES)[number]
  >();
  for (const theme of BUILT_IN_THEMES) {
    if (theme.personality?.role === "day")
      recipeRepresentatives.set(theme.personality.recipe, theme);
  }

  assert.deepEqual(
    new Set(recipeRepresentatives.keys()),
    new Set(["precision", "editorial", "gilded"]),
  );
  const signatures = [...recipeRepresentatives.values()].map((theme) =>
    JSON.stringify({
      typography: Object.fromEntries(
        Object.entries(theme.typography).map(([role, token]) => [
          role,
          token.family,
        ]),
      ),
      canvas: theme.colors.canvas,
      sidebar: theme.colors.sidebar,
      accent: theme.colors.accent,
      code: theme.components.code.background,
      motion: theme.effects.motion,
    }),
  );
  assert.equal(
    new Set(signatures).size,
    3,
    "each pair must own a distinct palette, type, code, and motion language",
  );

  const precision = recipeRepresentatives.get("precision")!;
  const editorial = recipeRepresentatives.get("editorial")!;
  const gilded = recipeRepresentatives.get("gilded")!;
  assert.match(precision.typography.body.family, /sans-serif/i);
  assert.match(editorial.typography.body.family, /serif/i);
  assert.match(gilded.typography.heading.family, /serif/i);
  assert.match(gilded.typography.body.family, /sans-serif/i);
});

test("only the plain-ink pair owns the Claude-style layered palette", () => {
  const day = BUILT_IN_THEMES.find((theme) => theme.id === "grok-linen-light")!;
  const night = BUILT_IN_THEMES.find((theme) => theme.id === "grok-ink-dark")!;

  assert.deepEqual(
    {
      canvas: day.colors.canvas,
      sidebar: day.colors.sidebar,
      surface: day.colors.surface,
      surfaceRaised: day.colors.surfaceRaised,
      surfaceMuted: day.colors.surfaceMuted,
      accent: day.colors.accent,
    },
    {
      canvas: "#F3F0E8",
      sidebar: "#EAE5DB",
      surface: "#F6F3EC",
      surfaceRaised: "#FFFCF7",
      surfaceMuted: "#E3DDD2",
      accent: "#D16F50",
    },
  );
  assert.deepEqual(
    {
      canvas: night.colors.canvas,
      sidebar: night.colors.sidebar,
      surface: night.colors.surface,
      surfaceRaised: night.colors.surfaceRaised,
      surfaceMuted: night.colors.surfaceMuted,
      accent: night.colors.accent,
    },
    {
      canvas: "#1F1F1E",
      sidebar: "#191918",
      surface: "#242423",
      surfaceRaised: "#2B2B2A",
      surfaceMuted: "#30302E",
      accent: "#E08A6B",
    },
  );

  for (const theme of [day, night]) {
    assert.notEqual(theme.colors.canvas, theme.colors.sidebar);
    assert.notEqual(theme.colors.canvas, theme.colors.surface);
    assert.notEqual(theme.colors.surface, theme.colors.surfaceRaised);
    assert.notEqual(theme.colors.surface, theme.colors.surfaceMuted);
    assert.equal(theme.components.composer.border, theme.colors.border);
    assert.equal(theme.components.question.background, theme.colors.surfaceRaised);
    assert.equal(theme.components.question.border, theme.colors.border);
  }
});
