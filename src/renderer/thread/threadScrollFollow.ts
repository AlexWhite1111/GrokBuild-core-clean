export type ThreadScrollFollowEvent = "release" | "settle";

export function nextThreadScrollFollow(following: boolean, event: ThreadScrollFollowEvent, atBottom: boolean): boolean {
  return event === "release" ? false : atBottom || following;
}

export function threadAtBottom(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
}

export function threadLatestControl(atBottom: boolean, busy: boolean): "hidden" | "activity" | "latest" {
  if (atBottom) return "hidden";
  return busy ? "activity" : "latest";
}
