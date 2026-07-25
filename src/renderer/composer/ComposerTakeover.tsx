import type { PropsWithChildren } from "react";
import type { ComposerPendingGate, GateDecision, RichTextRenderPolicy } from "../../shared/contracts.js";
import { GateComposer } from "./GateComposer.js";

export function ComposerTakeover({ gate, taskId, renderPolicy, mediaScale, onDecision, children }: PropsWithChildren<{
  gate?: ComposerPendingGate;
  taskId: string;
  renderPolicy?: RichTextRenderPolicy;
  mediaScale?: number;
  onDecision: (decision: GateDecision) => unknown | Promise<unknown>;
}>) {
  return <>
    <div hidden={Boolean(gate)} aria-hidden={gate ? "true" : undefined}>{children}</div>
    {gate && <GateComposer key={gate.gateId} gate={gate} taskId={taskId} renderPolicy={renderPolicy} mediaScale={mediaScale} onDecision={onDecision} />}
  </>;
}
