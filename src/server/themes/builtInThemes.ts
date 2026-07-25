import type { ThemeManifestV1 } from "../../shared/contracts.js";
import {
  GLOBAL_THEME_GEOMETRY,
  type ThemeTypographyRole,
} from "../../shared/themeGeometry.js";

type Palette = ThemeManifestV1["colors"];
type Personality = NonNullable<ThemeManifestV1["personality"]>;
type ThemeRecipe = Personality["recipe"];
type Appearance = ThemeManifestV1["appearance"];
type ComponentTokens =
  ThemeManifestV1["components"][keyof ThemeManifestV1["components"]];

const UI_SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif';
const DISPLAY_SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif';
const BODY_SERIF =
  '"Noto Serif SC Variable", "Songti SC", STSong, "Noto Serif CJK SC", serif';
const CODE = 'SFMono-Regular, "SF Mono", ui-monospace, monospace';

/** 素墨：暖纸与松烟，强调阅读节奏而不是装饰纹理。 */
const plainPaperDay: Palette = {
  canvas: "#F3F0E8",
  sidebar: "#EAE5DB",
  surface: "#F6F3EC",
  surfaceRaised: "#FFFCF7",
  surfaceMuted: "#E3DDD2",
  border: "#D2C8BA",
  borderStrong: "#BEB3A5",
  text: "#2B2925",
  textSecondary: "#5C5851",
  textMuted: "#666159",
  accent: "#D16F50",
  accentText: "#2A130D",
  focus: "#C96444",
  success: "#4E7658",
  warning: "#9A681F",
  danger: "#B14D41",
  info: "#50718A",
};

const pineSootNight: Palette = {
  canvas: "#1F1F1E",
  sidebar: "#191918",
  surface: "#242423",
  surfaceRaised: "#2B2B2A",
  surfaceMuted: "#30302E",
  border: "#3B3B38",
  borderStrong: "#50504C",
  text: "#F0EDE7",
  textSecondary: "#C6C2BA",
  textMuted: "#969189",
  accent: "#E08A6B",
  accentText: "#2A130D",
  focus: "#EF9A78",
  success: "#89B28F",
  warning: "#D8A45E",
  danger: "#E07A70",
  info: "#86A9B7",
};

/** 天青：冷静、通透、近似青瓷釉色，但完全不使用玻璃拟态。 */
const celadonDay: Palette = {
  canvas: "#EFF3F0",
  sidebar: "#E8EDEA",
  surface: "#F4F7F5",
  surfaceRaised: "#FAFCFA",
  surfaceMuted: "#E1E8E4",
  border: "#CFD8D3",
  borderStrong: "#BBC8C1",
  text: "#25312D",
  textSecondary: "#52615C",
  textMuted: "#626F6A",
  accent: "#466F65",
  accentText: "#F7FBF9",
  focus: "#587F75",
  success: "#46745A",
  warning: "#8D662B",
  danger: "#9D4B47",
  info: "#496F82",
};

const indigoCeladonNight: Palette = {
  canvas: "#121817",
  sidebar: "#151D1B",
  surface: "#19211F",
  surfaceRaised: "#202A27",
  surfaceMuted: "#101614",
  border: "#28332F",
  borderStrong: "#3A4842",
  text: "#E8EEEB",
  textSecondary: "#B8C3BE",
  textMuted: "#8F9E98",
  accent: "#79AA9E",
  accentText: "#0B1B17",
  focus: "#8DBDB1",
  success: "#7EAF8D",
  warning: "#D0A261",
  danger: "#D47A73",
  info: "#79A8BD",
};

/** 丹漆：高对比白瓷与玄漆，以一笔丹红建立视觉秩序。 */
const porcelainDay: Palette = {
  canvas: "#F7F6F2",
  sidebar: "#F0EFEB",
  surface: "#FAF9F6",
  surfaceRaised: "#FFFFFF",
  surfaceMuted: "#EAE9E4",
  border: "#D8D6D0",
  borderStrong: "#C5C2BB",
  text: "#222220",
  textSecondary: "#555450",
  textMuted: "#6C6A64",
  accent: "#A44638",
  accentText: "#FFF8F5",
  focus: "#B85445",
  success: "#47705A",
  warning: "#8B622A",
  danger: "#A33D38",
  info: "#466B7C",
};

const lacquerNight: Palette = {
  canvas: "#121011",
  sidebar: "#171415",
  surface: "#1B1819",
  surfaceRaised: "#231F20",
  surfaceMuted: "#0E0D0D",
  border: "#302A2C",
  borderStrong: "#473D40",
  text: "#F0ECE7",
  textSecondary: "#C0B8B3",
  textMuted: "#998F8A",
  accent: "#D46C5C",
  accentText: "#25100C",
  focus: "#E17C6A",
  success: "#82AB8C",
  warning: "#CFA05D",
  danger: "#DC7770",
  info: "#7BA5B7",
};

function manifest(
  id: string,
  name: string,
  appearance: Appearance,
  colors: Palette,
  personality: Personality,
): ThemeManifestV1 {
  const syntaxTokens = syntax(personality.recipe, appearance, colors);
  return {
    $schema: "grok-build://schemas/theme-v1.json",
    schemaVersion: 1,
    id,
    name,
    appearance,
    personality,
    colors,
    typography: typography(personality.recipe, colors),
    density: { ...GLOBAL_THEME_GEOMETRY.density },
    effects: {
      radii: { ...GLOBAL_THEME_GEOMETRY.radii },
      borders: { ...GLOBAL_THEME_GEOMETRY.borders },
      shadows: shadows(personality.recipe, appearance),
      blur: { low: 0, medium: 0, high: 0 },
      motion: motion(personality.recipe),
    },
    backgrounds: [{ type: "color", color: colors.canvas, opacity: 1 }],
    components: components(personality.recipe, appearance, colors),
    syntax: syntaxTokens,
    ansi: {
      black: appearance === "dark" ? colors.canvas : colors.text,
      red: colors.danger,
      green: colors.success,
      yellow: colors.warning,
      blue: colors.info,
      magenta: syntaxTokens.keyword,
      cyan: syntaxTokens.type,
      white: appearance === "dark" ? colors.text : colors.surfaceRaised,
    },
    diff: diff(personality.recipe, appearance, colors),
    assets: [],
  };
}

function components(
  recipe: ThemeRecipe,
  appearance: Appearance,
  colors: Palette,
): ThemeManifestV1["components"] {
  const neutral = component(colors);
  const warning = component(colors, { accent: colors.warning });
  const question = component(colors, {
    background: recipe === "editorial" ? colors.surfaceRaised : colors.surface,
    border: recipe === "editorial" ? colors.border : "transparent",
    accent: colors.info,
  });
  const codeBackground =
    recipe === "editorial"
      ? appearance === "dark"
        ? "#101210"
        : "#ECE6DA"
      : recipe === "precision"
        ? appearance === "dark"
          ? "#0D1312"
          : "#E6ECE8"
        : appearance === "dark"
          ? "#0C0B0B"
          : "#ECEAE5";
  const terminalBackground =
    recipe === "precision"
      ? appearance === "dark"
        ? "#0A100F"
        : "#17201E"
      : recipe === "editorial"
        ? appearance === "dark"
          ? "#0C0E0C"
          : "#252722"
        : appearance === "dark"
          ? "#090808"
          : "#211E1E";

  return {
    composer: component(colors, {
      background: colors.surfaceRaised,
      border: recipe === "editorial" ? colors.border : "transparent",
    }),
    button: component(colors, {
      background: colors.surfaceMuted,
      foreground: colors.accentText,
      border: "transparent",
    }),
    form: component(colors, {
      background: colors.surfaceMuted,
      border: "transparent",
    }),
    menu: component(colors, {
      background: colors.surfaceRaised,
      border: colors.border,
    }),
    chip: component(colors, {
      background: colors.surfaceMuted,
      border: "transparent",
    }),
    message: component(colors, {
      background: "transparent",
      border: "transparent",
    }),
    drawer: component(colors, {
      background: colors.sidebar,
      border: "transparent",
    }),
    todo: neutral,
    diff: neutral,
    permission: warning,
    question,
    code: component(colors, {
      background: codeBackground,
      border: colors.border,
    }),
    table: component(colors, {
      background: colors.surface,
      foreground: colors.textSecondary,
      border: colors.border,
      accent: colors.surfaceMuted,
    }),
    terminal: component(colors, {
      background: terminalBackground,
      foreground: appearance === "dark" ? colors.text : "#F2F0EA",
      border: colors.border,
    }),
  };
}

function component(
  colors: Palette,
  overrides: Partial<ComponentTokens> = {},
): ComponentTokens {
  return {
    background: colors.surface,
    foreground: colors.text,
    border: "transparent",
    accent: colors.accent,
    muted: colors.textMuted,
    ...overrides,
  };
}

function typography(
  recipe: ThemeRecipe,
  colors: Palette,
): ThemeManifestV1["typography"] {
  if (recipe === "editorial") {
    return {
      ui: typeRole("ui", UI_SANS, 480, colors.text),
      body: typeRole("body", BODY_SERIF, 420, colors.text),
      heading: typeRole("heading", BODY_SERIF, 620, colors.text),
      code: typeRole("code", CODE, 420, colors.text),
      numeric: typeRole("numeric", CODE, 520, colors.textSecondary),
    };
  }
  if (recipe === "precision") {
    return {
      ui: typeRole("ui", UI_SANS, 470, colors.text),
      body: typeRole("body", UI_SANS, 400, colors.text),
      heading: typeRole("heading", DISPLAY_SANS, 620, colors.text),
      code: typeRole("code", CODE, 420, colors.text),
      numeric: typeRole("numeric", CODE, 530, colors.textSecondary),
    };
  }
  return {
    ui: typeRole("ui", UI_SANS, 500, colors.text),
    body: typeRole("body", UI_SANS, 410, colors.text),
    heading: typeRole("heading", BODY_SERIF, 650, colors.text),
    code: typeRole("code", CODE, 430, colors.text),
    numeric: typeRole("numeric", CODE, 550, colors.textSecondary),
  };
}

function typeRole(
  role: ThemeTypographyRole,
  family: string,
  weight: number,
  color: string,
): ThemeManifestV1["typography"][ThemeTypographyRole] {
  return { family, weight, color, ...GLOBAL_THEME_GEOMETRY.typography[role] };
}

function motion(recipe: ThemeRecipe): ThemeManifestV1["effects"]["motion"] {
  if (recipe === "editorial") {
    return {
      fast: 120,
      normal: 190,
      slow: 300,
      easing: "cubic-bezier(.2,.72,.2,1)",
    };
  }
  if (recipe === "precision") {
    return {
      fast: 100,
      normal: 165,
      slow: 260,
      easing: "cubic-bezier(.22,1,.36,1)",
    };
  }
  return {
    fast: 110,
    normal: 180,
    slow: 280,
    easing: "cubic-bezier(.18,.82,.24,1)",
  };
}

function shadows(
  recipe: ThemeRecipe,
  appearance: Appearance,
): ThemeManifestV1["effects"]["shadows"] {
  const dark = appearance === "dark";
  const tint =
    recipe === "editorial"
      ? dark
        ? "0,0,0"
        : "61,48,32"
      : recipe === "precision"
        ? dark
          ? "0,0,0"
          : "34,57,49"
        : dark
          ? "0,0,0"
          : "36,30,31";
  return {
    veryLow: dark
      ? `0 1px 2px -1px rgba(${tint},.28), 0 5px 14px -10px rgba(${tint},.34)`
      : `0 1px 2px -1px rgba(${tint},.08), 0 5px 14px -10px rgba(${tint},.16)`,
    low: dark
      ? `0 2px 5px -2px rgba(${tint},.34), 0 10px 24px -14px rgba(${tint},.44)`
      : `0 2px 5px -2px rgba(${tint},.10), 0 10px 24px -14px rgba(${tint},.20)`,
    medium: dark
      ? `0 12px 32px -18px rgba(${tint},.56)`
      : `0 12px 32px -18px rgba(${tint},.22)`,
    high: dark
      ? `0 22px 56px -24px rgba(${tint},.68)`
      : `0 22px 56px -24px rgba(${tint},.28)`,
    veryHigh: dark
      ? `0 32px 82px -30px rgba(${tint},.76)`
      : `0 32px 82px -30px rgba(${tint},.34)`,
  };
}

function syntax(
  recipe: ThemeRecipe,
  appearance: Appearance,
  colors: Palette,
): ThemeManifestV1["syntax"] {
  if (appearance === "dark") {
    if (recipe === "editorial") {
      return {
        plain: colors.text,
        comment: "#918B80",
        keyword: "#D69AAA",
        string: "#91B79A",
        number: "#D6A06E",
        function: "#87AEB8",
        type: "#8AADA3",
        variable: "#CEB878",
      };
    }
    if (recipe === "precision") {
      return {
        plain: colors.text,
        comment: "#82928C",
        keyword: "#B6A3D8",
        string: "#83B99A",
        number: "#D2A06F",
        function: "#7EABC0",
        type: "#76B2A8",
        variable: "#C7B875",
      };
    }
    return {
      plain: colors.text,
      comment: "#8F8784",
      keyword: "#CBA0C0",
      string: "#88B494",
      number: "#D5A06A",
      function: "#82A9BA",
      type: "#94A9A1",
      variable: "#D0B76A",
    };
  }

  if (recipe === "editorial") {
    return {
      plain: colors.text,
      comment: "#726C62",
      keyword: "#873E54",
      string: "#416A49",
      number: "#925B2A",
      function: "#456A74",
      type: "#4C6D65",
      variable: "#735F28",
    };
  }
  if (recipe === "precision") {
    return {
      plain: colors.text,
      comment: "#65736D",
      keyword: "#654B8B",
      string: "#356C4B",
      number: "#8F5A29",
      function: "#3C6578",
      type: "#346D65",
      variable: "#6F6128",
    };
  }
  return {
    plain: colors.text,
    comment: "#6D6964",
    keyword: "#734C72",
    string: "#386A4D",
    number: "#925D28",
    function: "#3C6578",
    type: "#516C65",
    variable: "#745E25",
  };
}

function diff(
  recipe: ThemeRecipe,
  appearance: Appearance,
  colors: Palette,
): ThemeManifestV1["diff"] {
  if (appearance === "dark") {
    return {
      addedBackground: recipe === "precision" ? "#173127" : "#193025",
      addedText: "#A3D2B1",
      removedBackground: recipe === "gilded" ? "#361E21" : "#342022",
      removedText: "#EEAAA4",
      hunkBackground: recipe === "precision" ? "#172B2E" : "#25282A",
      lineNumber: colors.textMuted,
    };
  }
  return {
    addedBackground: recipe === "precision" ? "#DDEBE2" : "#E1EADD",
    addedText: "#2B5C3C",
    removedBackground: recipe === "gilded" ? "#F2DFDB" : "#F0E0DC",
    removedText: "#84382F",
    hunkBackground: recipe === "precision" ? "#DEE9E7" : "#E6E7E4",
    lineNumber: colors.textMuted,
  };
}

export const BUILT_IN_THEMES: readonly ThemeManifestV1[] = [
  manifest("grok-linen-light", "素笺 · 昼", "light", plainPaperDay, {
    pairId: "plain-ink",
    pairName: "素墨",
    role: "day",
    recipe: "editorial",
    tagline: "暖纸留白、松烟墨字与克制朱砂",
  }),
  manifest("grok-ink-dark", "松烟 · 夜", "dark", pineSootNight, {
    pairId: "plain-ink",
    pairName: "素墨",
    role: "night",
    recipe: "editorial",
    tagline: "松烟墨底、暖白长文与沉静朱砂",
  }),
  manifest("codex-neutral-light", "天青 · 昼", "light", celadonDay, {
    pairId: "celadon-stillness",
    pairName: "天青",
    role: "day",
    recipe: "precision",
    tagline: "青瓷冷白、雾灰层次与竹青焦点",
  }),
  manifest("codex-neutral-dark", "黛青 · 夜", "dark", indigoCeladonNight, {
    pairId: "celadon-stillness",
    pairName: "天青",
    role: "night",
    recipe: "precision",
    tagline: "黛青夜色、低明度表面与玉色焦点",
  }),
  manifest("gilded-daylight", "白瓷 · 昼", "light", porcelainDay, {
    pairId: "cinnabar-lacquer",
    pairName: "丹漆",
    role: "day",
    recipe: "gilded",
    tagline: "白瓷留白、黑字秩序与一笔丹红",
  }),
  manifest("midnight-gilded", "玄漆 · 夜", "dark", lacquerNight, {
    pairId: "cinnabar-lacquer",
    pairName: "丹漆",
    role: "night",
    recipe: "gilded",
    tagline: "玄漆深底、暖白文字与丹红点睛",
  }),
];
