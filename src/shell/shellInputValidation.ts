import fs from "node:fs";
import path from "node:path";
import { ProjectIdSchema } from "../shared/contracts.js";

export function validProjectId(value: unknown, label = "project id"): string {
  const parsed = ProjectIdSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${label}.`);
  return parsed.data;
}

export function optionalProjectId(value: unknown, label = "project id"): string | undefined {
  return value == null || value === "" ? undefined : validProjectId(value, label);
}

export function canonicalDroppedDirectories(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 64) throw new Error("A workspace drop requires one or more folders.");
  const directories: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || value.length > 4096 || !path.isAbsolute(value)) throw new Error("Dropped workspace paths must be absolute.");
    let canonical: string;
    try {
      canonical = fs.realpathSync.native(value);
      if (!fs.statSync(canonical).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new Error("Every dropped workspace item must be an existing folder.");
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    directories.push(canonical);
  }
  return directories;
}

export function registrationOrderForFirstActive(directories: readonly string[]): string[] {
  return [...directories].reverse();
}
