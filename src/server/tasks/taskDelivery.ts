import { createHash } from "node:crypto";

export const PROMPT_RECEIPT_TIMEOUT_MS = 15_000;

export type PromptDelivery = "pending" | "unknown" | "accepted" | "failed";

export class PromptDeliveryUnknownError extends Error {
  constructor(message = "Prompt delivery could not be confirmed after the ACP connection was interrupted.") {
    super(message);
    this.name = "PromptDeliveryUnknownError";
  }
}

export function promptFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function canTransitionDelivery(
  current: PromptDelivery | undefined,
  next: PromptDelivery,
): boolean {
  if (!current) return true;
  if (current === next) return false;
  if (current === "accepted" || current === "failed") return false;
  if (current === "unknown") return next === "accepted" || next === "failed";
  return true;
}
