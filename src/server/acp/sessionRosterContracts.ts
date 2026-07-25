import { z } from "zod";

export const YoloModeChangedParamsSchema = z.object({
  sessionId: z.string().min(1).max(1_024),
  yolo_mode: z.boolean(),
}).strict();

const SessionRosterEntrySchema = z.object({
  sessionId: z.string().min(1).max(1_024),
  yolo: z.boolean(),
  autoMode: z.boolean().optional(),
  modelId: z.string().trim().regex(/^[A-Za-z0-9._:/-]{1,256}$/).nullable().optional(),
  reasoningEffort: z.string().trim().regex(/^[A-Za-z0-9._:/-]{1,64}$/).nullable().optional(),
  activity: z.string().max(160).optional(),
  resident: z.boolean().optional(),
}).passthrough();

const SessionsListResponseSchema = z.object({
  result: z.object({
    sessions: z.array(SessionRosterEntrySchema).max(10_000),
  }).passthrough(),
}).passthrough();

export interface SessionRosterState {
  sessionId: string;
  yolo?: boolean;
  autoMode?: boolean | null;
  modelId?: string | null;
  reasoningEffort?: string | null;
}

export function sessionRosterState(
  value: unknown,
  sessionId: string,
): SessionRosterState {
  const response = SessionsListResponseSchema.parse(value);
  const session = response.result.sessions.find(
    (entry) => entry.sessionId === sessionId,
  );
  if (!session) {
    throw new Error(`Grok session roster did not contain ${sessionId}.`);
  }
  return {
    sessionId,
    yolo: session.yolo,
    autoMode: session.autoMode ?? null,
    ...(Object.hasOwn(session, "modelId") ? { modelId: session.modelId ?? null } : {}),
    ...(Object.hasOwn(session, "reasoningEffort") ? { reasoningEffort: session.reasoningEffort ?? null } : {}),
  };
}
