export function restorableRoute(pathname: string): string | null {
  if (pathname === "/new") return pathname;
  if (/^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname)) return pathname;
  return /^\/settings(?:\/[a-z0-9_-]+){0,2}$/i.test(pathname) ? pathname : null;
}

export function restoredInitialRoute(pathname: string, savedRoute: string, taskIds: string[]): string {
  const candidate = pathname === "/" ? savedRoute : pathname;
  const route = restorableRoute(candidate);
  const savedTaskId = taskIdFromRoute(candidate);
  return route && (!savedTaskId || taskIds.includes(savedTaskId)) ? route : "/new";
}

function taskIdFromRoute(pathname: string): string | null {
  return restorableRoute(pathname)?.startsWith("/tasks/") ? pathname.slice("/tasks/".length) : null;
}
