import type { TaskSnapshot } from "../../shared/contracts.js";

type QueueBearingSnapshot = Pick<TaskSnapshot, "activities" | "queue">;

export function hasPendingNativeQueue(snapshot: QueueBearingSnapshot): boolean {
  return snapshot.activities.waiting > 0
    || snapshot.queue.runningEntryId !== null
    || snapshot.queue.entries.length > 0;
}
