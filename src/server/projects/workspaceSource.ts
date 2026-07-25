export type WorkspaceSource = string | (() => string);

export function currentWorkspace(source: WorkspaceSource): string {
  return typeof source === "function" ? source() : source;
}
