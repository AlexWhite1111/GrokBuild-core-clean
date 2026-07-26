import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  ProjectDefaults,
  ReasoningEffort,
  SandboxProfile,
  TaskPermissionMode,
} from "../../shared/contracts.js";
import { resolveNewTaskPermission } from "../../shared/newTaskDefaults.js";
import {
  useAccount,
  useCapabilities,
  useProjectIntents,
  useWorkspace,
} from "../api/hooks.js";
import {
  Field,
  Notice,
  SegmentedControl,
  SettingCard,
  ThemedSelect,
} from "../../ui/components/index.js";
import { permissionLabel, sandboxLabel } from "../sessionSettingLabels.js";
import styles from "./SettingsPanels.module.css";

export function TaskDefaultsSettings() {
  const { t } = useTranslation();
  const workspace = useWorkspace().data;
  const account = useAccount().data;
  const capabilities = useCapabilities().data;
  const project = workspace.projects.find((item) => item.active) || workspace.projects[0];
  const projects = useProjectIntents();
  const updateDefaults = (patch: Partial<ProjectDefaults>) => {
    if (project) projects.defaults.mutate({
      projectId: project.projectId,
      defaults: { ...project.defaults, ...patch },
    });
  };
  const permissionModes = workspace.supervisor.permissionModes;
  const defaultPermissionAvailable = project
    ? resolveNewTaskPermission(project.defaults.permission, permissionModes) === project.defaults.permission
    : false;
  const accountDefaultModel = account?.models.defaultModel
    || account?.models.available.find((model) => model.isDefault)?.id
    || null;
  const modelIds = unique([
    ...(account?.models.available.map((model) => model.id) || []),
    ...capabilities.acp.models.map((model) => model.id),
    ...(project?.defaults.modelId ? [project.defaults.modelId] : []),
  ]);
  const selectedModel = project?.defaults.modelId || accountDefaultModel;
  const effortValues = unique([
    ...(capabilities.acp.models.find((model) => model.id === selectedModel)?.reasoningEfforts || []),
    ...(project?.defaults.effort ? [project.defaults.effort] : []),
  ]) as ReasoningEffort[];

  return <div className={styles.stack}>
    <SettingCard title={t("newTaskDefaults")} description={t("newTaskDefaultsDescription")}>
      {project ? <div className={styles.newTaskDefaults}>
        {modelIds.length > 0 && <Field label={t("defaultModelForNewTasks")}>
          <ThemedSelect
            value={project.defaults.modelId || ""}
            ariaLabel={t("defaultModelForNewTasks")}
            disabled={projects.defaults.isPending}
            options={[
              {
                value: "",
                label: accountDefaultModel
                  ? t("followGrokDefaultModel", { model: accountDefaultModel })
                  : t("followGrokDefault"),
              },
              ...modelIds.map((modelId) => ({ value: modelId, label: modelId })),
            ]}
            onValueChange={(value) => {
              const modelId = value || null;
              const effectiveModel = modelId || accountDefaultModel;
              const supported = capabilities.acp.models
                .find((model) => model.id === effectiveModel)?.reasoningEfforts || [];
              updateDefaults({
                modelId,
                effort: project.defaults.effort && supported.includes(project.defaults.effort)
                  ? project.defaults.effort
                  : null,
              });
            }}
          />
        </Field>}

        {(effortValues.length > 0 || project.defaults.effort) && <Field label={t("defaultReasoningEffort")}>
          <ThemedSelect
            value={project.defaults.effort || ""}
            ariaLabel={t("defaultReasoningEffort")}
            disabled={projects.defaults.isPending}
            options={[
              { value: "", label: t("followModelDefault") },
              ...effortValues.map((effort) => ({
                value: effort,
                label: effort,
                disabled: !capabilities.acp.models
                  .find((model) => model.id === selectedModel)?.reasoningEfforts.includes(effort),
              })),
            ]}
            onValueChange={(value) => updateDefaults({
              effort: (value || null) as ReasoningEffort | null,
            })}
          />
        </Field>}

        <Field
          label={t("defaultPermission")}
          hint={defaultPermissionAvailable
            ? undefined
            : t("defaultPermissionUnavailable", {
              mode: permissionLabel(project.defaults.permission),
            })}
        >
          <ThemedSelect
            value={project.defaults.permission}
            ariaLabel={t("defaultPermission")}
            disabled={projects.defaults.isPending}
            options={permissionModes.map((mode) => ({
              value: mode.mode,
              label: permissionLabel(mode.mode),
              disabled: !mode.available,
            }))}
            onValueChange={(permission) => updateDefaults({
              permission: permission as TaskPermissionMode,
            })}
          />
        </Field>

        <Field label={t("defaultSandbox")}>
          <SegmentedControl
            value={project.defaults.sandbox}
            ariaLabel={t("defaultSandbox")}
            options={(["off", "workspace", "readOnly", "strict"] as SandboxProfile[])
              .map((sandbox) => ({
                value: sandbox,
                label: sandboxLabel(sandbox),
                disabled: projects.defaults.isPending,
              }))}
            onChange={(sandbox) => updateDefaults({ sandbox })}
          />
        </Field>

        <Field label={t("defaultSystemPrompt")}>
          <ThemedSelect
            value={project.defaults.systemPromptPresetId || ""}
            ariaLabel={t("defaultSystemPrompt")}
            disabled={projects.defaults.isPending}
            options={[
              { value: "", label: t("builtInSystemPrompt") },
              ...workspace.systemPromptPresets.map((preset) => ({
                value: preset.presetId,
                label: preset.title,
              })),
            ]}
            onValueChange={(systemPromptPresetId) => updateDefaults({
              systemPromptPresetId: systemPromptPresetId || null,
            })}
          />
        </Field>

        <small className={styles.note}>
          {t("newTaskDefaultsBoundary")}
        </small>
      </div> : <Notice>{t("noProject")}</Notice>}
    </SettingCard>

    <SettingCard title={t("permissionModesLabel")} description={t("permissionAxesDescription")}>
      <div className={styles.modeList}>{workspace.supervisor.permissionModes.map((mode) => <div key={mode.mode} data-shape="control" className={mode.available ? styles.available : styles.unavailable}>
        {mode.lockedBy ? <LockKeyhole size={14} /> : <ShieldCheck size={14} />}<span><strong>{permissionLabel(mode.mode)}</strong><small>{mode.available ? t("availableNewTask") : mode.lockedBy ? t("policyLocked", { source: mode.lockedBy }) : mode.reason || "Unavailable"}</small></span>
      </div>)}</div>
    </SettingCard>
  </div>;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
