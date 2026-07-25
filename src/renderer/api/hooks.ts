import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GateDecision,
  CapabilitySnapshot,
  AccountModelSnapshot,
  AccountStatusSnapshot,
  ComposerInputDocument,
  PathReferenceSummary,
  ProjectDefaults,
  TaskCreate,
  TaskFork,
  TaskDetailProjection,
  TaskGoalMutation,
  TaskSnapshot,
  TaskSubmissionMode,
  TaskWorkStop,
  ThemeLibrarySnapshot,
  ThemeManifestV1,
  WorkspaceProjection,
  UiPreferences,
  SourceControlDiff,
  SourceControlMutationInput,
  SourceControlMutationResult,
  SourceControlSnapshot,
} from "../../shared/contracts.js";
import { QueueMutationSchema } from "../../shared/contracts.js";
import type { z } from "zod";
import { useBootstrap } from "./BootstrapContext.js";

export function useWorkspace() {
  const { api, payload } = useBootstrap();
  return useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceProjection>("/workspace"), initialData: payload.workspace });
}

export function useCapabilities() {
  const { api, payload } = useBootstrap();
  return useQuery({ queryKey: ["capabilities"], queryFn: () => api.get<CapabilitySnapshot>("/capabilities"), initialData: payload.capabilities });
}

export function useUiPreferences() {
  const { api, payload } = useBootstrap();
  return useQuery({ queryKey: ["ui-preferences"], queryFn: () => api.get<UiPreferences>("/ui/preferences"), initialData: payload.uiPreferences });
}

export function useUiPreferenceIntent() {
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preferences: UiPreferences) => api.post<UiPreferences>("/ui/preferences", { requestId: crypto.randomUUID(), preferences }),
    onMutate: async (preferences) => {
      await queryClient.cancelQueries({ queryKey: ["ui-preferences"] });
      const previous = queryClient.getQueryData<UiPreferences>(["ui-preferences"]);
      queryClient.setQueryData(["ui-preferences"], preferences);
      return { previous };
    },
    onError: (_error, preferences, context) => {
      const current = queryClient.getQueryData<UiPreferences>(["ui-preferences"]);
      if (context?.previous && sameUiPreferences(current, preferences)) queryClient.setQueryData(["ui-preferences"], context.previous);
    },
    onSuccess: (value, preferences) => {
      const current = queryClient.getQueryData<UiPreferences>(["ui-preferences"]);
      if (sameUiPreferences(current, preferences)) queryClient.setQueryData(["ui-preferences"], value);
    },
  });
}

function sameUiPreferences(left: UiPreferences | undefined, right: UiPreferences): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

export function useTask(taskId: string) {
  const { api } = useBootstrap();
  return useQuery<TaskDetailProjection>({
    queryKey: ["task", taskId],
    queryFn: () => api.get<TaskDetailProjection>(`/tasks/${taskId}`),
    enabled: Boolean(taskId),
    gcTime: 0,
  });
}

export function useTaskIntents(taskId?: string) {
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  const update = (snapshot: TaskSnapshot) => {
    void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    return snapshot;
  };
  const updateAfterHistoryRewrite = (snapshot: TaskSnapshot) => {
    update(snapshot);
    void queryClient.invalidateQueries({ queryKey: ["task", snapshot.taskId] });
    return snapshot;
  };
  const updateAfterActivation = (snapshot: TaskSnapshot) => {
    update(snapshot);
    void queryClient.invalidateQueries({ queryKey: ["task", snapshot.taskId] });
    return snapshot;
  };
  return {
    create: useMutation({ mutationFn: (input: TaskCreate) => api.post<TaskSnapshot>("/tasks", input), onSuccess: update }),
    resume: useMutation({ mutationFn: (requestId: string) => api.post<TaskSnapshot>(`/tasks/${taskId}/resume`, { requestId }), onSuccess: updateAfterActivation }),
    prompt: useMutation({ mutationFn: (input: { requestId: string; prompt: string; paths: Array<Pick<PathReferenceSummary, "refId">>; document?: ComposerInputDocument; submissionMode?: TaskSubmissionMode }) => api.post<TaskSnapshot>(`/tasks/${taskId}/prompt`, input), onSuccess: update }),
    rewindAndPrompt: useMutation({ mutationFn: (input: { requestId: string; targetPromptIndex: number; sourceBlockId: string; prompt: string; paths: Array<Pick<PathReferenceSummary, "refId">>; document?: ComposerInputDocument; submissionMode?: "prompt" }) => api.post<TaskSnapshot>(`/tasks/${taskId}/rewind-and-prompt`, input), onSuccess: updateAfterHistoryRewrite }),
    fork: useMutation({ mutationFn: (input: TaskFork) => api.post<TaskSnapshot>(`/tasks/${taskId}/fork`, input), onSuccess: update }),
    enqueue: useMutation({ mutationFn: (input: { requestId: string; prompt: string; paths: Array<Pick<PathReferenceSummary, "refId">>; document?: ComposerInputDocument }) => api.post<TaskSnapshot>(`/tasks/${taskId}/queue/submit`, input), onSuccess: update }),
    interject: useMutation({ mutationFn: (input: { requestId: string; text: string }) => api.post<TaskSnapshot>(`/tasks/${taskId}/interject`, input), onSuccess: update }),
    queue: useMutation({ mutationFn: (input: z.infer<typeof QueueMutationSchema>) => api.post<TaskSnapshot>(`/tasks/${taskId}/queue`, input), onSuccess: update }),
    cancel: useMutation({ mutationFn: (requestId: string) => api.post<TaskSnapshot>(`/tasks/${taskId}/cancel`, { requestId }), onSuccess: update }),
    config: useMutation({ mutationFn: (input: { requestId: string; configId: string; value: string | boolean }) => api.post<TaskSnapshot>(`/tasks/${taskId}/config-option`, input), onSuccess: update }),
    command: useMutation({ mutationFn: (input: { requestId: string; name: string; input?: string }) => api.post<TaskSnapshot>(`/tasks/${taskId}/commands`, input), onSuccess: update }),
    goal: useMutation({ mutationFn: (input: TaskGoalMutation) => api.post<TaskSnapshot>(`/tasks/${taskId}/goal`, input), onSuccess: update }),
    mode: useMutation({ mutationFn: (input: { requestId: string; mode: "normal" }) => api.post<TaskSnapshot>(`/tasks/${taskId}/mode`, input), onSuccess: updateAfterActivation }),
    workStop: useMutation({ mutationFn: (input: TaskWorkStop) => api.post<TaskSnapshot>(`/tasks/${taskId}/work/stop`, input), onSuccess: update }),
    gate: useMutation({ mutationFn: (input: GateDecision) => api.post<TaskSnapshot>(`/tasks/${taskId}/gates/decision`, input), onSuccess: update }),
  };
}

export function useProjectIntents() {
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  const update = (workspace: WorkspaceProjection) => {
    queryClient.setQueryData(["workspace"], workspace);
    return workspace;
  };
  const remember = (workspace: WorkspaceProjection) => {
    const active = workspace.projects.find((project) => project.active);
    const persistence = active ? window.grokDesktop?.rememberProject(active.projectId) : undefined;
    if (persistence) void persistence.catch(() => undefined);
    return update(workspace);
  };
  return {
    activate: useMutation({ mutationFn: (projectId: string) => api.post<WorkspaceProjection>("/projects/activate", { requestId: crypto.randomUUID(), projectId }), onSuccess: remember }),
    remove: useMutation({ mutationFn: (projectId: string) => api.post<WorkspaceProjection>("/projects/remove", { requestId: crypto.randomUUID(), projectId }), onSuccess: remember }),
    defaults: useMutation({ mutationFn: (input: { projectId: string; defaults: ProjectDefaults }) => api.post<WorkspaceProjection>("/projects/defaults", { requestId: crypto.randomUUID(), ...input }), onSuccess: update }),
  };
}

export function useSystemPromptPresetIntents() {
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  const update = (workspace: WorkspaceProjection) => {
    queryClient.setQueryData(["workspace"], workspace);
    return workspace;
  };
  return {
    save: useMutation({
      mutationFn: (preset: { presetId?: string; title: string; rules?: string; systemPrompt?: string; pinned?: boolean }) =>
        api.post<WorkspaceProjection>("/system-prompt-presets/save", { requestId: crypto.randomUUID(), preset }),
      onSuccess: update,
    }),
    delete: useMutation({
      mutationFn: (presetId: string) => api.post<WorkspaceProjection>("/system-prompt-presets/delete", { requestId: crypto.randomUUID(), presetId }),
      onSuccess: update,
    }),
  };
}

export function useSourceControl(projectId?: string, enabled = true) {
  const { api } = useBootstrap();
  return useQuery({
    queryKey: ["source-control", projectId],
    queryFn: () => api.get<SourceControlSnapshot>(`/projects/${projectId}/source-control`),
    enabled: Boolean(projectId && enabled),
    staleTime: 1_000,
  });
}

export function useSourceControlDiff(projectId: string | undefined, filePath: string | null, staged: boolean, enabled = true) {
  const { api } = useBootstrap();
  const query = new URLSearchParams({ path: filePath || "", staged: staged ? "1" : "0" });
  return useQuery({
    queryKey: ["source-control-diff", projectId, filePath, staged],
    queryFn: () => api.get<SourceControlDiff>(`/projects/${projectId}/source-control/diff?${query}`),
    enabled: Boolean(projectId && filePath && enabled),
  });
}

export function useSourceControlMutation(projectId?: string) {
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceControlMutationInput) => api.post<SourceControlMutationResult>(`/projects/${projectId}/source-control`, { requestId: crypto.randomUUID(), ...input }),
    onSuccess: (result) => {
      if (result.snapshot) queryClient.setQueryData(["source-control", projectId], result.snapshot);
      else void queryClient.invalidateQueries({ queryKey: ["source-control", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["source-control-diff", projectId] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["source-control", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["source-control-diff", projectId] });
    },
  });
}

export function useAccount() {
  const { api } = useBootstrap();
  return useQuery({
    queryKey: ["management", "account"],
    queryFn: () => api.get<AccountModelSnapshot>("/management/account"),
    staleTime: 5_000,
  });
}

export function useAccountStatus() {
  const { api, payload } = useBootstrap();
  return useQuery({
    queryKey: ["management", "account-status"],
    queryFn: () => api.get<AccountStatusSnapshot>("/management/account-status"),
    initialData: payload.accountStatus,
    staleTime: 5_000,
  });
}

export function useThemes() {
  const { api, payload } = useBootstrap();
  return useQuery({ queryKey: ["theme-library"], queryFn: () => api.get<ThemeLibrarySnapshot>("/themes"), initialData: payload.themeLibrary });
}

export function useThemeSelectIntent() {
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { themeId: string; followSystem: boolean }) => api.post<ThemeLibrarySnapshot>("/themes/select", { requestId: crypto.randomUUID(), ...input }),
    onSuccess: (library) => {
      queryClient.setQueryData(["theme-library"], library);
      for (const themeId of new Set([
        library.selectedThemeId,
        library.systemLightThemeId,
        library.systemDarkThemeId,
      ])) {
        void queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
      }
    },
  });
}

export function useTheme(themeId: string) {
  const { api, payload } = useBootstrap();
  return useQuery({
    queryKey: ["theme", themeId],
    queryFn: () => api.get<ThemeManifestV1>(`/themes/${themeId}`),
    initialData: payload.activeTheme.id === themeId ? payload.activeTheme : undefined,
    enabled: Boolean(themeId),
  });
}
