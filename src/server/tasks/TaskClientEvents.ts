import type { ReverseRequestClosedEvent, ReverseRequestEvent } from "../acp/OfficialAcpClient.js";
import { acpSessionUpdate } from "../acp/OfficialAcpClient.js";
import {
  permissionCancelled,
  permissionOptionId,
  permissionSelected,
} from "../acp/reverseContracts.js";
import { asRecord, readMeta, sanitizeXai, string } from "./taskEventSanitizers.js";
import { renumberGates, toGate } from "./taskGates.js";
import type { TaskRuntimeContext } from "./TaskRuntimeContext.js";
import { PROMPT_RECEIPT_TIMEOUT_MS } from "./taskDelivery.js";

export function wireTaskClientEvents(options: TaskRuntimeContext): void {
  options.client.on("notification", (event: unknown) => {
    const value = asRecord(event);
    const method = string(value.method) || "unknown";
    if ((method === "session/update" || method === "x.ai/session/update") && acpSessionUpdate(value.params)) {
      const params = asRecord(value.params);
      const sessionId = string(params.sessionId);
      const ownSession = !sessionId || sessionId === options.projection.snapshot.sessionId;
      if (!ownSession) {
        options.projection.applyNotification({ kind: "child-acp", params: value.params });
        options.touch();
        options.change();
        return;
      }
      const update = asRecord(asRecord(value.params).update);
      const updateType = string(update.sessionUpdate);
      const userMessage = updateType === "user_message_chunk";
      const meta = { ...readMeta(update), ...readMeta(params) };
      const echo = userMessage ? options.claimUserEcho(
        string(meta.requestId) || string(meta.clientRequestId) || string(meta.promptId) || string(meta.prompt_id),
      ) : undefined;
      const terminal = updateType === "turn_completed"
        ? "completed"
        : updateType === "turn_failed"
          ? "failed"
          : null;
      const completion = terminal
        ? options.completionReceipt(value.params)
        : { requestIds: [], turnId: null };
      const turnId = terminal ? completion.turnId : options.activeTurnId();
      const outcome = options.projection.applyNotification({ kind: "acp", params: value.params, turnId, userEcho: echo });
      if (outcome.refreshContextWindow) options.refreshContextWindow();
      const accepted = [...new Set([...outcome.acceptedRequestIds, ...completion.requestIds])];
      if (accepted.length) options.acceptPending(accepted);
      if (terminal) {
        options.settleTurn(
          turnId,
          terminal,
          terminal === "failed" ? turnFailure(update) : update,
        );
      }
    } else if (method.startsWith("x.ai/")) {
      const sessionId = string(asRecord(value.params).sessionId);
      if (sessionId && sessionId !== options.projection.snapshot.sessionId) {
        options.projection.applyNotification({ kind: "child-xai", method, params: value.params });
      }
      else {
        const terminal = xaiTerminal(method, value.params);
        const completion = terminal
          ? options.completionReceipt(value.params)
          : { requestIds: [], turnId: null };
        const turnId = terminal ? completion.turnId : options.latestTurnId();
        const accepted = options.projection.applyNotification({ kind: "xai", method, params: value.params, turnId }).acceptedRequestIds;
        const promptReceipts = method === "x.ai/queue/changed" ? options.promptReceiptsFromQueue(value.params) : [];
        const completions = completion.requestIds;
        if (accepted.length || promptReceipts.length || completions.length) {
          options.acceptPending([...new Set([...accepted, ...promptReceipts, ...completions])]);
        }
        if (terminal) {
          const terminalValue = sanitizeXai(method, value.params);
          options.settleTurn(turnId, terminal, terminal === "failed" ? turnFailure(asRecord(terminalValue)) : terminalValue);
        }
      }
    }
    options.touch();
    options.change();
  });
  options.client.on("reverseRequest", (event: ReverseRequestEvent) => {
    const sessionId = string(asRecord(event.params).sessionId);
    const sessionScope = sessionId && sessionId !== options.projection.snapshot.sessionId
      ? "child"
      : "parent";
    const permissionMode = options.projection.snapshot.permission.effective;
    if (event.method === "session/request_permission" && (
      permissionMode === "alwaysApprove" || permissionMode === "dontAsk"
    )) {
      const approval = permissionMode === "alwaysApprove";
      const selection = approval
        ? permissionSelection(event.params, "allow_once", "allow_always")
        : permissionSelection(event.params, "reject_once", "reject_always");
      options.client.resolveGate(
        event.gateId,
        selection ? permissionSelected(selection.optionId) : permissionCancelled(),
      );
      options.projection.record(
        "supervisor",
        approval ? "task/permission:policy-approved" : "task/permission:policy-rejected",
        options.latestTurnId(),
        {
          gateId: event.gateId,
          optionKind: selection?.kind || "cancelled",
          sessionScope,
        },
      );
      options.touch();
      options.change();
      return;
    }
    options.projection.addGate(
      toGate(
        event,
        options.projectPath,
        options.latestTurnId(),
        options.media ? { store: options.media, taskId: options.projection.snapshot.taskId } : undefined,
        { sessionScope },
      ),
      event.params,
    );
    renumberGates(options.projection.snapshot.gates);
    options.touch();
    options.change();
  });
  options.client.on("reverseRequestClosed", (event: ReverseRequestClosedEvent) => {
    if (!options.projection.removeGate(event.gateId, event.reason)) return;
    options.touch();
    options.change();
  });
  options.client.on("disconnect", options.disconnect);
}

function xaiTerminal(method: string, params: unknown): "completed" | "failed" | null {
  if (method === "x.ai/session/prompt_complete") return "completed";
  if (method !== "x.ai/session_notification") return null;
  const type = string(asRecord(sanitizeXai(method, params)).type);
  return type === "turn_completed" ? "completed" : type === "turn_failed" ? "failed" : null;
}

function turnFailure(value: Record<string, unknown>): Error {
  return new Error(
    string(value.error)
      || string(value.message)
      || string(value.reason)
      || "Grok turn failed.",
  );
}

function permissionSelection(
  params: unknown,
  preferred: "allow_once" | "reject_once",
  fallback: "allow_always" | "reject_always",
): { optionId: string; kind: typeof preferred | typeof fallback } | null {
  const preferredId = permissionOptionId(params, preferred);
  if (preferredId) return { optionId: preferredId, kind: preferred };
  const fallbackId = permissionOptionId(params, fallback);
  return fallbackId ? { optionId: fallbackId, kind: fallback } : null;
}

export function waitForPromptAcceptance(
  completion: Promise<unknown>,
  waiters: Map<string, () => void>,
  requestId: string,
  timeoutMs = PROMPT_RECEIPT_TIMEOUT_MS,
): Promise<"accepted" | "unknown"> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish("unknown"), timeoutMs);
    timer.unref();
    const finish = (outcome: "accepted" | "unknown") => {
      if (settled) return;
      settled = true;
      waiters.delete(requestId);
      clearTimeout(timer);
      resolve(outcome);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      waiters.delete(requestId);
      clearTimeout(timer);
      reject(error);
    };
    const accept = () => {
      finish("accepted");
    };
    waiters.set(requestId, accept);
    void completion.then(accept, fail);
  });
}
