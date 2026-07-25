import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { ProjectStore } from "../projects/ProjectStore.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";
import type { TaskActor } from "./TaskActor.js";
import type { RuntimePermissionCapabilities, TaskActorOptions } from "./taskTypes.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

export interface TaskSupervisorOptions {
  state: JsonStateStore;
  projects: ProjectStore;
  grokBin: string;
  grokHome: string;
  grokHomeId: string;
  permissionCapabilities: RuntimePermissionCapabilities;
  maxAgents?: number;
  idleRetirementMs?: number;
  actorFactory?: (options: TaskActorOptions) => TaskActor;
  ensureTaskCreationAllowed?: () => Promise<void>;
  media?: MediaArtifactStore;
  processes?: OwnedProcessRegistry;
}
