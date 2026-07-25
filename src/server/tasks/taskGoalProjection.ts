import type { TaskGoalState, TaskGoalTelemetry } from "../../shared/contracts.js";

interface NativeGoalState {
  status: TaskGoalState["status"];
  outcome?: TaskGoalState["lastOutcome"];
  clearObjective?: boolean;
}

/** Project Grok's authoritative goal_updated fields without erasing omitted telemetry. */
export function applyGoalSessionUpdate(goal: TaskGoalState, value: Record<string, unknown>, now = new Date()): boolean {
  const rawStatus = text(value.status)?.toLowerCase().replaceAll("-", "_") || null;
  const state = nativeState(rawStatus);
  const rawObjective = value.objective;
  const hasObjective = Object.hasOwn(value, "objective") && typeof rawObjective === "string";
  const objective = typeof rawObjective === "string" ? rawObjective.trim() : null;
  const elapsedMs = numeric(value.elapsedMs);
  const incomingGoalId = text(value.goalId);
  const previousGoalId = goal.telemetry?.goalId || null;
  const elapsedRestarted = elapsedMs != null && elapsedMs < goal.timeUsedSeconds * 1_000;
  const newGoal = Boolean(incomingGoalId && incomingGoalId !== previousGoalId && (
    previousGoalId
    || elapsedRestarted
    || ((goal.status === "inactive" || goal.status === "unknown") && (
      goal.lastOutcome !== null || goal.objective !== null || goal.timeUsedSeconds > 0
    ))
  ));
  const previousStatus = goal.status;
  if (newGoal) {
    goal.telemetry = null;
    goal.timeUsedSeconds = 0;
    goal.objective = null;
    goal.lastOutcome = null;
  }
  const telemetry = hasTelemetry(value) ? goalTelemetryFrom(value, goal.telemetry) : goal.telemetry;
  const applied = Boolean(state || hasObjective || elapsedMs != null || telemetry !== goal.telemetry);
  if (!applied) return false;

  if (telemetry !== goal.telemetry) goal.telemetry = telemetry;
  const clockChanged = elapsedMs != null || Boolean(state) || hasObjective || newGoal;
  if (elapsedMs != null) {
    goal.timeUsedSeconds = Math.max(0, elapsedMs / 1_000);
  } else if (clockChanged && previousStatus === "active" && goal.updatedAt) {
    const checkpoint = Date.parse(goal.updatedAt);
    if (Number.isFinite(checkpoint)) {
      goal.timeUsedSeconds += Math.max(0, now.getTime() - checkpoint) / 1_000;
    }
  }
  if (hasObjective) goal.objective = objective || null;
  if (state) {
    goal.status = state.status;
    goal.source = "native";
    if (state.outcome !== undefined) goal.lastOutcome = state.outcome;
    else if (state.status !== "inactive") goal.lastOutcome = null;
    if (state.clearObjective || (rawStatus === "inactive" && !state.outcome)) goal.objective = null;
  }
  if (clockChanged) goal.updatedAt = now.toISOString();
  return true;
}

function goalTelemetryFrom(value: Record<string, unknown>, previous: TaskGoalTelemetry | null = null): TaskGoalTelemetry {
  const old = previous || emptyTelemetry();
  const tokensByModel = Array.isArray(value.tokensByModel)
    ? value.tokensByModel.flatMap((entry) => {
      const item = record(entry), modelId = text(item.modelId), tokens = numeric(item.tokens);
      return modelId && tokens != null ? [{ modelId, tokens: Math.max(0, tokens) }] : [];
    })
    : old.tokensByModel;
  return {
    goalId: text(value.goalId) ?? old.goalId,
    phase: text(value.phase) ?? old.phase,
    tokensUsed: nonNegative(value.tokensUsed) ?? old.tokensUsed,
    tokenBudget: nonNegative(value.tokenBudget) ?? old.tokenBudget,
    tokenBaseline: nonNegative(value.tokenBaseline) ?? old.tokenBaseline,
    finishedSubagentTokens: nonNegative(value.finishedSubagentTokens) ?? old.finishedSubagentTokens,
    liveSubagentTokens: nonNegative(value.liveSubagentTokens) ?? old.liveSubagentTokens,
    contextUsagePct: bounded(value.contextUsagePct, 100) ?? old.contextUsagePct,
    turnCount: nonNegative(value.turnCount) ?? old.turnCount,
    toolCallCount: nonNegative(value.toolCallCount) ?? old.toolCallCount,
    tokensByModel,
    totalDeliverables: nonNegative(value.totalDeliverables) ?? old.totalDeliverables,
    completedDeliverables: nonNegative(value.completedDeliverables) ?? old.completedDeliverables,
    workerRounds: nonNegative(value.workerRounds) ?? old.workerRounds,
    verifyRounds: nonNegative(value.verifyRounds) ?? old.verifyRounds,
    classifierRuns: nonNegative(value.classifierRuns) ?? old.classifierRuns,
    classifierMaxRuns: nonNegative(value.classifierMaxRuns) ?? old.classifierMaxRuns,
    verifyingCompletion: boolean(value.verifyingCompletion, old.verifyingCompletion),
    classifierVerdict: text(value.classifierVerdict) ?? old.classifierVerdict,
    planning: boolean(value.planning, old.planning),
    lastEvent: text(value.lastEvent) ?? old.lastEvent,
    lastEventDetail: text(value.lastEventDetail) ?? old.lastEventDetail,
    lastEventAt: text(value.lastEventAt) ?? old.lastEventAt,
  };
}

function nativeState(value: string | null): NativeGoalState | null {
  if (!value) return null;
  if (["active", "running"].includes(value)) return { status: "active", outcome: null };
  if (["user_paused", "paused"].includes(value)) return { status: "paused", outcome: null };
  if (["complete", "completed", "achieved"].includes(value)) return { status: "inactive", outcome: "completed" };
  if (value === "cleared") return { status: "inactive", outcome: "cleared", clearObjective: true };
  if (["cancelled", "canceled"].includes(value)) return { status: "inactive", outcome: "cancelled" };
  if (["failed", "error"].includes(value)) return { status: "inactive", outcome: "failed" };
  if (["interrupted", "aborted", "stopped"].includes(value)) return { status: "inactive", outcome: "interrupted" };
  return value === "inactive" ? { status: "inactive" } : null;
}

const TELEMETRY_KEYS = ["goalId", "phase", "tokensUsed", "tokenBudget", "tokenBaseline", "finishedSubagentTokens", "liveSubagentTokens", "contextUsagePct", "turnCount", "toolCallCount", "tokensByModel", "totalDeliverables", "completedDeliverables", "workerRounds", "verifyRounds", "classifierRuns", "classifierMaxRuns", "verifyingCompletion", "classifierVerdict", "planning", "lastEvent", "lastEventDetail", "lastEventAt"];
function hasTelemetry(value: Record<string, unknown>): boolean { return TELEMETRY_KEYS.some((key) => value[key] != null); }
function emptyTelemetry(): TaskGoalTelemetry { return { goalId: null, phase: null, tokensUsed: 0, tokenBudget: null, tokenBaseline: 0, finishedSubagentTokens: 0, liveSubagentTokens: null, contextUsagePct: null, turnCount: null, toolCallCount: null, tokensByModel: [], totalDeliverables: 0, completedDeliverables: 0, workerRounds: 0, verifyRounds: 0, classifierRuns: 0, classifierMaxRuns: 0, verifyingCompletion: false, classifierVerdict: null, planning: false, lastEvent: null, lastEventDetail: null, lastEventAt: null }; }
function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nonNegative(value: unknown): number | null { const candidate = numeric(value); return candidate == null ? null : Math.max(0, candidate); }
function bounded(value: unknown, max: number): number | null { const candidate = nonNegative(value); return candidate == null ? null : Math.min(max, candidate); }
function boolean(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
