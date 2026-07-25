import type { TaskRow } from "./TaskStore.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

export async function exportTaskTranscript(row: TaskRow, projectPath: string, grokBin: string, grokHome: string, processes?: OwnedProcessRegistry): Promise<{ fileName: string; markdown: string }> {
  if (!row.session_id) throw new Error("Task has no Grok session to export.");
  const result = await new GrokRunner(grokBin, processes).run(["export", row.session_id], { cwd: projectPath, timeoutMs: 60_000, maxOutputBytes: 10_000_000, env: { GROK_HOME: grokHome }, processOwner: { kind: "task", id: row.task_id } });
  if (result.code !== 0 || result.truncated) throw new Error(result.truncated ? "Session export exceeded 10 MB." : "Official Grok session export failed.");
  return { fileName: `${safeFileName(row.title)}.md`, markdown: result.stdout };
}

export async function deleteTaskSession(row: TaskRow, projectPath: string, grokBin: string, grokHome: string, processes?: OwnedProcessRegistry): Promise<void> {
  if (row.session_id) {
    const result = await new GrokRunner(grokBin, processes).run(["sessions", "delete", row.session_id], { cwd: projectPath, timeoutMs: 30_000, maxOutputBytes: 100_000, env: { GROK_HOME: grokHome }, processOwner: { kind: "task", id: row.task_id } });
    if (result.code !== 0) throw new Error("Official Grok session deletion failed; the app index was left unchanged.");
  }
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "Grok Build Task";
}
