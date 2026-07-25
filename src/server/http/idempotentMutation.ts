import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { ZodType } from "zod";
import type { IdempotencyStore } from "../security/idempotencyStore.js";
import { AppProblem } from "../security/problemResponse.js";

export function executeMutation<Input extends { requestId: string }>(
  req: Request,
  res: Response,
  next: (error?: unknown) => void,
  schema: ZodType<Input>,
  store: IdempotencyStore,
  operation: (input: Input) => unknown | Promise<unknown>,
): void {
  void (async () => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppProblem(
        400,
        "VALIDATION_FAILED",
        parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "),
      );
    }
    const fingerprint = createHash("sha256")
      .update(`${req.method}:${req.path}:${stableJson(parsed.data)}`)
      .digest("hex");
    const result = await store.run(parsed.data.requestId, fingerprint, () => operation(parsed.data));
    res.json(result);
  })().catch(next);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
