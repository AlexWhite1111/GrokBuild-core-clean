import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  CapabilitySnapshot,
  AccountStatusSnapshot,
  TaskDetailProjection,
  ThemeLibrarySnapshot,
  ThemeManifestV1,
  WorkspaceProjection,
  UiPreferences,
} from "../../shared/contracts.js";
import type { TaskNotificationIntent } from "../../shared/taskNotifications.js";
import { ApiClient, desktopBootstrap } from "./ApiClient.js";
import { PortableRichTextProvider } from "./PortableRichTextContext.js";
import { shouldApplyTaskProjection } from "./taskProjectionVersion.js";
import { GrokMark } from "../components/GrokMark.js";

export interface AppBootstrapPayload {
  appVersion: string;
  startedAt: string;
  capabilities: CapabilitySnapshot;
  workspace: WorkspaceProjection;
  themeLibrary: ThemeLibrarySnapshot;
  activeTheme: ThemeManifestV1;
  uiPreferences: UiPreferences;
  accountStatus: AccountStatusSnapshot;
}

interface BootstrapContextValue {
  api: ApiClient;
  payload: AppBootstrapPayload;
}

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

export function BootstrapProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const desktop = useQuery({ queryKey: ["desktop-bootstrap"], queryFn: desktopBootstrap, staleTime: Infinity });
  const api = useMemo(() => desktop.data ? new ApiClient(desktop.data) : null, [desktop.data]);
  const bootstrap = useQuery({
    queryKey: ["app-bootstrap", desktop.data?.apiBaseUrl],
    queryFn: () => api!.get<AppBootstrapPayload>("/bootstrap"),
    enabled: Boolean(api),
    staleTime: 15_000,
  });

  if (desktop.isError || bootstrap.isError) {
    return <StartupState failed label={t("startupFailed")} theme={desktop.data?.startupTheme} />;
  }
  if (!api || !bootstrap.data) return <StartupState theme={desktop.data?.startupTheme} />;
  const startupTheme = desktop.data?.startupTheme;
  const payload = startupTheme ? { ...bootstrap.data, activeTheme: startupTheme } : bootstrap.data;
  return <ConnectedBootstrap api={api} payload={payload}>{children}</ConnectedBootstrap>;
}

function ConnectedBootstrap({ api, payload, children }: PropsWithChildren<BootstrapContextValue>) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.setQueryData(["workspace"], payload.workspace);
    queryClient.setQueryData(["capabilities"], payload.capabilities);
    queryClient.setQueryData(["ui-preferences"], payload.uiPreferences);
    queryClient.setQueryData(["theme-library"], payload.themeLibrary);
    queryClient.setQueryData(["theme", payload.activeTheme.id], payload.activeTheme);
    queryClient.setQueryData(["management", "account-status"], payload.accountStatus);
  }, [payload, queryClient]);
  useEffect(() => {
    let workspaceRefresh: ReturnType<typeof globalThis.setTimeout> | undefined;
    const scheduleWorkspaceRefresh = () => {
      if (workspaceRefresh !== undefined) return;
      workspaceRefresh = globalThis.setTimeout(() => {
        workspaceRefresh = undefined;
        void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      }, 250);
    };
    const syncRuntime = () => {
      void api.get<Pick<AppBootstrapPayload, "appVersion" | "startedAt">>("/bootstrap").then((current) => {
        if (current.appVersion !== payload.appVersion || current.startedAt !== payload.startedAt) window.location.reload();
      }).catch(() => undefined);
    };
    const close = api.openEvents((message) => {
    const value = asRecord(message);
    if (value.type === "workspace.snapshot") {
      const workspace = value.workspace as WorkspaceProjection;
      queryClient.setQueryData(["workspace"], workspace);
      void window.grokDesktop?.setAttentionCount(workspace.tasks.filter((task) => task.needsAttention).length);
    }
    if (value.type === "task.snapshot") applyDetail(value.detail as TaskDetailProjection);
    if (value.type === "task.notification" && typeof value.taskId === "string") {
      const notification = asRecord(value.notification);
      if (
        typeof notification.notificationId === "string"
        && isTaskNotificationKind(notification.kind)
      ) {
        const body = notification.kind === "waiting"
          ? t("taskAwaitingReplyNotice")
          : notification.kind === "interrupted"
            ? t("taskInterruptedNotice")
            : t("taskCompletedNotice");
        const detail = queryClient.getQueryData<TaskDetailProjection>(["task", value.taskId]);
        const workspace = queryClient.getQueryData<WorkspaceProjection>(["workspace"]);
        void window.grokDesktop?.notifyTask({
          notificationId: notification.notificationId,
          taskId: value.taskId,
          title: detail?.snapshot.title
            || workspace?.tasks.find((task) => task.taskId === value.taskId)?.title
            || "Grok",
          body,
        });
      }
    }
    function applyDetail(detail: TaskDetailProjection) {
      queryClient.setQueryData<TaskDetailProjection>(["task", detail.snapshot.taskId], (current) =>
        shouldApplyTaskProjection(current?.snapshot, detail.snapshot) ? detail : current);
      scheduleWorkspaceRefresh();
    }
    if (value.type === "task.retired") {
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["task", value.taskId] });
    }
    }, syncRuntime);
    return () => {
      close();
      if (workspaceRefresh !== undefined) globalThis.clearTimeout(workspaceRefresh);
    };
  }, [api, payload.appVersion, payload.startedAt, queryClient, t]);
  useEffect(() => window.grokDesktop?.onProjectChanged(() => {
    void queryClient.invalidateQueries({ queryKey: ["workspace"] });
  }), [queryClient]);
  const context = useMemo(() => ({ api, payload }), [api, payload]);
  return <BootstrapContext.Provider value={context}><PortableRichTextProvider api={api} enabled>{children}</PortableRichTextProvider></BootstrapContext.Provider>;
}

function StartupState({ failed = false, label, theme }: { failed?: boolean; label?: string; theme?: ThemeManifestV1 }) {
  const fallback = startupThemeFromLocation();
  const canvas = theme?.colors.canvas || fallback.canvas;
  const text = theme?.colors.text || fallback.text;
  const appearance = theme?.appearance || fallback.appearance;
  return <main className="startup-state" style={{ color: text, background: canvas, colorScheme: appearance }}>
    <GrokMark className="startup-mark" />
    {failed && <span className="startup-error">{label}</span>}
  </main>;
}

function startupThemeFromLocation(): { appearance: "light" | "dark"; canvas: string; text: string } {
  const query = new URLSearchParams(window.location.search);
  const appearance = query.get("startupAppearance") === "light" ? "light" : "dark";
  const color = (name: string, fallback: string) => {
    const value = query.get(name);
    return value && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ? value : fallback;
  };
  return {
    appearance,
    canvas: color("startupCanvas", appearance === "light" ? "#f5f2eb" : "#171716"),
    text: color("startupText", appearance === "light" ? "#25231f" : "#f2efe8"),
  };
}

export function useBootstrap(): BootstrapContextValue {
  const value = useContext(BootstrapContext);
  if (!value) throw new Error("BootstrapProvider is missing.");
  return value;
}

export function useOptionalBootstrap(): BootstrapContextValue | null {
  return useContext(BootstrapContext);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isTaskNotificationKind(value: unknown): value is TaskNotificationIntent["kind"] {
  return value === "completed" || value === "interrupted" || value === "waiting";
}
