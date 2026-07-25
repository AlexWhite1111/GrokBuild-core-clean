import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProjectDefaults, SandboxProfile } from "../../shared/contracts.js";
import { useProjectIntents, useWorkspace } from "../api/hooks.js";
import { Notice, SegmentedControl, SettingCard, Switch } from "../../ui/components/index.js";
import styles from "./SettingsPanels.module.css";

export function PermissionSettings() {
  const { t } = useTranslation();
  const workspace = useWorkspace().data;
  const project = workspace.projects.find((item) => item.active) || workspace.projects[0];
  const projects = useProjectIntents();
  const updateDefaults = (defaults: ProjectDefaults) => {
    if (project) projects.defaults.mutate({ projectId: project.projectId, defaults });
  };

  return <div className={styles.stack}>
    <SettingCard title={t("permissionModesLabel")} description={t("permissionAxesDescription")}>
      <div className={styles.modeList}>{workspace.supervisor.permissionModes.map((mode) => <div key={mode.mode} data-shape="control" className={mode.available ? styles.available : styles.unavailable}>
        {mode.lockedBy ? <LockKeyhole size={14} /> : <ShieldCheck size={14} />}<span><strong>{name(mode.mode)}</strong><small>{mode.available ? t("availableNewTask") : mode.lockedBy ? t("policyLocked", { source: mode.lockedBy }) : mode.reason || "Unavailable"}</small></span>
      </div>)}</div>
    </SettingCard>

    <SettingCard title={t("sandboxLabel")} description={t("sandboxDescription")}>
      {project ? <div className={styles.sandboxSettings}>
        <Switch checked={project.defaults.sandbox !== "off"} onChange={(event) => updateDefaults({ ...project.defaults, sandbox: event.target.checked ? "workspace" : "off" })} label={project.defaults.sandbox === "off" ? "Off" : "On"} />
        {project.defaults.sandbox !== "off" && <SegmentedControl value={project.defaults.sandbox} options={(['workspace', 'readOnly', 'strict'] as SandboxProfile[]).map((value) => ({ value, label: sandboxName(value) }))} onChange={(sandbox) => updateDefaults({ ...project.defaults, sandbox })} />}
        <small className={styles.note}>{t("sandboxSessionBoundary", { defaultValue: "Changing Sandbox inside a task creates a new Fork and keeps the source Session intact." })}</small>
      </div> : <Notice>{t("noProject")}</Notice>}
    </SettingCard>
  </div>;
}

function name(mode: string): string { return { ask: "Ask", auto: "Auto", alwaysApprove: "YOLO", acceptEdits: "Accept Edits", dontAsk: "Don’t Ask" }[mode] || mode; }
function sandboxName(value: SandboxProfile): string { return { off: "Off", workspace: "Workspace", readOnly: "Read Only", strict: "Strict", custom: "Custom" }[value]; }
