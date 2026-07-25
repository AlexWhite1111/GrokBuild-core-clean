import fs from "node:fs";
import path from "node:path";
import type { SandboxProfile, TaskSnapshot } from "../../shared/contracts.js";

export function applySandboxEvidence(snapshot: TaskSnapshot, grokHome: string, projectPath: string): void {
  if (snapshot.sandbox.requested === "off") {
    snapshot.sandbox.mechanism = "none";
    snapshot.sandbox.verified = true;
    snapshot.sandbox.detail = "Sandbox disabled when the task was created.";
    return;
  }
  const evidence = latestEvidence(grokHome, projectPath, snapshot.sandbox.requested, snapshot.createdAt);
  snapshot.sandbox.mechanism = evidence?.enforced && evidence.platform === "macos/seatbelt" ? "seatbelt" : "none";
  snapshot.sandbox.verified = evidence?.enforced === true;
  snapshot.sandbox.detail = evidence
    ? `${evidence.platform}; profile=${evidence.profile}; enforced=${String(evidence.enforced)}`
    : "No matching ProfileApplied evidence was found; enforcement is unconfirmed.";
}

function latestEvidence(grokHome: string, workspace: string, requested: SandboxProfile, createdAt: string): Evidence | null {
  const file = path.join(grokHome, "sandbox-events.jsonl");
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - 256_000);
    const buffer = Buffer.alloc(stat.size - start);
    const handle = fs.openSync(file, "r");
    try { fs.readSync(handle, buffer, 0, buffer.length, start); } finally { fs.closeSync(handle); }
    const expectedProfile = requested === "readOnly" ? "read-only" : requested;
    const minimum = Date.parse(createdAt) - 2_000;
    return buffer.toString("utf8").split(/\r?\n/).flatMap(parseEvidence).filter((entry) => entry.event_type === "ProfileApplied" && entry.profile === expectedProfile && path.resolve(entry.workspace) === path.resolve(workspace) && Date.parse(entry.timestamp) >= minimum).at(-1) || null;
  } catch { return null; }
}

interface Evidence { timestamp: string; event_type: string; profile: string; workspace: string; platform: string; enforced: boolean }
function parseEvidence(line: string): Evidence[] {
  try {
    const value = JSON.parse(line) as Partial<Evidence>;
    return typeof value.timestamp === "string" && typeof value.profile === "string" && typeof value.workspace === "string" && typeof value.platform === "string" && typeof value.enforced === "boolean" ? [value as Evidence] : [];
  } catch { return []; }
}
