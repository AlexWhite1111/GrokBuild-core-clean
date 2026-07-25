import { z } from "zod";
import { XAI_METHODS } from "./XaiMethodRegistry.js";

const ReverseRequestMethodSchema = z.enum([
  "session/request_permission",
  XAI_METHODS.askUserQuestion,
  XAI_METHODS.exitPlanMode,
]);
export type ReverseRequestMethod = z.infer<typeof ReverseRequestMethodSchema>;

const QuestionAnswersSchema = z.record(z.string(), z.array(z.string()));
const QuestionAnnotationsSchema = z.record(
  z.string(),
  z.object({ notes: z.string() }).passthrough(),
);
const PermissionOptionKindSchema = z.enum([
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
]);
const PermissionOptionSchema = z.object({
  optionId: z.string().min(1).max(1_024),
  name: z.string().max(20_000),
  kind: PermissionOptionKindSchema,
}).passthrough();

const PermissionToolCallSchema = z.object({
  toolCallId: z.string().min(1).max(1_024),
  title: z.string().max(20_000).nullable().optional(),
  kind: z.string().max(256).nullable().optional(),
  status: z.string().max(256).nullable().optional(),
  locations: z.array(z.object({ path: z.string().min(1).max(32_000) }).passthrough()).max(100).nullable().optional(),
}).passthrough();

export const PermissionRequestSchema = z.object({
  sessionId: z.string().min(1).max(1_024).optional(),
  toolCall: PermissionToolCallSchema,
  options: z.array(PermissionOptionSchema).max(32),
}).passthrough();

const PermissionResponseSchema = z.object({
  outcome: z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("selected"), optionId: z.string().min(1) }).strict(),
    z.object({ outcome: z.literal("cancelled") }).strict(),
  ]),
}).strict();

const AskUserQuestionResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("accepted"),
    answers: QuestionAnswersSchema,
    annotations: QuestionAnnotationsSchema.optional(),
  }).strict(),
  z.object({ outcome: z.literal("chat_about_this") }).passthrough(),
  z.object({ outcome: z.literal("skip_interview") }).strict(),
  z.object({ outcome: z.literal("cancelled") }).strict(),
]);

const ExitPlanModeResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("approved") }).strict(),
  z.object({ outcome: z.literal("abandoned") }).strict(),
  z.object({ outcome: z.literal("cancelled"), feedback: z.string().max(100_000).optional() }).strict(),
]);

const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  preview: z.string().optional(),
}).passthrough();

export const AskUserQuestionRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  questions: z.array(z.object({
    header: z.string().optional(),
    question: z.string().min(1),
    multiSelect: z.boolean().optional(),
    options: z.array(QuestionOptionSchema).optional(),
  }).passthrough()),
}).passthrough();

export const ExitPlanModeRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  planContent: z.string(),
  planFilePath: z.string().optional(),
}).passthrough();

export type PermissionResponse = z.infer<typeof PermissionResponseSchema>;
type PermissionOptionKind = z.infer<typeof PermissionOptionKindSchema>;
export type AskUserQuestionResponse = z.infer<typeof AskUserQuestionResponseSchema>;
export type ExitPlanModeResponse = z.infer<typeof ExitPlanModeResponseSchema>;
export type ReverseRequestResponse = PermissionResponse | AskUserQuestionResponse | ExitPlanModeResponse;

export function permissionOptionId(value: unknown, kind: PermissionOptionKind): string | null {
  const parsed = PermissionRequestSchema.pick({ options: true }).safeParse(value);
  return parsed.success
    ? parsed.data.options.find((option) => option.kind === kind)?.optionId || null
    : null;
}

export function permissionSelected(optionId: string): PermissionResponse {
  return PermissionResponseSchema.parse({ outcome: { outcome: "selected", optionId } });
}

export function permissionCancelled(): PermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

export function questionAccepted(
  answers: Record<string, string[]>,
  annotations?: Record<string, { notes: string }>,
): AskUserQuestionResponse {
  return AskUserQuestionResponseSchema.parse({
    outcome: "accepted",
    answers,
    ...(annotations && Object.keys(annotations).length ? { annotations } : {}),
  });
}

export function questionSkipped(): AskUserQuestionResponse {
  return { outcome: "skip_interview" };
}

function questionCancelled(): AskUserQuestionResponse {
  return { outcome: "cancelled" };
}

export function planApproved(): ExitPlanModeResponse {
  return { outcome: "approved" };
}

export function planAbandoned(): ExitPlanModeResponse {
  return { outcome: "abandoned" };
}

export function planCancelled(feedback?: string): ExitPlanModeResponse {
  return ExitPlanModeResponseSchema.parse({
    outcome: "cancelled",
    ...(feedback ? { feedback: feedback.slice(0, 100_000) } : {}),
  });
}

export function cancelledReverseRequest(method: ReverseRequestMethod): ReverseRequestResponse {
  if (method === "session/request_permission") return permissionCancelled();
  if (method === XAI_METHODS.exitPlanMode) return planAbandoned();
  return questionCancelled();
}

export function parseReverseRequestResponse(
  method: ReverseRequestMethod,
  value: unknown,
): ReverseRequestResponse {
  if (method === "session/request_permission") return PermissionResponseSchema.parse(value);
  if (method === XAI_METHODS.exitPlanMode) return ExitPlanModeResponseSchema.parse(value);
  return AskUserQuestionResponseSchema.parse(value);
}
