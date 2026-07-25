import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import {
  TextClipAuthoritySnapshotSchema,
  type PathReferenceSummary,
  type RendererBootstrap,
  type TextClipAuthoritySnapshot,
} from "../shared/contracts.js";
import { backendEnvironment } from "./policy.js";

export interface BackendProcessOptions {
  serverEntry: string;
  appHome: string;
  grokHome: string;
  grokHomeId: string;
  grokBin: string;
  workspace: string;
  appVersion: string;
  packaged: boolean;
}

export class BackendProcess extends EventEmitter {
  #child: ChildProcess | null = null;
  #port = 0;
  #launchToken = "";
  #shellToken = "";
  #workspace: string;

  constructor(private readonly options: BackendProcessOptions) {
    super();
    this.#workspace = options.workspace;
  }

  get workspace(): string { return this.#workspace; }
  get port(): number { return this.#port; }
  get appHome(): string { return this.options.appHome; }

  async start(): Promise<void> {
    if (this.#child) return;
    this.#port = await availablePort();
    this.#launchToken = randomBytes(32).toString("base64url");
    this.#shellToken = randomBytes(32).toString("base64url");
    const environment = backendEnvironment(process.env, {
      port: this.#port,
      workspace: this.#workspace,
      appHome: this.options.appHome,
      grokHome: this.options.grokHome,
      grokHomeId: this.options.grokHomeId,
      grokBin: this.options.grokBin,
      launchToken: this.#launchToken,
      shellToken: this.#shellToken,
      appVersion: this.options.appVersion,
    });
    if (this.options.packaged) environment.ESBUILD_BINARY_PATH = packagedEsbuildBinary();
    const child = spawn(backendExecutable(), ["--no-deprecation", this.options.serverEntry], {
      cwd: this.options.appHome,
      env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
      // Electron 43's asar bridge constructs fs.Stats under Node 24 and emits
      // DEP0180 during normal module resolution. Suppress deprecations in this
      // backend runtime; ordinary warnings and errors still reach stderr.
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    child.stdout?.on("data", (chunk) => this.emit("log", "backend", String(chunk).trimEnd()));
    child.stderr?.on("data", (chunk) => this.emit("log", "backend:error", String(chunk).trimEnd()));
    child.on("exit", (code) => {
      if (this.#child === child) this.#child = null;
      this.emit("exit", code);
    });
    try {
      await waitForHealth(this.#port, 25_000);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async restart(workspace: string): Promise<void> {
    this.stop();
    this.#workspace = workspace;
    await this.start();
  }

  stop(): void {
    const child = this.#child;
    this.#child = null;
    if (child) child.kill();
  }

  bootstrap(): RendererBootstrap {
    if (!this.#port || !this.#launchToken) throw new Error("Backend is not ready.");
    return {
      apiBaseUrl: `http://127.0.0.1:${this.#port}/api/v1`,
      websocketUrl: `ws://127.0.0.1:${this.#port}/api/v1/events`,
      launchToken: this.#launchToken,
      websocketProtocol: `grok-build.auth.${this.#launchToken}`,
      platform: process.platform,
      appVersion: this.options.appVersion,
      packaged: this.options.packaged,
      workspace: this.#workspace,
    };
  }

  request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    return this.#request(method, path, this.#launchToken, body);
  }

  async registerProject(directory: string): Promise<void> {
    await this.#request("POST", "/internal/v1/projects/register", this.#shellToken, {
      requestId: crypto.randomUUID(),
      directory,
    });
    this.#workspace = directory;
  }

  async activeProjectPath(): Promise<string> {
    return (await this.#request<{ directory: string }>("GET", "/internal/v1/projects/active-path", this.#shellToken)).directory;
  }

  rememberWorkspace(directory: string): void {
    this.#workspace = directory;
  }

  registerPath(filePath: string, projectId?: string): Promise<PathReferenceSummary> {
    return this.#request("POST", "/internal/v1/paths/register", this.#shellToken, {
      requestId: crypto.randomUUID(),
      path: filePath,
      ...(projectId ? { projectId } : {}),
    });
  }

  async projectPath(projectId?: string): Promise<string> {
    if (!projectId) return this.activeProjectPath();
    return (await this.#request<{ directory: string }>("GET", `/internal/v1/projects/${encodeURIComponent(projectId)}/path`, this.#shellToken)).directory;
  }

  async resolvePath(refId: string): Promise<string> {
    return (await this.#request<{ path: string }>("GET", `/internal/v1/paths/${encodeURIComponent(refId)}`, this.#shellToken)).path;
  }

  async resolveMedia(taskId: string, mediaId: string): Promise<string> {
    const route = `/internal/v1/media/${encodeURIComponent(taskId)}/${encodeURIComponent(mediaId)}/path`;
    return (await this.#request<{ path: string }>("GET", route, this.#shellToken)).path;
  }

  async resolveRunArtifact(runId: string, artifactId: string): Promise<string> {
    const route = `/internal/v1/local-runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/path`;
    return (await this.#request<{ path: string }>("GET", route, this.#shellToken)).path;
  }

  async textClipAuthority(): Promise<TextClipAuthoritySnapshot> {
    const response = await this.#request<unknown>("GET", "/internal/v1/text-clips/authority", this.#shellToken);
    return TextClipAuthoritySnapshotSchema.parse(response);
  }

  #request<T>(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port: this.#port,
        path,
        method,
        headers: {
          Origin: `http://127.0.0.1:${this.#port}`,
          "X-Grok-Build-Launch-Token": token,
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 10_000,
      }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { text += chunk; });
        response.on("end", () => {
          if ((response.statusCode || 500) >= 400) {
            reject(new Error(`Backend request failed (${response.statusCode}): ${text.slice(0, 500)}`));
            return;
          }
          try { resolve(JSON.parse(text) as T); }
          catch (error) { reject(error); }
        });
      });
      request.once("timeout", () => request.destroy(new Error("Backend request timed out")));
      request.once("error", reject);
      if (payload) request.write(payload);
      request.end();
    });
  }
}

function packagedEsbuildBinary(): string {
  const packageName = `${process.platform}-${process.arch}`;
  const executable = process.platform === "win32" ? "esbuild.exe" : "esbuild";
  return path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@esbuild", packageName, "bin", executable);
}

function backendExecutable(): string {
  if (process.platform !== "darwin") return process.execPath;
  const name = path.basename(process.execPath);
  return path.resolve(path.dirname(process.execPath), "..", "Frameworks", `${name} Helper.app`, "Contents", "MacOS", `${name} Helper`);
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for the local service on 127.0.0.1:${port}`);
}

function isHealthy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: "/healthz", timeout: 650 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once("timeout", () => { request.destroy(); resolve(false); });
    request.once("error", () => resolve(false));
  });
}
