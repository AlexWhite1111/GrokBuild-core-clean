import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { BrowserWindow } from "electron";
import * as pty from "node-pty";
import type { TerminalRunRequest } from "../shared/contracts.js";

interface TerminalSession {
  process: pty.IPty;
  dataSubscription: pty.IDisposable;
  exitSubscription: pty.IDisposable;
  temporaryDirectory: string | null;
  ready: boolean;
  readyAfter: number;
  readyTimer: NodeJS.Timeout | null;
  pendingWrites: string[];
}

export class TerminalSessionManager {
  readonly #sessions = new Map<string, TerminalSession>();

  start(sessionId: string, directory: string, options: { columns: number; rows: number; run?: TerminalRunRequest }, window: BrowserWindow): { sessionId: string } {
    this.stop(sessionId);
    ensurePtyHelperExecutable();
    const prepared = options.run ? prepareRun(options.run) : null;
    let process: pty.IPty;
    try {
      process = pty.spawn("/bin/zsh", ["-l"], {
        name: "xterm-256color",
        cols: options.columns,
        rows: options.rows,
        cwd: directory,
        env: terminalEnvironment(options.columns, options.rows),
      });
    } catch (error) {
      removeTemporaryDirectory(prepared?.directory || null);
      throw error;
    }
    const session: TerminalSession = {
      process,
      dataSubscription: null as unknown as pty.IDisposable,
      exitSubscription: null as unknown as pty.IDisposable,
      temporaryDirectory: prepared?.directory || null,
      ready: false,
      readyAfter: Date.now() + 300,
      readyTimer: null,
      pendingWrites: prepared ? [`${prepared.command}\r`] : [],
    };
    session.dataSubscription = process.onData((data) => {
      send(window, "grok-shell:terminal-data", { sessionId, data });
      scheduleReady(sessionId, session, this.#sessions);
    });
    session.exitSubscription = process.onExit(({ exitCode, signal }) => {
      if (this.#sessions.get(sessionId) !== session) return;
      this.#sessions.delete(sessionId);
      if (session.readyTimer) clearTimeout(session.readyTimer);
      session.dataSubscription.dispose();
      session.exitSubscription.dispose();
      removeTemporaryDirectory(session.temporaryDirectory);
      send(window, "grok-shell:terminal-exit", { sessionId, code: exitCode, signal: signal === undefined ? null : String(signal), error: null });
    });
    this.#sessions.set(sessionId, session);
    scheduleReady(sessionId, session, this.#sessions);
    return { sessionId };
  }

  write(sessionId: string, data: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error("Terminal session is unavailable.");
    if (session.ready) session.process.write(data);
    else session.pendingWrites.push(data);
  }

  resize(sessionId: string, columns: number, rows: number): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.process.resize(columns, rows);
  }

  stop(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#sessions.delete(sessionId);
    terminate(session);
  }

  dispose(): void {
    for (const session of this.#sessions.values()) terminate(session);
    this.#sessions.clear();
  }
}

function send(window: BrowserWindow, channel: string, value: unknown): void {
  if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, value);
}

function terminate(session: TerminalSession): void {
  if (session.readyTimer) clearTimeout(session.readyTimer);
  session.dataSubscription.dispose();
  session.exitSubscription.dispose();
  removeTemporaryDirectory(session.temporaryDirectory);
  try { session.process.kill(); } catch { /* The PTY may already have exited. */ }
}

function scheduleReady(sessionId: string, session: TerminalSession, sessions: Map<string, TerminalSession>): void {
  if (session.ready) return;
  if (session.readyTimer) clearTimeout(session.readyTimer);
  session.readyTimer = setTimeout(() => {
    session.readyTimer = null;
    if (sessions.get(sessionId) !== session) return;
    session.ready = true;
    for (const data of session.pendingWrites.splice(0)) session.process.write(data);
  }, Math.max(50, session.readyAfter - Date.now()));
}

function terminalEnvironment(columns: number, rows: number, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) if (value !== undefined) environment[key] = value;
  delete environment.NO_COLOR;
  delete environment.NODE_DISABLE_COLORS;
  environment.TERM = "xterm-256color";
  environment.COLORTERM = "truecolor";
  environment.CLICOLOR = "1";
  environment.COLUMNS = String(columns);
  environment.LINES = String(rows);
  return environment;
}

function ensurePtyHelperExecutable(): void {
  if (process.platform === "win32") return;
  const entry = createRequire(import.meta.url).resolve("node-pty");
  const packageRoot = path.resolve(path.dirname(entry), "..");
  const source = path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  const helper = source.replace("app.asar", "app.asar.unpacked").replace("node_modules.asar", "node_modules.asar.unpacked");
  const mode = fs.statSync(helper).mode & 0o777;
  if ((mode & 0o111) === 0) fs.chmodSync(helper, mode | 0o111);
}

function prepareRun(run: TerminalRunRequest): { directory: string; command: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-terminal-"));
  const scriptPath = path.join(directory, "run.sh");
  fs.writeFileSync(scriptPath, run.code.endsWith("\n") ? run.code : `${run.code}\n`, { encoding: "utf8", mode: 0o600 });
  const executable = run.shell === "bash" ? "/bin/bash" : run.shell === "sh" ? "/bin/sh" : "/bin/zsh";
  const script = quoteShell(scriptPath);
  const temporary = quoteShell(directory);
  return {
    directory,
    command: `${executable} ${script}; __grok_status=$?; /bin/rm -rf ${temporary}; printf '\\n[process exited %s]\\n' "$__grok_status"`,
  };
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function removeTemporaryDirectory(directory: string | null): void {
  if (!directory) return;
  try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* Best-effort cleanup after process exit. */ }
}
