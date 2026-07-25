import {
  FONT_WEIGHT_DEFAULT,
  type UiPreferences,
} from "../../shared/contracts.js";

/** Applies persisted visual preferences from one canonical projection. */
export function applyUiVisualPreferences(
  preferences: Pick<
    UiPreferences,
    | "fontScale"
    | "fontWeight"
    | "layoutScale"
    | "lineSpacing"
    | "letterSpacing"
    | "readingWidth"
  >,
  target: Document = document,
): void {
  const root = target.documentElement;
  root.style.setProperty("--font-scale", String(preferences.fontScale / 100));
  root.style.setProperty(
    "--font-weight-adjust",
    String(preferences.fontWeight - FONT_WEIGHT_DEFAULT),
  );
  root.style.setProperty(
    "--layout-density-scale",
    String(preferences.layoutScale / 100),
  );
  root.style.setProperty(
    "--line-spacing-scale",
    String(preferences.lineSpacing / 100),
  );
  root.style.setProperty(
    "--letter-spacing-adjust",
    `${preferences.letterSpacing / 100}em`,
  );
  root.style.setProperty(
    "--conversation-max-width",
    preferences.readingWidth === 0
      ? "100%"
      : `${Math.max(640, Math.min(1600, preferences.readingWidth))}px`,
  );
}
