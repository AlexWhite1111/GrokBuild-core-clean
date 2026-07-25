import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  GateDecision,
  PendingGate,
  TaskMediaAttachment,
  TaskSnapshot,
} from "../../shared/contracts.js";
import type { OfficialAcpClient, ReverseRequestEvent } from "../acp/OfficialAcpClient.js";
import {
  PermissionRequestSchema,
  permissionCancelled,
  permissionSelected,
  planAbandoned,
  planApproved,
  planCancelled,
  questionAccepted,
  questionSkipped,
} from "../acp/reverseContracts.js";
import { AppProblem } from "../security/problemResponse.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import { planContentHash } from "./PlanReviewState.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";

interface GateMediaContext { store: MediaArtifactStore; taskId: string }
interface GateProjectionContext { sessionScope?: "parent" | "child" }

export function toGate(
  event: ReverseRequestEvent,
  cwd: string,
  turnId: string | null,
  media?: GateMediaContext,
  context?: GateProjectionContext,
): PendingGate {
  const params = asRecord(event.params);
  const effectiveTurnId = turnId || randomUUID();
  if (event.method === "session/request_permission") {
    return permissionGate(event, params, cwd, effectiveTurnId, context?.sessionScope || "parent");
  }
  if (event.method === "x.ai/exit_plan_mode") {
    const content = string(params.planContent) || "";
    return baseGate(event, effectiveTurnId, {
      kind: "planReview",
      title: "Review plan",
      risk: "medium",
      payload: {
        content: content.slice(0, 500_000),
        baseHash: planContentHash(content),
        fileName: path.basename(string(params.planFilePath) || "plan.md"),
        truncated: content.length > 500_000,
        sessionScope: context?.sessionScope || "parent",
      },
    });
  }
  const questions = sanitizeQuestions(params.questions, cwd, media);
  return baseGate(event, effectiveTurnId, {
    kind: "question",
    title: string(asRecord(questions[0]).header) || "Question",
    risk: "low",
    payload: { questions, sessionScope: context?.sessionScope || "parent" },
  });
}

function gateResponse(gate: PendingGate, decision: GateDecision): unknown {
  if (gate.kind === "permission") {
    if (decision.action !== "submit") return permissionCancelled();
    const optionId = string(asRecord(decision.value).optionId);
    const options = Array.isArray(asRecord(gate.payload).options)
      ? asRecord(gate.payload).options as unknown[]
      : [];
    const advertised = options.some((entry) => string(asRecord(entry).optionId) === optionId);
    if (!optionId || !advertised) {
      throw new AppProblem(400, "VALIDATION_FAILED", "Permission decision must select an advertised option.");
    }
    return permissionSelected(optionId);
  }
  if (gate.kind === "planReview") {
    if (decision.action !== "submit") {
      throw new AppProblem(400, "VALIDATION_FAILED", "Plan decision must submit an official outcome.");
    }
    const chosen = string(asRecord(decision.value).decision);
    if (chosen === "approved") return planApproved();
    if (chosen === "abandoned") return planAbandoned();
    if (chosen !== "cancelled") {
      throw new AppProblem(400, "VALIDATION_FAILED", "Plan decision must be approved, cancelled, or abandoned.");
    }
    const feedback = string(asRecord(decision.value).feedback)?.slice(0, 100_000);
    return planCancelled(feedback);
  }
  if (decision.action === "submit") {
    const value = asRecord(decision.value);
    const answers = questionAnswers(value.answers);
    const annotations = answerAnnotations(value.annotations);
    if (!Object.keys(answers).length && !Object.keys(annotations).length) throw new AppProblem(400, "VALIDATION_FAILED", "Question gate submit requires an answer or note.");
    return questionAccepted(answers, annotations);
  }
  return questionSkipped();
}

export function decideTaskGate(
  client: OfficialAcpClient,
  projection: TaskProjection,
  decision: GateDecision,
  notifyIdle: () => void,
): TaskSnapshot {
  const gate = projection.snapshot.gates.find((entry) => entry.gateId === decision.gateId);
  if (!gate) throw new Error("Gate is no longer pending.");
  client.resolveGate(gate.gateId, gateResponse(gate, decision));
  let planDecision: "approved" | "cancelled" | "abandoned" | null = null;
  if (gate.kind === "planReview") {
    const requested = string(asRecord(decision.value).decision);
    planDecision = requested === "approved" || requested === "cancelled" || requested === "abandoned"
      ? requested
      : null;
  }
  projection.removeGate(gate.gateId);
  notifyIdle();
  if (planDecision) {
    projection.record("supervisor", `task/plan:${planDecision}`, gate.turnId, {
      title: projection.snapshot.plan.document?.fileName || "Plan review",
    });
  }
  return projection.detail().snapshot;
}

export function renumberGates(gates: PendingGate[]): void {
  gates.forEach((gate, index) => {
    gate.position = index + 1;
    gate.total = gates.length;
  });
}

export function titleFromPrompt(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim();
  return firstLine.length > 56 ? `${firstLine.slice(0, 55)}…` : firstLine;
}

export function promptPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 119)}…` : normalized;
}

function baseGate(
  event: ReverseRequestEvent,
  turnId: string,
  fields: Pick<PendingGate, "kind" | "title" | "risk" | "payload">,
): PendingGate {
  return {
    gateId: event.gateId,
    ...fields,
    receivedAt: new Date().toISOString(),
    turnId,
    position: 1,
    total: 1,
  };
}

function permissionGate(
  event: ReverseRequestEvent,
  params: Record<string, unknown>,
  cwd: string,
  turnId: string,
  sessionScope: "parent" | "child",
): PendingGate {
  const parsed = PermissionRequestSchema.safeParse(params);
  const tool = parsed.success ? parsed.data.toolCall : asRecord(params.toolCall);
  const title = string(tool.title) || "Tool permission";
  const options = parsed.success
    ? parsed.data.options.map((option) => ({
      optionId: option.optionId,
      name: option.name.slice(0, 20_000),
      kind: option.kind,
    }))
    : [];
  const locations = Array.isArray(tool.locations)
    ? tool.locations.flatMap((value) => {
      const absolute = string(asRecord(value).path);
      return absolute ? [displayPath(absolute, cwd)] : [];
    }).slice(0, 100)
    : [];
  return baseGate(event, turnId, {
    kind: "permission",
    title: title.slice(0, 20_000),
    risk: permissionRisk(title, string(tool.kind)),
    payload: {
      sessionScope,
      tool: {
        id: string(tool.toolCallId),
        title: title.slice(0, 20_000),
        kind: string(tool.kind),
        status: string(tool.status),
        locations,
      },
      options,
    },
  });
}

function sanitizeQuestions(value: unknown, cwd: string, media?: GateMediaContext): unknown[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const question = asRecord(entry);
    const prompt = string(question.question);
    if (!prompt) return [];
    return [{
      question: prompt,
      questionMedia: discoverMedia(prompt, cwd, media),
      header: string(question.header),
      multiSelect: question.multiSelect === true,
      options: Array.isArray(question.options) ? question.options.flatMap((item) => {
        const option = asRecord(item);
        const label = string(option.label);
        const description = string(option.description) || "";
        const preview = string(option.preview) || "";
        return label ? [{
          label: label.slice(0, 20_000),
          description: description.slice(0, 40_000),
          preview: preview.slice(0, 100_000),
          labelMedia: discoverMedia(label.slice(0, 20_000), cwd, media),
          descriptionMedia: discoverMedia(description.slice(0, 40_000), cwd, media),
          previewMedia: discoverMedia(preview.slice(0, 100_000), cwd, media),
        }] : [];
      }) : [],
    }];
  }) : [];
}

function discoverMedia(value: string, cwd: string, media?: GateMediaContext): TaskMediaAttachment[] {
  return media && value ? media.store.discoverInText(media.taskId, cwd, value) : [];
}

function questionAnswers(value: unknown): Record<string, string[]> {
  return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([question, raw]) => {
    if (!question.trim() || !Array.isArray(raw)) return [];
    const answers = raw.flatMap((answer) => typeof answer === "string" && answer.trim() ? [answer.trim().slice(0, 20_000)] : []).slice(0, 100);
    return answers.length ? [[question.slice(0, 20_000), answers]] : [];
  }));
}

function answerAnnotations(value: unknown): Record<string, { notes: string }> {
  return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([question, raw]) => {
    const notes = string(asRecord(raw).notes)?.trim().slice(0, 100_000);
    return question.trim() && notes ? [[question.slice(0, 20_000), { notes }]] : [];
  }));
}

function permissionRisk(title: string, kind?: string): PendingGate["risk"] {
  const value = `${title} ${kind || ""}`.toLowerCase();
  if (/(delete|discard|remove|sudo|credential|secret|network|execute|bash|terminal)/.test(value)) return "high";
  if (/(write|edit|move|rename|install|commit|stage)/.test(value)) return "medium";
  return "low";
}

function displayPath(value: string, cwd: string): string {
  const resolved = path.resolve(value);
  const relative = path.relative(cwd, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : path.basename(resolved);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}
