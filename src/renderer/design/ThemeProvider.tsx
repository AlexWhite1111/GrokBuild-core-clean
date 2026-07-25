import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { ThemeManifestV1 } from "../../shared/contracts.js";
import { useTheme, useThemes, useUiPreferences } from "../api/hooks.js";
import {
  CORNER_RADIUS_PREVIEW_EVENT,
  THEME_PREVIEW_EVENT,
  activeThemeId,
  applyThemeToDocument,
  themeVariables,
} from "../../ui/theme/index.js";
import { useSystemDark } from "./useSystemDark.js";

export function ThemeProvider({ children }: PropsWithChildren) {
  const library = useThemes();
  const preferences = useUiPreferences();
  const systemDark = useSystemDark();
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [cornerRadiusPreview, setCornerRadiusPreview] = useState<number | null>(
    null,
  );
  const [themePreview, setThemePreview] = useState<ThemeManifestV1 | null>(null);
  const themeId = activeThemeId(library.data, systemDark);
  const theme = useTheme(themeId);
  const appliedTheme = themePreview ?? theme.data;
  const cornerRadius = cornerRadiusPreview ?? preferences.data.cornerRadius;
  const variables = useMemo(
    () =>
      appliedTheme
        ? themeVariables(appliedTheme, {
            cornerRadius,
            reduceMotion: reducedMotion,
          })
        : {},
    [
      appliedTheme,
      cornerRadius,
      reducedMotion,
    ],
  );

  useLayoutEffect(() => {
    if (!appliedTheme) return;
    applyThemeToDocument(
      appliedTheme,
      variables,
      preferences.data.fontFamilyScope,
    );
  }, [appliedTheme, preferences.data.fontFamilyScope, variables]);

  useEffect(() => {
    const preview = (event: Event) => {
      const value = (event as CustomEvent<ThemeManifestV1 | null>).detail;
      setThemePreview(value && typeof value === "object" ? value : null);
    };
    window.addEventListener(THEME_PREVIEW_EVENT, preview);
    return () => window.removeEventListener(THEME_PREVIEW_EVENT, preview);
  }, []);

  useEffect(() => {
    const preview = (event: Event) => {
      const value = (event as CustomEvent<number | null>).detail;
      setCornerRadiusPreview(
        typeof value === "number" && Number.isFinite(value) ? value : null,
      );
    };
    window.addEventListener(CORNER_RADIUS_PREVIEW_EVENT, preview);
    return () =>
      window.removeEventListener(CORNER_RADIUS_PREVIEW_EVENT, preview);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  return children;
}
