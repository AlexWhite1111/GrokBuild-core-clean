import { z } from "zod";

const ColorSchema = z
  .string()
  .trim()
  .regex(
    /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]{1,120}\)|(?:transparent|currentColor))$/i,
    "Expected a local CSS color value",
  );

const NumberTokenSchema = z.number().finite();

const SemanticColorTokensSchema = z.object({
  canvas: ColorSchema,
  sidebar: ColorSchema,
  surface: ColorSchema,
  surfaceRaised: ColorSchema,
  surfaceMuted: ColorSchema,
  border: ColorSchema,
  borderStrong: ColorSchema,
  text: ColorSchema,
  textSecondary: ColorSchema,
  textMuted: ColorSchema,
  accent: ColorSchema,
  accentText: ColorSchema,
  focus: ColorSchema,
  success: ColorSchema,
  warning: ColorSchema,
  danger: ColorSchema,
  info: ColorSchema,
});

const TypographyRoleSchema = z.object({
  family: z.string().trim().min(1).max(240),
  assetId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/)
    .optional(),
  size: z.number().min(9).max(72),
  weight: z.number().int().min(100).max(900),
  lineHeight: z.number().min(1).max(2.5),
  letterSpacing: z.number().min(-0.2).max(1),
  color: ColorSchema,
});

const DensityTokensSchema = z.object({
  unit: z.number().min(2).max(12),
  controlHeight: z.number().min(24).max(64),
  compactControlHeight: z.number().min(20).max(56),
  threadGap: z.number().min(4).max(48),
});

const ComponentTokensSchema = z.object({
  background: ColorSchema,
  foreground: ColorSchema,
  border: ColorSchema,
  accent: ColorSchema,
  muted: ColorSchema,
});

const ThemePersonalitySchema = z
  .object({
    pairId: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),
    pairName: z.string().trim().min(1).max(80),
    role: z.enum(["day", "night"]),
    recipe: z.enum(["precision", "editorial", "gilded"]),
    tagline: z.string().trim().min(1).max(160),
  })
  .strict();
type ThemePersonality = z.infer<typeof ThemePersonalitySchema>;

const ThemeAssetReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
  kind: z.enum(["font", "image", "texture"]),
  fileName: z.string().regex(/^[^/\\]{1,180}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});
export type ThemeAssetReference = z.infer<typeof ThemeAssetReferenceSchema>;

const BackgroundLayerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("color"),
    color: ColorSchema,
    opacity: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("gradient"),
    value: z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) =>
          /^(linear|radial)-gradient\(/i.test(value) &&
          !/(?:url\s*\(|https?:|javascript:)/i.test(value),
        "Expected a local gradient without URL content",
      ),
  }),
  z.object({
    type: z.literal("asset"),
    assetId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
    opacity: z.number().min(0).max(1),
    blur: z.number().min(0).max(80),
  }),
  z.object({
    type: z.literal("noise"),
    opacity: z.number().min(0).max(0.3),
    scale: z.number().min(0.25).max(8),
  }),
  z.object({
    type: z.literal("vibrancy"),
    material: z.enum(["sidebar", "under-window", "content"]),
    opacity: z.number().min(0).max(1),
  }),
]);

const SyntaxTokensSchema = z.object({
  plain: ColorSchema,
  comment: ColorSchema,
  keyword: ColorSchema,
  string: ColorSchema,
  number: ColorSchema,
  function: ColorSchema,
  type: ColorSchema,
  variable: ColorSchema,
});

const AnsiTokensSchema = z.object({
  black: ColorSchema,
  red: ColorSchema,
  green: ColorSchema,
  yellow: ColorSchema,
  blue: ColorSchema,
  magenta: ColorSchema,
  cyan: ColorSchema,
  white: ColorSchema,
});

const DiffTokensSchema = z.object({
  addedBackground: ColorSchema,
  addedText: ColorSchema,
  removedBackground: ColorSchema,
  removedText: ColorSchema,
  hunkBackground: ColorSchema,
  lineNumber: ColorSchema,
});

export const ThemeManifestV1Schema = z
  .object({
    $schema: z.literal("grok-build://schemas/theme-v1.json"),
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,95}$/),
    name: z.string().trim().min(1).max(120),
    appearance: z.enum(["light", "dark"]),
    personality: ThemePersonalitySchema.optional(),
    colors: SemanticColorTokensSchema,
    typography: z.object({
      ui: TypographyRoleSchema,
      body: TypographyRoleSchema,
      heading: TypographyRoleSchema,
      code: TypographyRoleSchema,
      numeric: TypographyRoleSchema,
    }),
    density: DensityTokensSchema,
    effects: z.object({
      radii: z.object({
        small: NumberTokenSchema,
        medium: NumberTokenSchema,
        large: NumberTokenSchema,
        pill: NumberTokenSchema,
      }),
      borders: z.object({
        hairline: NumberTokenSchema,
        regular: NumberTokenSchema,
        strong: NumberTokenSchema,
      }),
      shadows: z.object({
        veryLow: z.string().max(240),
        low: z.string().max(240),
        medium: z.string().max(240),
        high: z.string().max(240),
        veryHigh: z.string().max(240),
      }),
      blur: z.object({
        low: NumberTokenSchema,
        medium: NumberTokenSchema,
        high: NumberTokenSchema,
      }),
      motion: z.object({
        fast: NumberTokenSchema,
        normal: NumberTokenSchema,
        slow: NumberTokenSchema,
        easing: z.string().max(120),
      }),
    }),
    backgrounds: z.array(BackgroundLayerSchema).max(12),
    components: z.object({
      composer: ComponentTokensSchema,
      button: ComponentTokensSchema,
      form: ComponentTokensSchema,
      menu: ComponentTokensSchema,
      chip: ComponentTokensSchema,
      message: ComponentTokensSchema,
      drawer: ComponentTokensSchema,
      todo: ComponentTokensSchema,
      diff: ComponentTokensSchema,
      permission: ComponentTokensSchema,
      question: ComponentTokensSchema,
      code: ComponentTokensSchema,
      table: ComponentTokensSchema,
      terminal: ComponentTokensSchema,
    }),
    syntax: SyntaxTokensSchema,
    ansi: AnsiTokensSchema,
    diff: DiffTokensSchema,
    assets: z.array(ThemeAssetReferenceSchema).max(64),
  })
  .strict()
  .superRefine((theme, context) => {
    if (!theme.personality) return;
    const expectedAppearance =
      theme.personality.role === "day" ? "light" : "dark";
    if (theme.appearance === expectedAppearance) return;
    context.addIssue({
      code: "custom",
      path: ["personality", "role"],
      message: `Theme role ${theme.personality.role} requires appearance ${expectedAppearance}.`,
    });
  });

export type ThemeManifestV1 = z.infer<typeof ThemeManifestV1Schema>;

export interface ThemeSwatchTokens {
  canvas: string;
  sidebar: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  accent: string;
  text: string;
}

export interface ThemeLibraryEntry {
  id: string;
  name: string;
  appearance: "light" | "dark";
  builtIn: boolean;
  selected: boolean;
  fileName: string | null;
  assetCount: number;
  warnings: string[];
  personality: ThemePersonality | null;
  swatch: ThemeSwatchTokens;
}

export interface ThemeLibrarySnapshot {
  selectedThemeId: string;
  systemLightThemeId: string;
  systemDarkThemeId: string;
  followSystem: boolean;
  themes: ThemeLibraryEntry[];
}

export const ThemeSaveSchema = z.object({
  requestId: z.string().uuid(),
  manifest: ThemeManifestV1Schema,
  overwrite: z.boolean().default(false),
});

export const ThemeSelectSchema = z.object({
  requestId: z.string().uuid(),
  themeId: z.string().min(1).max(96),
  followSystem: z.boolean().optional(),
});

export const ThemePreferencesMutationSchema = z.object({
  requestId: z.string().uuid(),
  systemLightThemeId: z.string().min(1).max(96),
  systemDarkThemeId: z.string().min(1).max(96),
});

export const ThemeRenameSchema = z.object({
  requestId: z.string().uuid(),
  themeId: z.string().min(1).max(96),
  nextId: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,95}$/),
  nextName: z.string().trim().min(1).max(120),
});

export const ThemeAssetImportSchema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["font", "image", "texture"]),
  fileName: z.string().regex(/^[^/\\]{1,180}$/),
  dataBase64: z.string().min(1).max(20_000_000),
});

export const ThemeAssetDiscardSchema = z.object({
  requestId: z.string().uuid(),
  assetId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
});

export const ThemeBundleV1Schema = z
  .object({
    $schema: z.literal("grok-build://schemas/theme-bundle-v1.json"),
    manifest: ThemeManifestV1Schema,
    assets: z
      .array(
        z.object({
          reference: ThemeAssetReferenceSchema,
          dataBase64: z.string().min(1).max(20_000_000),
        }),
      )
      .max(64),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();
export type ThemeBundleV1 = z.infer<typeof ThemeBundleV1Schema>;

export const ThemeBundleImportSchema = z.object({
  requestId: z.string().uuid(),
  bundle: ThemeBundleV1Schema,
  overwrite: z.boolean().default(false),
});

export const ThemeBundleExportSchema = z.object({
  requestId: z.string().uuid(),
  manifest: ThemeManifestV1Schema,
});
