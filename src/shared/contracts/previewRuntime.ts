import { z } from "zod";

export const PreviewPrepareRequestSchema = z.object({
  language: z.string().trim().min(1).max(64).default("html"),
  source: z.string().max(8_000_000),
  embedded: z.boolean().default(false),
  taskId: z.string().uuid().optional(),
});

export type PreviewPrepareRequest = z.infer<typeof PreviewPrepareRequestSchema>;

export interface PreviewGraphSummary {
  moduleCount: number;
  localModuleCount: number;
  packages: string[];
}

export interface PreviewPrepareResponse {
  hash: string;
  path: string;
  cacheHit: boolean;
  buildMs: number;
  sizeBytes: number;
  graph: PreviewGraphSummary;
}
