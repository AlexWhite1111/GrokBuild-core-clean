import type { TaskSnapshot } from "../../shared/contracts.js";

export function shouldApplyTaskProjection(
  current: Pick<TaskSnapshot, "projectionEpoch" | "revision"> | null | undefined,
  incoming: Pick<TaskSnapshot, "projectionEpoch" | "revision">,
): boolean {
  return !current
    || current.projectionEpoch !== incoming.projectionEpoch
    || current.revision <= incoming.revision;
}
