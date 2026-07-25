export const OPEN_LAN_SHARE_EVENT = "grok-build:open-lan-share";

export function openLanSharePopover(): void {
  window.dispatchEvent(new Event(OPEN_LAN_SHARE_EVENT));
}
