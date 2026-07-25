import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { parseSpiceNetlist, type LocalRunArtifact, type LocalRunArtifactKind, type LocalRunLanguage, type LocalRunSnapshot } from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";
import { MATPLOTLIB_INTERACTIVE_BACKEND, MATPLOTLIB_INTERACTIVE_BOOTSTRAP, usesInteractiveMatplotlib } from "./MatplotlibInteractivePython.js";
import { parseSpiceDiagnostics, parseSpiceMeasurements, parseSpiceRawFile } from "./SpiceRawParser.js";
import type { OwnedProcessRegistry } from "./OwnedProcessRegistry.js";

const MAX_ACTIVE = 4;
const MAX_OUTPUT = 1_000_000;
const MAX_ARTIFACTS = 32;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 128 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

interface InternalArtifact extends LocalRunArtifact { path: string }
interface FileSignature { size: number; modified: number }
interface ActiveRun {
  snapshot: LocalRunSnapshot;
  child: ChildProcess;
  directory: string;
  artifacts: InternalArtifact[];
  projectDirectory: string | null;
  projectBaseline: Map<string, FileSignature> | null;
  interactive: InteractiveRun | null;
  timeout?: NodeJS.Timeout;
  finished: boolean;
}

interface PendingExport {
  resolve: (value: { body: Buffer; format: InteractiveExportFormat }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface InteractiveRun {
  token: string;
  input: Writable;
  output: Readable;
  buffer: Buffer;
  pendingExports: Map<string, PendingExport>;
}

export type InteractiveExportFormat = "png" | "svg" | "pdf";
interface LocalRunInteractiveFrame { runId: string; figureId: number; payload: string | Buffer; binary: boolean }
type InteractiveFrameListener = (frame: LocalRunInteractiveFrame) => void;

export class LocalRunService {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly python: string | null;
  private readonly spice: string | null;
  private readonly interactiveListeners = new Set<InteractiveFrameListener>();

  constructor(
    private readonly root: string,
    private readonly workspace: () => string,
    pythonOverride?: string,
    spiceOverride?: string,
    private readonly processes?: OwnedProcessRegistry,
  ) {
    this.python = pythonOverride || locatePython();
    this.spice = spiceOverride || locateSpice();
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  start(code: string, workingDirectory: "isolated" | "project" = "isolated", language: LocalRunLanguage = "python"): LocalRunSnapshot {
    const executable = language === "spice" ? this.spice : this.python;
    if (!executable) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", language === "spice" ? "NGspice is not installed or executable." : "Python 3 is not installed or executable.");
    const active = [...this.runs.values()].filter((run) => run.snapshot.status === "running").length;
    if (active >= MAX_ACTIVE) throw new AppProblem(409, "TASK_BUSY", "Four local code runs are already active.");
    const runId = crypto.randomUUID();
    const directory = path.join(this.root, runId);
    const interactiveRequested = language === "python" && usesInteractiveMatplotlib(code);
    const interactiveToken = interactiveRequested ? crypto.randomBytes(32).toString("base64url") : null;
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
    const mainFile = path.join(directory, language === "spice" ? "main.cir" : "main.py");
    fs.writeFileSync(mainFile, language === "spice" ? prepareSpiceSource(code, path.join(directory, "result.raw")) : code, { mode: 0o600 });
    if (language === "python") {
      fs.writeFileSync(path.join(directory, "bootstrap.py"), interactiveRequested ? MATPLOTLIB_INTERACTIVE_BOOTSTRAP : PYTHON_BOOTSTRAP, { mode: 0o600 });
      if (interactiveRequested) fs.writeFileSync(path.join(directory, "grok_interactive_backend.py"), MATPLOTLIB_INTERACTIVE_BACKEND, { mode: 0o600 });
    }
    const projectDirectory = workingDirectory === "project" ? canonicalDirectory(this.workspace()) : null;
    const projectBaseline = projectDirectory ? snapshotArtifacts(projectDirectory) : null;
    const executionDirectory = projectDirectory || directory;
    const isolatedProcessGroup = process.platform !== "win32";
    const child = spawn(executable, language === "spice"
      ? ["-n", "-b", "-o", path.join(directory, "result.internal"), mainFile]
      : ["-I", path.join(directory, "bootstrap.py")], {
      cwd: executionDirectory,
      env: safeEnvironment(directory, this.workspace(), executionDirectory, mainFile, interactiveRequested, language === "spice"),
      shell: false,
      windowsHide: true,
      detached: isolatedProcessGroup,
      stdio: interactiveRequested ? ["pipe", "pipe", "pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    });
    if (this.processes) {
      try {
        this.processes.register({
          ownerKind: "run",
          ownerId: runId,
          child,
          isolatedProcessGroup,
        });
      } catch (error) {
        child.once("error", () => undefined);
        try {
          if (isolatedProcessGroup && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch { /* The child may already have exited. */ }
        throw error;
      }
    }
    const snapshot: LocalRunSnapshot = {
      runId, language, workingDirectory, status: "running", startedAt: new Date().toISOString(), completedAt: null,
      exitCode: null, durationMs: null, stdout: "", stderr: "", truncated: false, artifacts: [],
      interactive: interactiveToken ? {
        kind: "matplotlib", status: "starting", path: `/local-runs/${runId}/interactive?token=${interactiveToken}`,
        figureIds: [], animatedFigureIds: [], animated: false,
      } : null,
      spice: language === "spice" ? {
        simulator: "NGspice",
        netlist: parseSpiceNetlist(code),
        plots: [],
        measurements: [],
        diagnostics: [],
      } : null,
    };
    const interactive = interactiveRequested ? {
      token: interactiveToken!, input: child.stdio[3] as Writable, output: child.stdio[4] as Readable,
      buffer: Buffer.alloc(0), pendingExports: new Map<string, PendingExport>(),
    } : null;
    const run: ActiveRun = { snapshot, child, directory, artifacts: [], projectDirectory, projectBaseline, interactive, finished: false };
    run.timeout = setTimeout(() => {
      if (run.snapshot.status !== "running") return;
      run.snapshot.status = "timedOut";
      this.requestStop(run);
    }, TIMEOUT_MS);
    run.timeout.unref();
    this.runs.set(runId, run);
    child.stdout?.on("data", (chunk: Buffer) => this.append(run, "stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.append(run, "stderr", chunk));
    interactive?.output.on("data", (chunk: Buffer) => this.readInteractiveFrames(run, chunk));
    child.once("error", (error) => {
      this.append(run, "stderr", Buffer.from(error.message));
      run.snapshot.status = "failed";
      this.finish(run, null);
    });
    child.once("exit", (exitCode) => {
      if (run.finished) return;
      if (run.snapshot.status === "running") run.snapshot.status = exitCode === 0 ? "completed" : "failed";
      this.finish(run, exitCode);
    });
    child.stdin?.end();
    return clone(run.snapshot);
  }

  get(runId: string): LocalRunSnapshot {
    const run = this.require(runId);
    return clone(run.snapshot);
  }

  cancel(runId: string): LocalRunSnapshot {
    const run = this.require(runId);
    if (run.snapshot.status === "running") {
      run.snapshot.status = "cancelled";
      this.requestStop(run);
    }
    return clone(run.snapshot);
  }

  artifact(runId: string, artifactId: string): InternalArtifact {
    const artifact = this.require(runId).artifacts.find((item) => item.artifactId === artifactId);
    if (!artifact) throw new AppProblem(404, "NOT_FOUND", "Run artifact not found.");
    return artifact;
  }

  onInteractiveFrame(listener: InteractiveFrameListener): () => void {
    this.interactiveListeners.add(listener);
    return () => this.interactiveListeners.delete(listener);
  }

  authorizeInteractive(runId: string, token: string, figureId?: number): LocalRunSnapshot {
    const run = this.requireInteractive(runId, token);
    if (figureId !== undefined && !run.snapshot.interactive?.figureIds.includes(figureId)) {
      throw new AppProblem(404, "NOT_FOUND", "Interactive figure not found.");
    }
    return clone(run.snapshot);
  }

  interactiveJavaScript(runId: string, token: string): string {
    const run = this.requireInteractive(runId, token);
    const file = path.join(run.directory, "web", "mpl.js");
    if (!fs.existsSync(file)) throw new AppProblem(409, "TASK_BUSY", "Interactive preview is still starting.");
    return file;
  }

  attachInteractive(runId: string, token: string, figureId: number): void {
    const run = this.requireInteractive(runId, token, figureId);
    this.sendInteractiveCommand(run, { kind: "attach", figureId });
  }

  detachInteractive(runId: string, token: string, figureId: number): void {
    const run = this.requireInteractive(runId, token, figureId);
    this.sendInteractiveCommand(run, { kind: "detach", figureId });
  }

  interactiveEvent(runId: string, token: string, figureId: number, event: unknown): void {
    const run = this.requireInteractive(runId, token, figureId);
    this.sendInteractiveCommand(run, { kind: "event", figureId, event });
  }

  exportInteractiveFigure(runId: string, token: string, figureId: number, format: InteractiveExportFormat): Promise<{ body: Buffer; format: InteractiveExportFormat }> {
    const run = this.requireInteractive(runId, token, figureId);
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        run.interactive?.pendingExports.delete(requestId);
        reject(new AppProblem(504, "TASK_BUSY", "Interactive export timed out."));
      }, 15_000);
      timeout.unref();
      run.interactive!.pendingExports.set(requestId, { resolve, reject, timeout });
      this.sendInteractiveCommand(run, { kind: "export", requestId, figureId, format });
    });
  }

  stop(): void {
    for (const run of this.runs.values()) {
      if (run.snapshot.status !== "running") continue;
      run.snapshot.status = "cancelled";
      this.requestStop(run);
    }
  }

  private require(runId: string): ActiveRun {
    const run = this.runs.get(runId);
    if (!run) throw new AppProblem(404, "NOT_FOUND", "Local code run not found.");
    return run;
  }

  private requireInteractive(runId: string, token: string, figureId?: number): ActiveRun {
    const run = this.require(runId);
    const interactive = run.interactive;
    if (!interactive || !secureEqual(interactive.token, token)) throw new AppProblem(404, "NOT_FOUND", "Interactive run not found.");
    if (figureId !== undefined && !run.snapshot.interactive?.figureIds.includes(figureId)) throw new AppProblem(404, "NOT_FOUND", "Interactive figure not found.");
    return run;
  }

  private sendInteractiveCommand(run: ActiveRun, value: unknown): void {
    if (!run.interactive || run.interactive.input.destroyed) throw new AppProblem(409, "TASK_BUSY", "Interactive session has ended.");
    run.interactive.input.write(`${JSON.stringify(value)}\n`);
  }

  private readInteractiveFrames(run: ActiveRun, chunk: Buffer): void {
    const interactive = run.interactive;
    if (!interactive || run.finished) return;
    interactive.buffer = interactive.buffer.length ? Buffer.concat([interactive.buffer, chunk]) : chunk;
    while (interactive.buffer.length >= 8) {
      const headerLength = interactive.buffer.readUInt32BE(0);
      const bodyLength = interactive.buffer.readUInt32BE(4);
      if (headerLength > 1_000_000 || bodyLength > MAX_ARTIFACT_BYTES) {
        this.append(run, "stderr", Buffer.from("Interactive protocol frame exceeded its limit.\n"));
        run.snapshot.status = "failed";
        this.requestStop(run);
        return;
      }
      const frameLength = 8 + headerLength + bodyLength;
      if (interactive.buffer.length < frameLength) return;
      const headerBytes = interactive.buffer.subarray(8, 8 + headerLength);
      const body = interactive.buffer.subarray(8 + headerLength, frameLength);
      interactive.buffer = interactive.buffer.subarray(frameLength);
      try {
        const header = JSON.parse(headerBytes.toString("utf8")) as Record<string, unknown>;
        this.handleInteractiveFrame(run, header, body);
      } catch (error) {
        this.append(run, "stderr", Buffer.from(`Interactive protocol error: ${error instanceof Error ? error.message : String(error)}\n`));
      }
    }
  }

  private handleInteractiveFrame(run: ActiveRun, header: Record<string, unknown>, body: Buffer): void {
    const kind = header.kind;
    if (kind === "ready") {
      const figureIds = integerList(header.figureIds);
      const animatedFigureIds = new Set(integerList(header.animatedFigureIds));
      if (!figureIds.length) {
        run.snapshot.interactive = null;
        return;
      }
      if (run.snapshot.interactive) {
        run.snapshot.interactive = {
          ...run.snapshot.interactive,
          status: "ready",
          figureIds,
          animatedFigureIds: [...animatedFigureIds],
          animated: figureIds.some((figureId) => animatedFigureIds.has(figureId)),
        };
      }
      if (run.timeout) { clearTimeout(run.timeout); delete run.timeout; }
      return;
    }
    if (kind === "figure-json") {
      const figureId = positiveInteger(header.figureId);
      if (!figureId) return;
      const payload = JSON.stringify(header.payload ?? {});
      for (const listener of this.interactiveListeners) listener({ runId: run.snapshot.runId, figureId, payload, binary: false });
      return;
    }
    if (kind === "figure-binary") {
      const figureId = positiveInteger(header.figureId);
      if (!figureId) return;
      for (const listener of this.interactiveListeners) listener({ runId: run.snapshot.runId, figureId, payload: body, binary: true });
      return;
    }
    if (kind === "export" || kind === "export-error") {
      const requestId = typeof header.requestId === "string" ? header.requestId : "";
      const pending = run.interactive?.pendingExports.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      run.interactive!.pendingExports.delete(requestId);
      if (kind === "export-error") {
        pending.reject(new Error(typeof header.message === "string" ? header.message : "Interactive export failed."));
        return;
      }
      const format = header.format === "svg" || header.format === "pdf" ? header.format : "png";
      pending.resolve({ body, format });
    }
  }

  private append(run: ActiveRun, stream: "stdout" | "stderr", chunk: Buffer): void {
    const remaining = MAX_OUTPUT - run.snapshot.stdout.length - run.snapshot.stderr.length;
    if (remaining <= 0) { run.snapshot.truncated = true; return; }
    const text = stripControl(chunk.toString("utf8")).slice(0, remaining);
    run.snapshot[stream] += text;
    if (text.length < chunk.toString("utf8").length) run.snapshot.truncated = true;
  }

  private finish(run: ActiveRun, exitCode: number | null): void {
    if (run.finished) return;
    run.finished = true;
    if (run.timeout) clearTimeout(run.timeout);
    run.snapshot.exitCode = exitCode;
    run.snapshot.completedAt = new Date().toISOString();
    run.snapshot.durationMs = Math.max(0, Date.parse(run.snapshot.completedAt) - Date.parse(run.snapshot.startedAt));
    run.snapshot.interactive = null;
    if (run.interactive) {
      for (const pending of run.interactive.pendingExports.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Interactive session ended."));
      }
      run.interactive.pendingExports.clear();
      run.interactive.input.destroy();
      run.interactive.output.destroy();
    }
    if (run.snapshot.language === "spice") this.finishSpice(run);
    run.artifacts = mergeArtifacts([
      ...scanArtifacts(run.directory),
      ...(run.projectDirectory && run.projectBaseline ? scanChangedArtifacts(run.projectDirectory, run.projectBaseline) : []),
    ]);
    run.snapshot.artifacts = run.artifacts.map(({ path: _path, ...artifact }) => artifact);
  }

  private finishSpice(run: ActiveRun): void {
    const log = readLimitedText(path.join(run.directory, "result.internal"), MAX_OUTPUT);
    if (log) {
      const combined = stripControl([run.snapshot.stdout.trim(), log.trim()].filter(Boolean).join("\n\n"));
      run.snapshot.stdout = combined.slice(0, MAX_OUTPUT);
      if (combined.length > MAX_OUTPUT) run.snapshot.truncated = true;
    }
    const diagnostics = parseSpiceDiagnostics(`${run.snapshot.stdout}\n${run.snapshot.stderr}`);
    const rawPath = path.join(run.directory, "result.raw");
    let plots = run.snapshot.spice?.plots || [];
    let simulator = run.snapshot.spice?.simulator || "NGspice";
    try {
      const stat = fs.statSync(rawPath);
      if (stat.size > MAX_ARTIFACT_BYTES) {
        diagnostics.push({ severity: "warning", message: "The NGspice RAW result exceeded the inline preview limit.", line: null });
      } else {
        const raw = fs.readFileSync(rawPath, "utf8");
        plots = parseSpiceRawFile(raw);
        const command = /^Command:\s*(ngspice-[^,\s]+)/im.exec(raw);
        if (command) simulator = command[1];
      }
    } catch { /* Diagnostics and the simulator log remain the result when no RAW file was produced. */ }
    if (run.snapshot.spice) {
      run.snapshot.spice = {
        ...run.snapshot.spice,
        simulator,
        plots,
        measurements: parseSpiceMeasurements(run.snapshot.stdout),
        diagnostics: [...run.snapshot.spice.netlist.diagnostics, ...diagnostics],
      };
    }
    if (run.snapshot.status === "completed" && !plots.length && diagnostics.some((item) => item.severity === "error")) run.snapshot.status = "failed";
  }

  private requestStop(run: ActiveRun): void {
    if (run.interactive && !run.interactive.input.destroyed) {
      try { this.sendInteractiveCommand(run, { kind: "stop" }); } catch { /* Process exit remains the final cleanup path. */ }
      const force = setTimeout(() => { if (!run.finished) this.kill(run); }, 900);
      force.unref();
      return;
    }
    this.kill(run);
  }

  private kill(run: ActiveRun): void {
    try {
      if (process.platform === "win32") run.child.kill("SIGTERM");
      else process.kill(-run.child.pid!, "SIGTERM");
    } catch { run.child.kill("SIGTERM"); }
  }
}

function locatePython(): string | null {
  const candidates = [
    process.env.GROK_GUI_PYTHON,
    "/opt/homebrew/bin/python3",
    "/opt/homebrew/opt/python@3.13/libexec/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* keep looking */ }
  }
  return null;
}

function locateSpice(): string | null {
  const candidates = [
    process.env.GROK_GUI_NGSPICE,
    "/opt/homebrew/bin/ngspice",
    "/usr/local/bin/ngspice",
    "/usr/bin/ngspice",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* keep looking */ }
  }
  return null;
}

function prepareSpiceSource(source: string, rawPath: string): string {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
  const blocks: Array<{ start: number; end: number }> = [];
  let start = -1;
  lines.forEach((line, index) => {
    if (/^\s*\.control\b/i.test(line)) start = index;
    else if (start >= 0 && /^\s*\.endc\b/i.test(line)) { blocks.push({ start, end: index }); start = -1; }
  });
  const exportCommands = (needsRun: boolean) => [
    "set filetype=ascii",
    `set grok_rawfile = "${rawPath.replace(/"/g, "")}"`,
    ...(needsRun ? ["run"] : []),
    "unset appendwrite",
    "foreach grok_plot $plots",
    "  setplot $grok_plot",
    "  write $grok_rawfile all",
    "  set appendwrite",
    "end",
  ];
  const block = blocks.at(-1);
  if (block) {
    const body = lines.slice(block.start + 1, block.end);
    const hasRun = body.some((line) => /^\s*(?:run|resume|op|tran|ac|dc|noise|tf|pz|sens)\b/i.test(line));
    const exitOffset = body.findIndex((line) => /^\s*(?:quit|destroy)\b/i.test(line));
    const insert = block.start + 1 + (exitOffset < 0 ? body.length : exitOffset);
    lines.splice(insert, 0, ...exportCommands(!hasRun));
    return `${lines.join("\n")}\n`;
  }
  const end = lines.findIndex((line) => /^\s*\.end\s*(?:[$;].*)?$/i.test(line));
  const insert = end < 0 ? lines.length : end;
  lines.splice(insert, 0, ".control", ...exportCommands(true), "quit", ".endc");
  if (end < 0) lines.push(".end");
  return `${lines.join("\n")}\n`;
}

function safeEnvironment(runDirectory: string, workspace: string, executionDirectory: string, mainFile: string, interactive = false, spice = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|AUTH)/i.test(key)) continue;
    if (["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"].includes(key) && value) env[key] = value;
  }
  return {
    ...env,
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    MPLBACKEND: interactive ? "module://grok_interactive_backend" : "Agg",
    GROK_RUN_DIR: runDirectory,
    GROK_PROJECT_DIR: workspace,
    GROK_EXECUTION_DIR: executionDirectory,
    GROK_MAIN_FILE: mainFile,
    ...(spice ? { SPICE_ASCIIRAWFILE: "1" } : {}),
    ...(interactive ? { GROK_INTERACTIVE_INPUT_FD: "3", GROK_INTERACTIVE_OUTPUT_FD: "4" } : {}),
  };
}

function readLimitedText(file: string, limit: number): string {
  try {
    const handle = fs.openSync(file, "r");
    try {
      const stat = fs.fstatSync(handle);
      const length = Math.min(stat.size, limit);
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, 0);
      return buffer.toString("utf8");
    } finally { fs.closeSync(handle); }
  } catch { return ""; }
}

function scanArtifacts(directory: string): InternalArtifact[] {
  return supportedFiles(directory).map((file) => ({
    artifactId: crypto.randomUUID(), name: path.relative(directory, file.path).slice(0, 240),
    size: file.size, path: file.path, kind: file.kind, mimeType: file.mimeType,
  }));
}

function snapshotArtifacts(directory: string): Map<string, FileSignature> {
  return new Map(supportedFiles(directory).map((file) => [file.path, { size: file.size, modified: file.modified }]));
}

function scanChangedArtifacts(directory: string, baseline: Map<string, FileSignature>): InternalArtifact[] {
  return supportedFiles(directory).flatMap((file) => {
    const before = baseline.get(file.path);
    if (before && before.size === file.size && before.modified === file.modified) return [];
    return [{ artifactId: crypto.randomUUID(), name: path.relative(directory, file.path).slice(0, 240), size: file.size, path: file.path, kind: file.kind, mimeType: file.mimeType }];
  });
}

function supportedFiles(directory: string): Array<{ path: string; size: number; modified: number; kind: LocalRunArtifactKind; mimeType: string }> {
  const files: Array<{ path: string; size: number; modified: number; kind: LocalRunArtifactKind; mimeType: string }> = [];
  let visited = 0;
  const visit = (current: string, depth: number) => {
    if (depth > 2 || visited >= 10_000) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      visited += 1;
      if (visited >= 10_000) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !["node_modules", "dist", "build"].includes(entry.name)) visit(absolute, depth + 1);
        continue;
      }
      const descriptor = entry.isFile() ? describeArtifact(entry.name) : null;
      if (!descriptor) continue;
      const stat = fs.statSync(absolute);
      files.push({ path: absolute, size: stat.size, modified: stat.mtimeMs, ...descriptor });
    }
  };
  visit(directory, 0);
  return files;
}

function mergeArtifacts(artifacts: InternalArtifact[]): InternalArtifact[] {
  const result: InternalArtifact[] = []; const paths = new Set<string>(); let total = 0;
  for (const artifact of artifacts) {
    if (result.length >= MAX_ARTIFACTS || paths.has(artifact.path) || artifact.size > MAX_ARTIFACT_BYTES || total + artifact.size > MAX_TOTAL_ARTIFACT_BYTES) continue;
    paths.add(artifact.path); total += artifact.size; result.push(artifact);
  }
  return result;
}

function canonicalDirectory(directory: string): string {
  try {
    const canonical = fs.realpathSync.native(directory);
    if (!fs.statSync(canonical).isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch { throw new AppProblem(409, "PATH_REJECTED", "The active Project directory is unavailable."); }
}

function describeArtifact(name: string): { kind: LocalRunArtifactKind; mimeType: string } | null {
  const extension = path.extname(name).toLowerCase();
  const values: Record<string, { kind: LocalRunArtifactKind; mimeType: string }> = {
    ".png": { kind: "image", mimeType: "image/png" }, ".jpg": { kind: "image", mimeType: "image/jpeg" },
    ".jpeg": { kind: "image", mimeType: "image/jpeg" }, ".webp": { kind: "image", mimeType: "image/webp" },
    ".gif": { kind: "image", mimeType: "image/gif" }, ".avif": { kind: "image", mimeType: "image/avif" },
    ".svg": { kind: "svg", mimeType: "image/svg+xml" },
    ".mp3": { kind: "audio", mimeType: "audio/mpeg" }, ".wav": { kind: "audio", mimeType: "audio/wav" },
    ".m4a": { kind: "audio", mimeType: "audio/mp4" }, ".aac": { kind: "audio", mimeType: "audio/aac" },
    ".flac": { kind: "audio", mimeType: "audio/flac" }, ".ogg": { kind: "audio", mimeType: "audio/ogg" },
    ".mp4": { kind: "video", mimeType: "video/mp4" }, ".m4v": { kind: "video", mimeType: "video/mp4" },
    ".mov": { kind: "video", mimeType: "video/quicktime" }, ".webm": { kind: "video", mimeType: "video/webm" },
    ".glb": { kind: "model3d", mimeType: "model/gltf-binary" }, ".gltf": { kind: "model3d", mimeType: "model/gltf+json" },
    ".obj": { kind: "model3d", mimeType: "model/obj" }, ".stl": { kind: "model3d", mimeType: "model/stl" },
    ".ply": { kind: "model3d", mimeType: "application/octet-stream" }, ".usdz": { kind: "model3d", mimeType: "model/vnd.usdz+zip" },
    ".html": { kind: "html", mimeType: "text/html" }, ".htm": { kind: "html", mimeType: "text/html" },
    ".pdf": { kind: "pdf", mimeType: "application/pdf" }, ".json": { kind: "json", mimeType: "application/json" },
    ".csv": { kind: "csv", mimeType: "text/csv" }, ".tsv": { kind: "csv", mimeType: "text/tab-separated-values" },
    ".txt": { kind: "text", mimeType: "text/plain" }, ".log": { kind: "text", mimeType: "text/plain" },
  };
  return values[extension] || null;
}

function stripControl(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function integerList(value: unknown): number[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const parsed = positiveInteger(item);
    return parsed === null ? [] : [parsed];
  }) : [];
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clone(snapshot: LocalRunSnapshot): LocalRunSnapshot {
  return {
    ...snapshot,
    artifacts: snapshot.artifacts.map((artifact) => ({ ...artifact })),
    interactive: snapshot.interactive ? {
      ...snapshot.interactive,
      figureIds: [...snapshot.interactive.figureIds],
      animatedFigureIds: [...snapshot.interactive.animatedFigureIds],
    } : null,
    spice: snapshot.spice ? {
      ...snapshot.spice,
      netlist: {
        ...snapshot.spice.netlist,
        components: snapshot.spice.netlist.components.map((component) => ({ ...component, nodes: [...component.nodes] })),
        nodes: [...snapshot.spice.netlist.nodes],
        analyses: snapshot.spice.netlist.analyses.map((analysis) => ({ ...analysis })),
        models: [...snapshot.spice.netlist.models],
        subcircuits: [...snapshot.spice.netlist.subcircuits],
        diagnostics: snapshot.spice.netlist.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      },
      plots: snapshot.spice.plots.map((plot) => ({
        ...plot,
        scale: cloneSpiceVector(plot.scale),
        traces: plot.traces.map(cloneSpiceVector),
      })),
      measurements: snapshot.spice.measurements.map((measurement) => ({ ...measurement })),
      diagnostics: snapshot.spice.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    } : null,
  };
}

function cloneSpiceVector<T extends { real: number[]; imaginary: number[] | null }>(value: T): T {
  return { ...value, real: [...value.real], imaginary: value.imaginary ? [...value.imaginary] : null };
}

const PYTHON_BOOTSTRAP = `import os, runpy, traceback
os.chdir(os.environ["GROK_EXECUTION_DIR"])
try:
    runpy.run_path(os.environ["GROK_MAIN_FILE"], run_name="__main__")
except SystemExit:
    raise
except BaseException:
    traceback.print_exc()
    raise
finally:
    try:
        import sys
        if "matplotlib.pyplot" in sys.modules:
            import matplotlib.pyplot as plt
            for index, number in enumerate(plt.get_fignums(), 1):
                plt.figure(number).savefig(f"figure-{index}.png", dpi=160, bbox_inches="tight")
    except Exception:
        traceback.print_exc()
`;
