export type ThreadScrollFollowEvent = "release" | "scroll";

export function nextThreadScrollFollow(following: boolean, event: ThreadScrollFollowEvent, atBottom: boolean, movedTowardBottom = false): boolean {
  if (event === "release") return false;
  return following || (atBottom && movedTowardBottom);
}

export function threadAtBottom(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 1;
}

export function threadLatestControl(atBottom: boolean, busy: boolean): "hidden" | "activity" | "latest" {
  if (atBottom) return "hidden";
  return busy ? "activity" : "latest";
}
