import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { RichTextRenderPolicy, TaskMediaAttachment } from "../../shared/contracts.js";
import { RichContent } from "../thread/RichContent.js";
import styles from "./GateComposer.module.css";
import { Control, SelectionMark, Surface } from "../../ui/components/index.js";

export interface QuestionOptionData {
  label: string;
  description: string;
  preview: string;
  labelMedia: TaskMediaAttachment[];
  descriptionMedia: TaskMediaAttachment[];
  previewMedia: TaskMediaAttachment[];
}

export function QuestionOption({ gateId, step, index, option, active, multi, expanded, onToggle, onExpandedChange, taskId, renderPolicy, mediaScale }: {
  gateId: string;
  step: number;
  index: number;
  option: QuestionOptionData;
  active: boolean;
  multi: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpandedChange: (expanded: boolean) => void;
  taskId?: string;
  renderPolicy?: RichTextRenderPolicy;
  mediaScale?: number;
}) {
  const { t } = useTranslation();
  const row = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const hasExpandedContent = Boolean(option.preview.trim() || option.previewMedia.length);
  const expandable = overflowing || hasExpandedContent;
  const titleId = `question-${gateId.replace(/[^a-z0-9_-]/gi, "")}-${step}-${index}`;

  useLayoutEffect(() => {
    const element = copy.current;
    if (!element || expanded) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, option.label, option.description, option.labelMedia, option.descriptionMedia]);

  useEffect(() => {
    if (!expanded) return;
    requestAnimationFrame(() => row.current?.scrollIntoView?.({ block: "nearest" }));
  }, [expanded]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    gesture.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 7) current.moved = true;
  };
  const choose = (event: ReactPointerEvent<HTMLDivElement>) => {
    const moved = gesture.current?.moved;
    gesture.current = null;
    if (!moved && selectableRichTextTarget(event.target)) onToggle();
  };

  return <Surface elementRef={(element) => { row.current = element; }} appearance="plain" shape="control" interactive selected={active} className={styles.optionRow} data-expanded={expanded || undefined}>
    <Control recipe="icon" density="detail" shape="round" onClick={onToggle} aria-labelledby={titleId} aria-pressed={active}>
      <SelectionMark selected={active} multiple={multi} />
    </Control>
    <div
      ref={copy}
      className={`${styles.optionCopy} ${expandable ? styles.optionCopyExpandable : ""}`}
      data-option-copy
      data-expanded={expanded || undefined}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerCancel={() => { gesture.current = null; }}
      onPointerUp={choose}
    >
      <div className={styles.optionLead}>
        <div id={titleId} className={styles.optionTitle}><RichContent taskId={taskId} text={option.label} media={option.labelMedia} renderPolicy={renderPolicy} mediaScale={mediaScale} density="compact" flow={expanded ? "block" : "inline"} /></div>
        {option.description && <div className={styles.optionDescription}><RichContent taskId={taskId} text={option.description} media={option.descriptionMedia} renderPolicy={renderPolicy} mediaScale={mediaScale} density="compact" flow={expanded ? "block" : "inline"} /></div>}
      </div>
      {expanded && hasExpandedContent && <div className={styles.optionPreview}><RichContent taskId={taskId} text={option.preview} media={option.previewMedia} renderPolicy={renderPolicy} mediaScale={mediaScale} density="compact" /></div>}
    </div>
    {expandable && <Control
      recipe="text"
      density="compact"
      shape="none"
      className={styles.optionExpand}
      data-no-select
      aria-expanded={expanded}
      aria-label={`${t(expanded ? "collapseOption" : "expandOption")} ${index + 1}`}
      onClick={(event) => { event.stopPropagation(); onExpandedChange(!expanded); }}
    >{expanded ? t("collapseQuestion") : "⋯"}</Control>}
  </Surface>;
}

function selectableRichTextTarget(value: EventTarget | null): boolean {
  return value instanceof Element && !value.closest("a, button, input, textarea, select, figure, img, video, audio, table, pre, details, [data-no-select]");
}
