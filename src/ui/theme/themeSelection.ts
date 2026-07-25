import type { ThemeLibrarySnapshot } from "../../shared/contracts.js";

type ThemeMode = "day" | "night" | "system";

export function activeThemeId(library: ThemeLibrarySnapshot, systemDark: boolean): string {
  if (!library.followSystem) return library.selectedThemeId;
  return systemDark ? library.systemDarkThemeId : library.systemLightThemeId;
}

export function activeThemeMode(library: ThemeLibrarySnapshot): ThemeMode {
  if (library.followSystem) return "system";
  if (library.systemLightThemeId !== library.systemDarkThemeId) {
    if (library.selectedThemeId === library.systemDarkThemeId) return "night";
    if (library.selectedThemeId === library.systemLightThemeId) return "day";
  }
  return library.themes.find((theme) => theme.id === library.selectedThemeId)?.appearance === "dark" ? "night" : "day";
}

export function nextThemeSelection(library: ThemeLibrarySnapshot): { themeId: string; followSystem: boolean } {
  const mode = activeThemeMode(library);
  if (mode === "day") return { themeId: library.systemDarkThemeId, followSystem: false };
  if (mode === "night") return { themeId: library.selectedThemeId, followSystem: true };
  return { themeId: library.systemLightThemeId, followSystem: false };
}
