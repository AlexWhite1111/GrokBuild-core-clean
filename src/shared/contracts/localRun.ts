import { z } from "zod";
import { MutationRequestSchema } from "./api.js";
import type { SpiceRunResult } from "./spice.js";

export type LocalRunLanguage = "python" | "spice";

export const LocalRunStartSchema = MutationRequestSchema.extend({
  language: z.enum(["python", "spice"]),
  code: z.string().min(1).max(500_000).refine((value) => !value.includes("\0"), "Code contains an invalid character."),
  workingDirectory: z.enum(["isolated", "project"]).default("isolated"),
});

export const LocalRunCancelSchema = MutationRequestSchema.extend({
  runId: z.string().uuid(),
});

type LocalRunStatus = "running" | "completed" | "failed" | "cancelled" | "timedOut";
export type LocalRunArtifactKind = "image" | "audio" | "video" | "model3d" | "svg" | "html" | "pdf" | "json" | "csv" | "text" | "file";

export interface LocalRunArtifact {
  artifactId: string;
  name: string;
  kind: LocalRunArtifactKind;
  mimeType: string;
  size: number;
}

interface LocalRunInteractivePreview {
  kind: "matplotlib";
  status: "starting" | "ready";
  path: string;
  figureIds: number[];
  animatedFigureIds: number[];
  animated: boolean;
}

export interface LocalRunSnapshot {
  runId: string;
  language: LocalRunLanguage;
  workingDirectory: "isolated" | "project";
  status: LocalRunStatus;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  artifacts: LocalRunArtifact[];
  interactive: LocalRunInteractivePreview | null;
  spice: SpiceRunResult | null;
}
