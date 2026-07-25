import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { PromptEchoIdentity } from "./PromptEchoQueue.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";

/** Stable collaboration surface shared by task runtimes and ACP event wiring. */
export interface TaskRuntimeContext {
  client: OfficialAcpClient;
  projection: TaskProjection;
  projectPath: string;
  media?: MediaArtifactStore;
  activeTurnId(): string | null;
  latestTurnId(): string | null;
  isStopped(): boolean;
  claimUserEcho(requestId?: string): PromptEchoIdentity | undefined;
  promptReceiptsFromQueue(value: unknown): string[];
  completionReceipt(value: unknown): {
    requestIds: string[];
    turnId: string | null;
  };
  acceptPending(requestIds?: string[]): void;
  settleTurn(turnId: string | null, outcome: "completed" | "failed", value: unknown): void;
  refreshContextWindow(): boolean;
  touch(): void;
  change(): void;
  disconnect(error: Error): void;
}
