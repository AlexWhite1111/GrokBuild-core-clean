import { Monitor, MoonStar, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeSelectIntent, useThemes } from "../api/hooks.js";
import { activeThemeMode, nextThemeSelection } from "../../ui/theme/index.js";
import { Control } from "../../ui/components/index.js";
import styles from "./Sidebar.module.css";

export function ThemeShortcut() {
  const { t } = useTranslation();
  const library = useThemes().data;
  const select = useThemeSelectIntent();
  const mode = activeThemeMode(library);
  const action = t(mode === "day" ? "switchToNight" : mode === "night" ? "switchToSystem" : "switchToDay");
  return <Control recipe="row" className={styles.navButton} disabled={select.isPending} aria-label={action} title={action} onClick={() => select.mutate(nextThemeSelection(library))}>
    {mode === "day" ? <Sun size={15} /> : mode === "night" ? <MoonStar size={15} /> : <Monitor size={15} />}
    <span>{t(mode === "day" ? "dayTheme" : mode === "night" ? "nightTheme" : "systemTheme")}</span>
  </Control>;
}
