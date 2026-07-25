import path from "node:path";
import { createHash } from "node:crypto";

export function safeSessionUpdate(
  update: Record<string, unknown>,
  transportMeta: Record<string, unknown> = {},
): Record<string, unknown> {
  const content = asRecord(update.content);
  const updateMeta = readMeta(update);
  const meta = { ...updateMeta, ...transportMeta };
  const tool = asRecord(meta["x.ai/tool"]);
  const rawInput = asRecord(update.rawInput);
  const safe: Record<string, unknown> = {
    sessionUpdate: string(update.sessionUpdate) || "unknown",
  };
  for (const key of ["toolCallId", "messageId", "title", "kind", "status", "currentModeId", "modeId"] as const) {
    const value = string(update[key]);
    if (value) safe[key] = value;
  }
  for (const key of ["blockId", "contentBlockId", "requestId", "clientRequestId", "turnId", "eventId", "chunkId"] as const) {
    const value = string(meta[key]);
    if (value) safe[key] = value;
  }
  const promptId = string(meta.promptId) || string(meta.prompt_id);
  if (promptId) safe.promptId = promptId.slice(0, 512);
  const turnStartMs = safeInteger(meta.turnStartMs ?? meta.turn_start_ms);
  if (turnStartMs != null) safe.turnStartMs = turnStartMs;
  const streamStartMs = safeInteger(meta.streamStartMs ?? meta.stream_start_ms);
  if (streamStartMs != null) safe.streamStartMs = streamStartMs;
  const agentTimestampMs = safeInteger(meta.agentTimestampMs ?? meta.agent_timestamp_ms);
  if (agentTimestampMs != null) safe.agentTimestampMs = agentTimestampMs;
  const promptIndex = safeInteger(update.promptIndex ?? update.prompt_index ?? meta.promptIndex ?? meta.prompt_index);
  if (promptIndex != null) safe.promptIndex = promptIndex;
  const attempt = nonNegative(update.attempt ?? update.retryCount ?? update.retry_count);
  const maxAttempts = nonNegative(update.maxAttempts ?? update.max_attempts ?? update.maxRetries ?? update.max_retries);
  if (attempt != null) safe.attempt = attempt;
  if (maxAttempts != null) safe.maxAttempts = maxAttempts;
  const model = string(update.model) || string(update.modelId) || string(update.model_id);
  if (model) safe.model = model.slice(0, 256);
  for (const key of ["message", "reason", "result", "error", "exception"] as const) {
    const value = string(update[key]);
    if (value) safe[key] = redact(value.slice(0, 500));
  }
  applyGoalLifecycle(update, safe);
  applyWorkLifecycle(update, safe);
  const toolName = string(tool.name);
  if (toolName && /^[a-z0-9][a-z0-9_:/.-]{0,127}$/i.test(toolName)) safe.toolName = toolName;
  if (toolName === "spawn_subagent") {
    const resumedFrom = activityId(rawInput.resume_from ?? rawInput.resumedFrom);
    const promptFingerprint = fingerprint(rawInput.prompt);
    if (resumedFrom) safe.resumedFrom = resumedFrom;
    if (promptFingerprint) safe.promptFingerprint = promptFingerprint;
  } else if (safe.sessionUpdate === "user_message_chunk") {
    const promptFingerprint = fingerprint(content.text);
    if (promptFingerprint) safe.promptFingerprint = promptFingerprint;
  }
  if (typeof rawInput.background === "boolean") safe.background = rawInput.background;
  if (typeof rawInput.persistent === "boolean") safe.persistent = rawInput.persistent;
  const activityType = safeActivityType(toolName, rawInput);
  if (activityType) safe.activityType = activityType;
  if (string(content.text)) safe.text = string(content.text);
  const output = toolOutput(update);
  if (output) {
    safe.outputTail = redact(output.slice(-16_000));
    safe.outputBytes = Buffer.byteLength(output);
    safe.outputTruncated = output.length > 16_000;
  }
  const activityResults = safeActivityResults(update, toolName, rawInput);
  if (activityResults.length) safe.activityResults = activityResults;
  const activityIds = [...new Set([...safeActivityIds(rawInput), ...activityResults.map((item) => item.activityId)])];
  if (activityIds.length) safe.activityIds = activityIds;
  const plan = asRecord(update.plan);
  const entries = Array.isArray(update.entries) ? update.entries : Array.isArray(plan.entries) ? plan.entries : [];
  const planId = string(update.planId) || string(plan.planId);
  if (planId) safe.planId = planId.slice(0, 256);
  if (entries.length || safe.sessionUpdate === "plan" || safe.sessionUpdate === "plan_update") {
    safe.entries = entries.map((entry) => {
      const row = asRecord(entry);
      return {
        id: string(row.id) || string(row.todoId),
        content: string(row.content) || "",
        status: string(row.status) || "pending",
        priority: string(row.priority),
      };
    });
  }
  if (safe.sessionUpdate === "available_commands_update" && Array.isArray(update.availableCommands)) {
    safe.availableCommands = update.availableCommands.slice(0, 500).flatMap((entry) => {
      const command = asRecord(entry);
      const name = string(command.name);
      if (!name || !/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(name)) return [];
      const input = asRecord(command.input);
      return [{
        name,
        description: redact((string(command.description) || name).slice(0, 500)),
        inputHint: string(input.hint)?.slice(0, 300) || null,
      }];
    });
  }
  return safe;
}

function applyGoalLifecycle(update: Record<string, unknown>, safe: Record<string, unknown>): void {
  if (safe.sessionUpdate !== "goal_updated") return;
  const liveTokensByModel = Array.isArray(update.live_tokens_by_model) ? update.live_tokens_by_model : null;
  const tokensByModel = liveTokensByModel
    ? liveTokensByModel.slice(0, 50).flatMap((entry) => {
      const tuple = Array.isArray(entry) ? entry : [];
      const item = asRecord(entry);
      const modelId = string(tuple[0]) || string(item.model) || string(item.model_id) || string(item.modelId);
      const tokens = nonNegative(tuple[1] ?? item.tokens ?? item.tokens_used ?? item.tokensUsed);
      return modelId && tokens != null && /^[a-z0-9][a-z0-9._:/-]{0,255}$/i.test(modelId)
        ? [{ modelId, tokens }]
        : [];
    })
    : [];
  safe.goal = defined({
    goalId: clipped(update.goal_id ?? update.goalId, 256),
    objective: Object.hasOwn(update, "objective")
      ? explicitText(update.objective, 100_000)
      : undefined,
    status: clipped(update.status, 80),
    phase: clipped(update.phase, 80),
    tokensUsed: nonNegative(update.tokens_used ?? update.tokensUsed),
    tokenBudget: nonNegative(update.token_budget ?? update.tokenBudget ?? update.budget_tokens ?? update.budgetTokens),
    tokenBaseline: nonNegative(update.token_baseline ?? update.tokenBaseline),
    finishedSubagentTokens: nonNegative(update.finished_subagent_tokens ?? update.finishedSubagentTokens),
    liveSubagentTokens: nonNegative(update.live_subagent_tokens ?? update.liveSubagentTokens),
    contextUsagePct: percentage(update.live_context_pct ?? update.context_usage_pct ?? update.contextUsagePct),
    turnCount: nonNegative(update.live_turn_count ?? update.turn_count ?? update.turnCount),
    toolCallCount: nonNegative(update.live_tool_call_count ?? update.tool_call_count ?? update.toolCallCount),
    tokensByModel: liveTokensByModel ? tokensByModel : undefined,
    totalDeliverables: nonNegative(update.total_deliverables ?? update.totalDeliverables),
    completedDeliverables: nonNegative(update.completed_deliverables ?? update.completedDeliverables),
    workerRounds: nonNegative(update.total_worker_rounds ?? update.totalWorkerRounds),
    verifyRounds: nonNegative(update.total_verify_rounds ?? update.totalVerifyRounds),
    classifierRuns: nonNegative(update.classifier_runs_attempted ?? update.classifierRunsAttempted),
    classifierMaxRuns: nonNegative(update.classifier_max_runs ?? update.classifierMaxRuns),
    verifyingCompletion: booleanValue(update.verifying_completion ?? update.verifyingCompletion),
    classifierVerdict: clipped(update.last_classifier_verdict ?? update.lastClassifierVerdict, 160),
    planning: booleanValue(update.planning),
    lastEvent: clipped(update.last_event ?? update.lastEvent, 160),
    lastEventDetail: safeText(update.last_event_detail ?? update.lastEventDetail ?? update.pause_message ?? update.pauseMessage, 1_000),
    lastEventAt: clipped(update.last_event_timestamp ?? update.lastEventTimestamp, 160),
    elapsedMs: nonNegative(update.elapsed_ms ?? update.elapsedMs),
  });
}

function applyWorkLifecycle(update: Record<string, unknown>, safe: Record<string, unknown>): void {
  const kind = string(safe.sessionUpdate);
  if (!kind) return;
  if (kind === "task_backgrounded") {
    safe.taskId = string(update.task_id) || string(update.taskId);
    safe.toolCallId = string(update.tool_call_id) || string(update.toolCallId);
    const monitorTitle = string(update.monitor_description) || string(update.monitorDescription);
    safe.activityType = monitorTitle ? "monitor" : "background";
    safe.status = "running";
    safe.title = redact((monitorTitle || string(update.description) || "Background task").slice(0, 300));
    return;
  }
  if (kind === "task_completed") {
    const snapshot = asRecord(update.task_snapshot || update.taskSnapshot);
    safe.taskId = string(snapshot.task_id) || string(snapshot.taskId);
    safe.activityType = string(snapshot.kind)?.toLowerCase() === "monitor" ? "monitor" : "background";
    const killed = snapshot.explicitly_killed === true || snapshot.explicitlyKilled === true;
    const exitCode = typeof snapshot.exit_code === "number" ? snapshot.exit_code : snapshot.exitCode;
    safe.status = killed
      ? "cancelled"
      : typeof exitCode === "number" && exitCode !== 0
        ? "failed"
        : "completed";
    return;
  }
  if (kind === "subagent_spawned" || kind === "subagent_progress" || kind === "subagent_finished") {
    safe.subagentId = string(update.subagent_id) || string(update.subagentId);
    safe.childSessionId = string(update.child_session_id) || string(update.childSessionId) || safe.subagentId;
    safe.parentSessionId = string(update.parent_session_id) || string(update.parentSessionId);
    safe.parentPromptId = string(update.parent_prompt_id) || string(update.parentPromptId);
    safe.toolCallId = string(update.tool_call_id) || string(update.toolCallId);
    safe.activityType = "subagent";
    safe.title = redact((string(update.description) || string(update.subagent_type) || "Subagent").slice(0, 300));
    safe.status = kind === "subagent_finished" ? activityStatus(string(update.status)) || (string(update.error) ? "failed" : "completed") : "running";
    safe.message = redact((string(update.last_event_detail) || string(update.lastEventDetail) || string(update.error) || string(update.output) || "").slice(0, 500)) || undefined;
    const output = string(update.output) || string(update.error);
    if (output) safe.outputTail = redact(output.slice(-16_000));
    safe.telemetry = {
      agentType: clipped(update.subagent_type ?? update.subagentType, 160),
      role: clipped(update.role, 160),
      modelId: clipped(update.model ?? update.model_id ?? update.modelId, 256),
      contextSource: clipped(update.effective_context_source ?? update.effectiveContextSource, 160),
      capabilityMode: clipped(update.capability_mode ?? update.capabilityMode, 160),
      resumedFrom: clipped(update.resumed_from ?? update.resumedFrom, 256),
      contextNormalized: typeof (update.context_normalized ?? update.contextNormalized) === "boolean" ? update.context_normalized ?? update.contextNormalized : null,
      turnCount: nonNegative(update.turns ?? update.turn_count ?? update.turnCount),
      toolCallCount: nonNegative(update.tool_calls ?? update.tool_call_count ?? update.toolCallCount),
      errorCount: nonNegative(update.error_count ?? update.errorCount) ?? (string(update.error) ? 1 : null),
      contextUsagePct: percentage(update.context_usage_pct ?? update.contextUsagePct),
      tokensUsed: nonNegative(update.tokens_used ?? update.tokensUsed),
      durationMs: nonNegative(update.duration_ms ?? update.durationMs),
      toolsUsed: safeStringList(update.tools_used ?? update.toolsUsed, 100, 160),
      willWake: typeof (update.will_wake ?? update.willWake) === "boolean" ? update.will_wake ?? update.willWake : null,
    };
    return;
  }
  if (kind === "monitor_event") {
    safe.taskId = string(update.task_id) || string(update.taskId);
    safe.activityType = "monitor";
    safe.status = activityStatus(string(update.status)) || "running";
    safe.title = redact((string(update.description) || "Monitor").slice(0, 300));
    safe.message = redact((string(update.event_text) || string(update.eventText) || string(update.message) || "").slice(0, 500)) || undefined;
    return;
  }
  if (kind === "scheduled_task_created" || kind === "scheduled_task_fired" || kind === "scheduled_task_deleted") {
    safe.taskId = string(update.task_id) || string(update.taskId);
    safe.toolCallId = string(update.tool_call_id) || string(update.toolCallId);
    safe.activityType = "loop";
    safe.status = kind === "scheduled_task_deleted" ? "cancelled" : "running";
    safe.title = redact((string(update.human_schedule) || string(update.humanSchedule) || "Loop").slice(0, 300));
    safe.message = kind === "scheduled_task_fired" ? "Running scheduled task" : undefined;
  }
}

function safeActivityResults(update: Record<string, unknown>, toolName?: string, rawInput: Record<string, unknown> = {}): Array<{ activityId: string; status: string; outputTail?: string }> {
  const candidates = [update.rawOutput, update.output, ...contentValues(update.content)];
  const results = candidates.flatMap(resultRows).flatMap((value) => {
    const item = asRecord(value);
    const type = string(item.type)?.toLowerCase();
    const activityId = string(item.task_id) || string(item.taskId) || string(item.subagent_id) || string(item.subagentId)
      || (type === "schedulercreate" ? string(item.id) : undefined);
    const status = activityStatus(string(item.status) || string(item.state))
      || (type === "monitor" || type === "backgroundtaskstarted" || type === "schedulercreate" ? "running" : undefined);
    if (!activityId || !/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(activityId) || !status) return [];
    const output = string(item.output) || string(item.result);
    return [{ activityId, status, ...(output ? { outputTail: redact(output.slice(-16_000)) } : {}) }];
  });
  const deletedId = toolName === "scheduler_delete" && candidates.flatMap(resultRows).some((value) => asRecord(value).success === true)
    ? string(rawInput.id)
    : undefined;
  if (deletedId && /^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(deletedId)) results.push({ activityId: deletedId, status: "cancelled" });
  return results.slice(0, 20);
}

function contentValues(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    const content = asRecord(item.content);
    return item.type === "content" && content.type === "text" ? [content.text] : [];
  });
}

function resultRows(value: unknown): unknown[] {
  if (typeof value === "string") {
    try { return resultRows(JSON.parse(value)); } catch { return []; }
  }
  if (Array.isArray(value)) return value;
  const item = asRecord(value);
  for (const key of ["Result", "result", "MultiResult", "multiResult"] as const) {
    if (item[key] && typeof item[key] === "object") return resultRows(item[key]);
  }
  for (const key of ["tasks", "results", "items"] as const) if (Array.isArray(item[key])) return item[key];
  return Object.keys(item).length ? [item] : [];
}

function activityStatus(value: string | undefined): string | undefined {
  const status = value?.toLowerCase().replaceAll("-", "_");
  if (status === "canceled") return "cancelled";
  return ["pending", "running", "in_progress", "completed", "failed", "cancelled"].includes(status || "") ? status : undefined;
}

function safeActivityType(toolName: string | undefined, input: Record<string, unknown>): "subagent" | "background" | "monitor" | "loop" | undefined {
  const normalized = toolName?.toLowerCase();
  if (normalized === "spawn_subagent") return "subagent";
  if (normalized === "monitor") return "monitor";
  if (normalized === "run_terminal_command" && input.background === true) return "background";
  if (normalized === "scheduler_create" || normalized === "loop") return "loop";
  return undefined;
}

function safeActivityIds(input: Record<string, unknown>): string[] {
  const values: unknown[] = [input.task_id, input.taskId, input.subagent_id, input.subagentId];
  if (Array.isArray(input.task_ids)) values.push(...input.task_ids);
  if (Array.isArray(input.taskIds)) values.push(...input.taskIds);
  return [...new Set(values.flatMap((value) => {
    const candidate = string(value);
    return candidate && /^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(candidate) ? [candidate] : [];
  }))].slice(0, 20);
}

function activityId(value: unknown): string | undefined {
  const candidate = string(value);
  return candidate && /^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(candidate) ? candidate : undefined;
}

function fingerprint(value: unknown): string | undefined {
  const candidate = string(value);
  return candidate ? createHash("sha256").update(candidate).digest("hex") : undefined;
}

function toolOutput(update: Record<string, unknown>): string | undefined {
  const direct = string(update.rawOutput) || string(asRecord(update.output).text);
  if (direct) return direct;
  if (!Array.isArray(update.content)) return undefined;
  const chunks = update.content.flatMap((entry) => {
    const item = asRecord(entry);
    if (item.type === "content") {
      const content = asRecord(item.content);
      return content.type === "text" && string(content.text) ? [string(content.text)!] : [];
    }
    if (item.type === "diff" && string(item.path)) return [`[diff] ${path.basename(string(item.path)!)} (content retained by Grok, not duplicated in the event store)`];
    return [];
  });
  return chunks.length ? chunks.join("\n") : undefined;
}

export function sanitizeXai(method: string, params: unknown): unknown {
  const record = asRecord(params);
  if (method === "x.ai/queue/changed") {
    return {
      sessionId: string(record.sessionId),
      runningPromptId: string(record.runningPromptId),
      entries: Array.isArray(record.entries) ? record.entries.map((entry) => {
        const item = asRecord(entry);
        return {
          id: string(item.id) || string(item.serverId),
          requestId: string(item.requestId) || string(item.clientRequestId),
          version: number(item.version),
          kind: string(item.kind),
          text: string(item.text)?.slice(0, 500),
          position: number(item.position),
        };
      }) : [],
    };
  }
  if (method === "x.ai/sessions/changed") {
    return {
      upserted: Array.isArray(record.upserted)
        ? record.upserted.slice(0, 10_000).flatMap((entry) => {
          const item = asRecord(entry);
          const sessionId = string(item.sessionId);
          if (!sessionId) return [];
          const modelValue = Object.hasOwn(item, "modelId") ? item.modelId : item.model_id;
          const effortValue = Object.hasOwn(item, "reasoningEffort") ? item.reasoningEffort : item.reasoning_effort;
          const modelId = typeof modelValue === "string" && /^[A-Za-z0-9._:/-]{1,256}$/.test(modelValue)
            ? modelValue
            : modelValue === null ? null : undefined;
          const reasoningEffort = typeof effortValue === "string" && /^[A-Za-z0-9._:/-]{1,64}$/.test(effortValue)
            ? effortValue
            : effortValue === null ? null : undefined;
          return [{
            sessionId: sessionId.slice(0, 1_024),
            ...(typeof item.yolo === "boolean" ? { yolo: item.yolo } : {}),
            ...(Object.hasOwn(item, "autoMode") || Object.hasOwn(item, "auto_mode")
              ? { autoMode: typeof item.autoMode === "boolean" ? item.autoMode : typeof item.auto_mode === "boolean" ? item.auto_mode : null }
              : {}),
            ...(modelId !== undefined ? { modelId } : {}),
            ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
            ...(string(item.activity) ? { activity: string(item.activity)!.slice(0, 160) } : {}),
            ...(Object.hasOwn(item, "resident") ? { resident: typeof item.resident === "boolean" ? item.resident : null } : {}),
          }];
        })
        : [],
      removed: Array.isArray(record.removed)
        ? record.removed.flatMap((entry) => {
          const sessionId = string(entry);
          return sessionId ? [sessionId.slice(0, 1_024)] : [];
        }).slice(0, 10_000)
        : [],
    };
  }
  if (method === "x.ai/settings/update") {
    return {
      autoPermissionModeEnabled:
        typeof record.auto_permission_mode_enabled === "boolean"
          ? record.auto_permission_mode_enabled
          : null,
      permissionMode: string(record.permission_mode)?.slice(0, 160) || null,
    };
  }
  const signal = xaiSignal(record);
  const protocol = signal.flatMap((value) => [value, readMeta(value)]);
  return {
    sessionId: string(record.sessionId),
    type: firstString(signal, ["sessionUpdate", "type", "kind", "event", "name", "notificationType", "notification_type"]) || method,
    status: firstString(signal, ["status", "state", "phase"]),
    promptId: firstString(protocol, ["promptId", "prompt_id"]),
    turnStartMs: firstSafeInteger(protocol, ["turnStartMs", "turn_start_ms"]),
    streamStartMs: firstSafeInteger(protocol, ["streamStartMs", "stream_start_ms"]),
    agentTimestampMs: firstSafeInteger(protocol, ["agentTimestampMs", "agent_timestamp_ms"]),
    stopReason: firstString(signal, ["stopReason", "stop_reason"]),
    message: safeSignalText(signal, "message"),
    reason: safeSignalText(signal, "reason"),
    result: safeSignalText(signal, "result"),
    error: safeSignalText(signal, "error"),
    exception: safeSignalText(signal, "exception"),
    attempt: firstNumber(signal, ["attempt", "retryCount", "retry_count"]),
    maxAttempts: firstNumber(signal, ["maxAttempts", "max_attempts", "maxRetries", "max_retries"]),
    model: firstString(signal, ["model", "modelId", "model_id"]),
  };
}

function xaiSignal(record: Record<string, unknown>): Record<string, unknown>[] {
  const nested = ["notification", "update", "payload", "data", "event"].map((key) => asRecord(record[key])).filter((value) => Object.keys(value).length);
  return [...nested, record];
}

function firstString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) for (const key of keys) {
    const value = string(record[key]);
    if (value) return value.slice(0, 160);
  }
  return undefined;
}

function firstNumber(records: Record<string, unknown>[], keys: string[]): number | null {
  for (const record of records) for (const key of keys) {
    const value = number(record[key]);
    if (value != null) return value;
  }
  return null;
}

function firstSafeInteger(records: Record<string, unknown>[], keys: string[]): number | undefined {
  for (const record of records) for (const key of keys) {
    const value = safeInteger(record[key]);
    if (value != null) return value;
  }
  return undefined;
}

function safeSignalText(records: Record<string, unknown>[], key: string): string | undefined {
  for (const record of records) {
    const value = string(record[key]);
    if (value) return redact(value.slice(0, 500));
  }
  return undefined;
}

export function readMeta(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord(value._meta);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number | null {
  const candidate = number(value);
  return candidate == null ? null : Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, candidate));
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function percentage(value: unknown): number | null {
  const candidate = number(value);
  return candidate == null ? null : Math.min(100, Math.max(0, candidate));
}

function booleanValue(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function defined(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null)); }

function clipped(value: unknown, max: number): string | null {
  const candidate = string(value);
  return candidate ? candidate.slice(0, max) : null;
}

function safeText(value: unknown, max: number): string | null {
  const candidate = clipped(value, max);
  return candidate ? redact(candidate) : null;
}

function explicitText(value: unknown, max: number): string | undefined {
  return typeof value === "string"
    ? redact(value.trim().slice(0, max))
    : undefined;
}

function safeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maxItems).flatMap((entry) => {
    const candidate = string(entry);
    return candidate ? [redact(candidate.slice(0, maxLength))] : [];
  }))];
}

function redact(value: string): string {
  return value
    .replace(/\b(?:xai|sk|key)-[A-Za-z0-9._-]{8,}\b/gi, "[redacted-token]")
    .replace(/((?:access|refresh|id)_token\s*[=:]\s*["']?)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(authorization\s*[=:]\s*(?:bearer\s+)?)[^\s,"'}]+/gi, "$1[redacted]");
}
