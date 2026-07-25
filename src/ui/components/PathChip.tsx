import type { KeyboardEvent, MouseEvent } from "react";
import { PathReferenceSummarySchema, type PathReferenceSummary } from "../../shared/contracts.js";
import { pathBadge } from "./pathBadge.js";
import { pathIconElement, pathIconMarkup } from "./pathIcon.js";
import styles from "./PathChip.module.css";

export const PATH_CHIP_MIME = "application/x-grok-build-path-reference+json";
export const PATH_CHIP_SOURCE_MIME = "application/x-grok-build-path-source";

export function writePathChipTransfer(transfer: DataTransfer, path: PathReferenceSummary): void {
  transfer.effectAllowed = "copyMove";
  transfer.setData(PATH_CHIP_MIME, JSON.stringify(path));
  transfer.setData("text/plain", path.serializedPath);
}

export function readPathChipTransfer(transfer: DataTransfer): PathReferenceSummary | null {
  const value = transfer.getData(PATH_CHIP_MIME);
  if (!value || value.length > 32_768) return null;
  try {
    const parsed = PathReferenceSummarySchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function PathChip({ path, label = path.name, title = path.displayPath, onOpen, openOnClick = false, dragEnabled = path.valid, className = "" }: {
  path: PathReferenceSummary;
  label?: string;
  title?: string;
  onOpen?: () => void;
  openOnClick?: boolean;
  dragEnabled?: boolean;
  className?: string;
}) {
  const badge = pathBadge(path);
  const openable = Boolean(onOpen && path.valid);
  const draggable = Boolean(dragEnabled && path.valid);
  const open = (event: MouseEvent | KeyboardEvent) => {
    if (!openable || !onOpen) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen();
  };
  return <span
    className={`${styles.chip} ${className}`}
    data-ui-path-chip
    data-shape="control"
    data-path-kind={path.kind}
    data-file-type={badge.tone}
    data-path-icon={badge.icon}
    data-path-valid={String(path.valid)}
    data-openable={openable ? "true" : undefined}
    title={title}
    aria-label={`${label}: ${title}`}
    aria-disabled={!path.valid || undefined}
    draggable={draggable}
    role={openable ? "button" : undefined}
    tabIndex={openable ? 0 : undefined}
    onClick={openOnClick ? open : undefined}
    onDoubleClick={openOnClick ? undefined : open}
    onDragStart={(event) => {
      if (!draggable) { event.preventDefault(); return; }
      writePathChipTransfer(event.dataTransfer, path);
    }}
    onKeyDown={(event) => { if (event.key === "Enter") open(event); }}
  ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: pathIconMarkup(badge.icon) }} /><span>{label}</span></span>;
}

export function createPathChipElement(path: PathReferenceSummary): HTMLSpanElement {
  const badge = pathBadge(path);
  const chip = document.createElement("span");
  chip.className = styles.chip;
  chip.contentEditable = "false";
  chip.draggable = path.valid;
  chip.dataset.pathRef = path.refId;
  chip.dataset.pathKind = path.kind;
  chip.dataset.fileType = badge.tone;
  chip.dataset.pathIcon = badge.icon;
  chip.dataset.pathValid = String(path.valid);
  chip.dataset.shape = "control";
  chip.title = path.displayPath;
  chip.addEventListener("dragstart", (event) => {
    if (!path.valid) { event.preventDefault(); return; }
    if (event.dataTransfer) writePathChipTransfer(event.dataTransfer, path);
  });
  const label = document.createElement("span");
  label.textContent = path.name;
  chip.append(pathIconElement(badge.icon), label);
  return chip;
}
