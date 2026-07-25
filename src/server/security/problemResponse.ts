import type { Response } from "express";
import type { ApiProblem, ProblemCode } from "../../shared/contracts.js";

export class AppProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "AppProblem";
  }
}

export function sendAppProblem(res: Response, error: AppProblem): void {
  const body: ApiProblem = {
    type: `grok-build:${error.code.toLowerCase()}` as ApiProblem["type"],
    title: titleFor(error.code),
    status: error.status,
    code: error.code,
    detail: error.message,
    ...(error.requestId ? { requestId: error.requestId } : {}),
  };
  res.status(error.status).type("application/problem+json").json(body);
}

function titleFor(code: ProblemCode): string {
  return {
    AUTH_REQUIRED: "Authentication required",
    ORIGIN_REJECTED: "Origin rejected",
    VALIDATION_FAILED: "Validation failed",
    IDEMPOTENCY_CONFLICT: "Request conflict",
    NOT_FOUND: "Not found",
    CAPABILITY_UNAVAILABLE: "Capability unavailable",
    GROK_HOME_MISMATCH: "Grok Home mismatch",
    POLICY_LOCKED: "Policy locked",
    TASK_BUSY: "Task busy",
    PATH_REJECTED: "Path rejected",
    PROTOCOL_ERROR: "Protocol error",
    REWIND_POINT_STALE: "Rewind point changed",
    REWIND_REJECTED: "Rewind rejected",
    REWIND_APPLIED_PROMPT_FAILED: "Rewind applied; replacement prompt failed",
    FORK_CREATED_ACTIVATION_FAILED: "Fork created; task activation failed",
    INTERNAL_ERROR: "Internal error",
  }[code];
}
