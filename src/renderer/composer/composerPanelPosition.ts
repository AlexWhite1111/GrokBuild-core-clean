interface HorizontalRect { left: number; top: number; width: number }
interface PanelSize { width: number; height: number }

export function composerPanelPosition(
  shell: HorizontalRect,
  anchor: HorizontalRect,
  panel: PanelSize,
  gap = 6,
  inset = 8,
): { left: number; top: number } {
  const centered = anchor.left - shell.left + anchor.width / 2 - panel.width / 2;
  const maximum = Math.max(inset, shell.width - panel.width - inset);
  return {
    left: Math.round(Math.max(inset, Math.min(maximum, centered))),
    top: Math.round(anchor.top - shell.top - panel.height - gap),
  };
}
