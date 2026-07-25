import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resolves accepted local-address syntax against one explicit Project root. */
export function resolveLocalPathCandidate(value: string, projectPath: string): string {
  let candidate = value.trim().replace(/^<|>$/g, "").replace(/\\([() ])/g, "$1");
  if (candidate.startsWith("file:")) candidate = fileURLToPath(new URL(candidate));
  else if (candidate === "~") candidate = os.homedir();
  else if (candidate.startsWith("~/")) candidate = path.resolve(os.homedir(), candidate.slice(2));
  else if (!path.isAbsolute(candidate)) candidate = path.resolve(projectPath, candidate);
  return candidate;
}
