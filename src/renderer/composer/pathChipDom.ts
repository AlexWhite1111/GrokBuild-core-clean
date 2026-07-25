export const PATH_CARET_ANCHOR = "\uFEFF";

export function insertPathChips(range: Range, chips: HTMLElement[]): Range {
  range.deleteContents();
  const marker = document.createTextNode("");
  range.insertNode(marker);
  const fragment = document.createDocumentFragment();
  let trailing: Text | null = null;

  for (const chip of chips) {
    trailing = document.createTextNode(PATH_CARET_ANCHOR);
    fragment.append(chip, trailing);
  }
  marker.before(fragment);
  marker.remove();

  const next = document.createRange();
  if (trailing) next.setStart(trailing, trailing.length);
  else next.setStart(range.startContainer, range.startOffset);
  next.collapse(true);
  return next;
}

export function removePathChip(chip: HTMLElement): void {
  const anchor = chip.nextSibling;
  if (anchor instanceof Text && anchor.data.includes(PATH_CARET_ANCHOR)) {
    anchor.data = anchor.data.replace(PATH_CARET_ANCHOR, "");
    if (!anchor.data) anchor.remove();
  }
  chip.remove();
}

export function visibleCaretText(value: string): string {
  return value.replaceAll(PATH_CARET_ANCHOR, "");
}
