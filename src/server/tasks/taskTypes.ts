import type {
  TaskDetailProjection,
  SandboxProfile,
  ReasoningEffort,
  TaskPermissionMode,
  WorkMode,
  TaskSystemPrompt,
} from "../../shared/contracts.js";
import type { AcpClientOptions, OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { TaskNotificationIntent } from "../../shared/taskNotifications.js";
import type { TaskStore } from "./TaskStore.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

export interface RuntimePermissionCapabilities {
  auto: { available: boolean; reason?: string };
  alwaysApprove: { available: boolean; reason?: string; lockedBy?: string };
  acceptEdits: { available: boolean; reason?: string };
  dontAsk: { available: boolean; reason?: string };
}

export interface TaskActorOptions {
  taskId: string;
  projectId: string;
  projectPath: string;
  grokBin: string;
  grokHome: string;
  grokHomeId: string;
  state: JsonStateStore;
  taskStore: TaskStore;
  processes?: OwnedProcessRegistry;
  publishNotification(taskId: string, notification: TaskNotificationIntent): void;
  media?: MediaArtifactStore;
  workMode: WorkMode;
  permission: TaskPermissionMode;
  sandbox: SandboxProfile;
  systemPrompt?: TaskSystemPrompt | null;
  continuationContext?: string;
  modelId?: string | null;
  effort?: ReasoningEffort | null;
  permissionCapabilities: RuntimePermissionCapabilities;
  existing?: TaskDetailProjection;
  clientFactory?: (options: AcpClientOptions) => OfficialAcpClient;
}
