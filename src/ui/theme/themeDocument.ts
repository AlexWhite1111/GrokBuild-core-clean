import type { ThemeManifestV1, UiPreferences } from "../../shared/contracts.js";
import { THEME_APPLIED_EVENT, themeFontFaces } from "./themeVariables.js";

const appliedVariableNames = new WeakMap<Document, Set<string>>();

/** Applies a fully projected theme to the document from one authoritative path. */
export function applyThemeToDocument(
  theme: ThemeManifestV1,
  variables: Record<string, string>,
  fontFamilyScope: UiPreferences["fontFamilyScope"],
  target: Document = document,
): void {
  const root = target.documentElement;
  const nextNames = new Set(Object.keys(variables));
  const previousNames = appliedVariableNames.get(target) ?? new Set<string>();

  for (const name of previousNames) {
    if (!nextNames.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  appliedVariableNames.set(target, nextNames);

  root.dataset.theme = theme.id;
  root.dataset.appearance = theme.appearance;
  root.dataset.fontFamilyScope = fontFamilyScope;
  applyThemePersonalityDataset(root, theme);
  root.style.colorScheme = theme.appearance;

  let themeColor = target.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = target.createElement("meta");
    themeColor.name = "theme-color";
    target.head.append(themeColor);
  }
  themeColor.content = theme.colors.canvas;

  let style = target.querySelector<HTMLStyleElement>("style[data-grok-theme-fonts]");
  if (!style) {
    style = target.createElement("style");
    style.dataset.grokThemeFonts = "true";
    target.head.append(style);
  }
  style.textContent = themeFontFaces(theme);

  const EventConstructor = target.defaultView?.Event ?? Event;
  target.defaultView?.dispatchEvent(new EventConstructor(THEME_APPLIED_EVENT));
}

function applyThemePersonalityDataset(
  root: HTMLElement,
  theme: Pick<ThemeManifestV1, "personality">,
): void {
  if (!theme.personality) {
    delete root.dataset.themeRecipe;
    delete root.dataset.themePair;
    delete root.dataset.themeRole;
    return;
  }
  root.dataset.themeRecipe = theme.personality.recipe;
  root.dataset.themePair = theme.personality.pairId;
  root.dataset.themeRole = theme.personality.role;
}
