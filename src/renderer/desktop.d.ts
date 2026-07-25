import type { GrokHomeProfileStatus, GrokHomeProfileSwitchResult, LanShareStatus, PathReferenceSummary, RendererBootstrap, TerminalRunRequest } from "../shared/contracts.js";

export {};

declare global {
  interface Window {
    grokDesktop?: {
      getBootstrap(): Promise<RendererBootstrap>;
      getGrokHomeProfiles(): Promise<GrokHomeProfileStatus>;
      selectGrokHome(profileId: string): Promise<GrokHomeProfileSwitchResult>;
      chooseCustomGrokHome(): Promise<GrokHomeProfileSwitchResult>;
      getLanShareStatus(): Promise<LanShareStatus>;
      setLanShare(input: { enabled: boolean; preferredPort?: number }): Promise<LanShareStatus>;
      chooseProject(): Promise<{ changed: boolean }>;
      rememberProject(projectId: string): Promise<void>;
      setWindowRoute(route: string): Promise<void>;
      registerWorkspaceFolders(files: File[]): Promise<{ changed: true; count: number }>;
      setAttentionCount(count: number): Promise<void>;
      notifyTask(input: { notificationId: string; taskId: string; title: string; body: string }): Promise<boolean>;
      openTerminal(): Promise<void>;
      startTerminal(input: { sessionId: string; projectId?: string; columns: number; rows: number; run?: TerminalRunRequest }): Promise<{ sessionId: string }>;
      writeTerminal(input: { sessionId: string; data: string }): Promise<void>;
      resizeTerminal(input: { sessionId: string; columns: number; rows: number }): Promise<void>;
      stopTerminal(sessionId: string): Promise<void>;
      openThemesDirectory(): Promise<string>;
      choosePaths(mode: "files" | "folder", projectId?: string): Promise<PathReferenceSummary[]>;
      registerDroppedFiles(files: File[], projectId?: string): Promise<PathReferenceSummary[]>;
      createTextClip(input: { text: string; ownerKey: string; projectId?: string }): Promise<PathReferenceSummary>;
      transferTextClips(input: { fromOwnerKey: string; toOwnerKey: string }): Promise<{ count: number }>;
      releaseTextClips(ownerKey: string): Promise<{ count: number }>;
      restorePaths(paths: PathReferenceSummary[], projectId?: string): Promise<PathReferenceSummary[]>;
      revealPath(refId: string): Promise<void>;
      revealMedia(taskId: string, mediaId: string): Promise<void>;
      runArtifactAction(input: { runId: string; artifactId: string; action: "open" | "reveal" }): Promise<void>;
      onNewTask(callback: () => void): () => void;
      onToggleSidebar(callback: () => void): () => void;
      onCommandPalette(callback: () => void): () => void;
      onSettings(callback: () => void): () => void;
      onProjectChanged(callback: () => void): () => void;
      onOpenTask(callback: (taskId: string) => void): () => void;
      onLanShareChanged(callback: (status: LanShareStatus) => void): () => void;
      onTerminalData(callback: (event: { sessionId: string; data: string }) => void): () => void;
      onTerminalExit(callback: (event: { sessionId: string; code: number | null; signal: string | null; error: string | null }) => void): () => void;
    };
  }
}
