import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, GripVertical, Pencil, Send, Trash2, X } from "lucide-react";
import type { NativeQueueEntry } from "../../shared/contracts.js";
import styles from "./NativeQueue.module.css";
import { AutoGrowTextarea, Control, Spinner, Surface } from "../../ui/components/index.js";
import { useTranslation } from "react-i18next";

export function NativeQueue({ entries, gateActive, onEdit, onRemove, onReorder, onSendNow }: {
  entries: NativeQueueEntry[];
  gateActive: boolean;
  onEdit: (entry: NativeQueueEntry, text: string) => Promise<void>;
  onRemove: (entry: NativeQueueEntry) => Promise<void>;
  onReorder: (entry: NativeQueueEntry, position: number) => Promise<void>;
  onSendNow: (entry: NativeQueueEntry) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pointerDrag = useRef<{ pointerId: number; requestId: string; targetRequestId: string } | null>(null);
  const orderedEntries = useMemo(() => entries.slice().sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)), [entries]);
  if (!entries.length) return null;
  const run = async (key: string, operation: () => Promise<void>) => {
    setPendingAction(key);
    try { await operation(); return true; }
    catch { return false; }
    finally { setPendingAction(null); }
  };
  const saveEdit = async (entry: NativeQueueEntry) => {
    const text = draft.trim();
    if (!text) return;
    if (await run(`${entry.requestId}:edit`, () => onEdit(entry, text))) setEditing(null);
  };
  const move = async (target: NativeQueueEntry, sourceRequestId = dragged) => {
    const nativeEntries = orderedEntries.filter((item) => item.entryId);
    const source = nativeEntries.find((item) => item.requestId === sourceRequestId);
    const position = nativeEntries.findIndex((item) => item.requestId === target.requestId);
    setDragged(null);
    setDragTarget(null);
    if (!source?.entryId || !target.entryId || position < 0 || source.requestId === target.requestId) return;
    await run(`${source.requestId}:reorder`, () => onReorder(source, position));
  };
  const pointerStart = (event: ReactPointerEvent<HTMLSpanElement>, entry: NativeQueueEntry, pending: boolean, isEditing: boolean) => {
    if (event.pointerType === "mouse" || pending || isEditing || event.button > 0) return;
    pointerDrag.current = { pointerId: event.pointerId, requestId: entry.requestId, targetRequestId: entry.requestId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragged(entry.requestId);
    setDragTarget(entry.requestId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (pointerDrag.current?.pointerId !== event.pointerId) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-queue-id]");
    const requestId = row?.dataset.queueId;
    if (requestId && orderedEntries.some((entry) => entry.requestId === requestId && entry.entryId)) {
      pointerDrag.current.targetRequestId = requestId;
      setDragTarget(requestId);
    }
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const active = pointerDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    pointerDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = orderedEntries.find((entry) => entry.requestId === active.targetRequestId);
    if (target) void move(target, active.requestId);
    else { setDragged(null); setDragTarget(null); }
  };
  const mutationPending = pendingAction !== null;
  return <Surface as="section" appearance="raised" elevation="floating" className={styles.queue} aria-label="Native Queue">
    <div className={styles.list}>{orderedEntries.map((entry) => {
      const actionPending = pendingAction?.startsWith(`${entry.requestId}:`) === true;
      const pending = !entry.entryId || mutationPending;
      const isEditing = editing === entry.requestId;
      return <Surface appearance="plain" shape="control" interactive selected={Boolean(dragged && dragTarget === entry.requestId)} className={styles.row} key={entry.requestId} data-queue-id={entry.requestId} data-dragging={dragged === entry.requestId} onDragOver={(event) => event.preventDefault()} onDrop={() => void move(entry)}>
        <span className={styles.grip} role="button" tabIndex={pending || isEditing ? -1 : 0} aria-label={t("reorderQueueItem", { prompt: entry.textPreview })} draggable={!pending && !isEditing} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragged(entry.requestId); setDragTarget(entry.requestId); }} onDragEnd={() => { setDragged(null); setDragTarget(null); }} onPointerDown={(event) => pointerStart(event, entry, pending, isEditing)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onKeyDown={(event) => {
          if (pending || isEditing || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const nativeEntries = orderedEntries.filter((item) => item.entryId);
          const current = nativeEntries.findIndex((item) => item.requestId === entry.requestId);
          const position = Math.max(0, Math.min(nativeEntries.length - 1, current + (event.key === "ArrowUp" ? -1 : 1)));
          if (position !== current) void run(`${entry.requestId}:reorder`, () => onReorder(entry, position));
        }}>{!entry.entryId || actionPending ? <Spinner size="compact" tone="accent" /> : <GripVertical size={13} />}</span>
        {isEditing ? <AutoGrowTextarea autoFocus appearance="plain" density="compact" maxLines={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void saveEdit(entry); } }} /> : <div className={styles.prompt} tabIndex={0}>{entry.textPreview}</div>}
        {!actionPending && entry.entryId && <div className={styles.actions}>{isEditing ? <><Control recipe="icon" density="compact" shape="round" onClick={() => void saveEdit(entry)} disabled={mutationPending || !draft.trim()} aria-label={t("saveQueueEdit")}><Check size={12} /></Control><Control recipe="icon" density="compact" shape="round" disabled={mutationPending} onClick={() => setEditing(null)} aria-label={t("cancelQueueEdit")}><X size={12} /></Control></> : <><Control recipe="icon" density="compact" shape="round" disabled={mutationPending} onClick={() => { setEditing(entry.requestId); setDraft(entry.textPreview); }} aria-label={t("editQueueItem")}><Pencil size={12} /></Control><Control recipe="icon" density="compact" shape="round" disabled={mutationPending || gateActive} onClick={() => void run(`${entry.requestId}:send`, () => onSendNow(entry))} aria-label={t("sendQueueNow")}><Send size={12} /></Control><Control recipe="icon" density="compact" shape="round" tone="danger" disabled={mutationPending} onClick={() => void run(`${entry.requestId}:remove`, () => onRemove(entry))} aria-label={t("deleteQueueItem")}><Trash2 size={12} /></Control></>}</div>}
      </Surface>;
    })}</div>
  </Surface>;
}
