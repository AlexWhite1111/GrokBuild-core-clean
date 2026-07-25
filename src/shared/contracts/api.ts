import { z } from "zod";
import type { ThemeManifestV1 } from "./theme.js";

export const MutationRequestSchema = z.object({
  requestId: z.string().uuid(),
});

export const ProjectIdSchema = z.string().regex(/^project_[a-f0-9]{24}$/i);

export type ProblemCode =
  | "AUTH_REQUIRED"
  | "ORIGIN_REJECTED"
  | "VALIDATION_FAILED"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "CAPABILITY_UNAVAILABLE"
  | "GROK_HOME_MISMATCH"
  | "POLICY_LOCKED"
  | "TASK_BUSY"
  | "PATH_REJECTED"
  | "PROTOCOL_ERROR"
  | "REWIND_POINT_STALE"
  | "REWIND_REJECTED"
  | "REWIND_APPLIED_PROMPT_FAILED"
  | "FORK_CREATED_ACTIVATION_FAILED"
  | "INTERNAL_ERROR";

export interface ApiProblem {
  type: `grok-build:${Lowercase<ProblemCode>}`;
  title: string;
  status: number;
  code: ProblemCode;
  detail: string;
  requestId?: string;
}

export interface RendererBootstrap {
  apiBaseUrl: string;
  websocketUrl: string;
  launchToken: string;
  websocketProtocol: string;
  platform: NodeJS.Platform;
  appVersion: string;
  packaged: boolean;
  workspace: string;
  windowId?: string;
  initialRoute?: string;
  startupTheme?: ThemeManifestV1;
}

export interface LanShareStatus {
  enabled: boolean;
  preferredPort: number;
  port: number | null;
  portAdjusted: boolean;
  address: string | null;
  displayUrl: string | null;
  /** Direct trusted-LAN link used for QR/copy. */
  accessUrl: string | null;
  qrCodeDataUrl: string | null;
}
