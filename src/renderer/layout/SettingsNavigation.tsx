import { Archive, Blocks, Bot, Brain, Bug, ChevronLeft, KeyRound, Palette, Settings2, Shield, SlidersHorizontal } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Control, Surface } from "../../ui/components/index.js";
import styles from "./SettingsNavigation.module.css";

const items = [
  ["general", "general", Settings2, "/settings/general"], ["appearance", "appearanceThemes", Palette, "/settings/appearance"],
  ["account", "accountModels", KeyRound, "/settings/account"], ["permissions", "permissionsSandbox", Shield, "/settings/permissions"],
  ["configuration", "configuration", SlidersHorizontal, "/settings/configuration"],
  ["extensions", "extensions", Blocks, "/settings/extensions"], ["memory", "memoryLabel", Brain, "/settings/memory"],
  ["archived", "archivedTasks", Archive, "/settings/archived"],
  ["automations", "automations", Bot, "/settings/automations"],
  ["diagnostics", "diagnostics", Bug, "/settings/diagnostics"],
] as const;

export function SettingsNavigation() {
  const { t } = useTranslation();
  return <Surface as="aside" appearance="sidebar" shape="none" className={styles.sidebar}>
    <Control asChild recipe="row" className={styles.back}><NavLink to="/new"><ChevronLeft size={15} />{t("backToTasks")}</NavLink></Control>
    <h1>{t("settings")}</h1>
    <nav>{items.map(([id, key, Icon, to]) => <Control key={id} asChild recipe="row" className={styles.item}><NavLink to={to}>
      <Icon size={15} /><span>{t(key)}</span>
    </NavLink></Control>)}</nav>
  </Surface>;
}
