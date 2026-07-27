import type {
  TaskProjectionChange,
  TaskRuntimeProjection as TaskProjection,
} from "./TaskRuntimeProjection.js";
import { waitForPromptAcceptance } from "./TaskClientEvents.js";
import { PromptDeliveryUnknownError } from "./taskDelivery.js";

interface TaskPromptReceiptOptions {
  projection: TaskProjection;
  acceptedWaiters: Map<string, () => void>;
  connectionInterrupted(): boolean;
  touch(): void;
  change(change?: TaskProjectionChange): void;
}

/** Owns transport-receipt timing without making Goal lifecycle claims. */
export class TaskPromptReceiptRuntime {
  constructor(private readonly options: TaskPromptReceiptOptions) {}

  waitFor(completion: Promise<unknown>, requestId: string): Promise<void> {
    return this.#apply(
      waitForPromptAcceptance(completion, this.options.acceptedWaiters, requestId),
      requestId,
    );
  }

  async #apply(receipt: Promise<"accepted" | "unknown">, requestId: string): Promise<void> {
    try {
      if (await receipt !== "unknown") return;
    } catch (error) {
      if (!(error instanceof PromptDeliveryUnknownError) && !this.options.connectionInterrupted()) throw error;
    }
    this.options.projection.setUserMessageDelivery(requestId, "unknown");
    this.options.projection.touch();
    this.options.touch();
    this.options.change("delta");
  }
}
