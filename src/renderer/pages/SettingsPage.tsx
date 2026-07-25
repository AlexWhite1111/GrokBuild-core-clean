import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AccountSettings } from "../settings/AccountSettings.js";
import { ArchivedTasksSettings } from "../settings/ArchivedTasksSettings.js";
import { ConfigSettings } from "../settings/ConfigSettings.js";
import { GeneralSettings } from "../settings/GeneralSettings.js";
import { MemorySettings } from "../settings/MemorySettings.js";
import { PermissionSettings } from "../settings/PermissionSettings.js";
import { ThemeStudio } from "../themes/ThemeStudio.js";
import { AutomationsPage } from "./AutomationsPage.js";
import { DiagnosticsPage } from "./DiagnosticsPage.js";
import { ExtensionsPage } from "./ExtensionsPage.js";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { t } = useTranslation();
  const { section = "general", subsection } = useParams();
  if (section === "extensions") return <ExtensionsPage category={subsection} basePath="/settings/extensions" />;
  if (section === "automations") return <AutomationsPage />;
  if (section === "diagnostics") return <DiagnosticsPage />;
  if (section === "language") return <Navigate to="/settings/general" replace />;
  const content = {
    general: <GeneralSettings />, appearance: <ThemeStudio />, account: <AccountSettings />,
    permissions: <PermissionSettings />, configuration: <ConfigSettings />, memory: <MemorySettings />,
    archived: <ArchivedTasksSettings />,
  }[section] || <ConfigSettings />;
  return <main className={styles.page}><header><h1>{title(section, t)}</h1><p>{t(subtitleKey(section))}</p></header>{content}</main>;
}

function title(section: string, t: (key: string) => string): string {
  const key = { general: "general", appearance: "appearanceThemes", account: "accountModels", permissions: "permissionsSandbox", configuration: "configuration", memory: "memoryLabel", archived: "archivedTasks" }[section];
  return t(key || "configuration");
}

function subtitleKey(section: string): string {
  return {
    general: "generalSettingsSubtitle",
    appearance: "themeSettingsSubtitle",
    account: "accountSettingsSubtitle",
    permissions: "permissionSettingsSubtitle",
    configuration: "settingsSourceSubtitle",
    memory: "memorySettingsSubtitle",
    archived: "archiveSettingsSubtitle",
  }[section] || "settingsSourceSubtitle";
}
