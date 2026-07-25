import type { BackendProcess } from "./BackendProcess.js";
import { TextClipReconciler } from "./TextClipReconciler.js";
import type { TextClipStore } from "./TextClipStore.js";

const RECONCILE_INTERVAL_MS = 5 * 60_000;
const ORPHAN_GRACE_MS = 30 * 60_000;

/** Starts shell-owned clip reconciliation and returns the matching disposer. */
export async function startTextClipLifecycle(
  store: TextClipStore,
  backend: BackendProcess,
  report: (message: string) => void,
): Promise<() => void> {
  const reconciler = new TextClipReconciler(store, {
    loadAuthority: () => backend.textClipAuthority(),
    intervalMs: RECONCILE_INTERVAL_MS,
    orphanGraceMs: ORPHAN_GRACE_MS,
    onError: (error) => report(`Reconciliation skipped: ${message(error)}`),
  });
  try {
    const result = await reconciler.start();
    if (result.transferred || result.removed) report(`Reconciled ${result.transferred} owner(s); removed ${result.removed} orphan(s).`);
  } catch (error) {
    report(`Startup reconciliation skipped: ${message(error)}`);
  }
  return () => reconciler.stop();
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
