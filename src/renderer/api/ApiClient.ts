import type { ApiProblem, RendererBootstrap } from "../../shared/contracts.js";

class ApiError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.detail);
    this.name = "ApiError";
  }
}

export class ApiClient {
  constructor(readonly bootstrap: RendererBootstrap) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  }

  async blob(path: string): Promise<Blob> {
    return (await this.requestRaw(path, { method: "GET" })).blob();
  }

  async text(path: string): Promise<string> {
    return (await this.requestRaw(path, { method: "GET" })).text();
  }

  mediaUrl(ticket: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("Invalid media ticket.");
    return `${new URL(this.bootstrap.apiBaseUrl).origin}/media/${ticket}`;
  }

  openEvents(onMessage: (value: unknown) => void, onOpen?: () => void): () => void {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let retry = 0;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(this.bootstrap.websocketUrl, ["grok-build-v1", this.bootstrap.websocketProtocol]);
      socket.addEventListener("open", () => { retry = 0; onOpen?.(); });
      socket.addEventListener("message", (event) => {
        try { onMessage(JSON.parse(String(event.data)) as unknown); }
        catch { /* A fresh snapshot after reconnect recovers invalid push data. */ }
      });
      socket.addEventListener("close", () => {
        socket = null;
        if (disposed) return;
        const delay = Math.min(8_000, 350 * 2 ** Math.min(retry, 5));
        retry += 1;
        retryTimer = globalThis.setTimeout(connect, delay);
      });
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) globalThis.clearTimeout(retryTimer);
      socket?.close(1000, "renderer disposed");
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.requestRaw(path, init);
    return response.json() as Promise<T>;
  }

  private async requestRaw(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.bootstrap.apiBaseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...init.headers,
        "X-Grok-Build-Launch-Token": this.bootstrap.launchToken,
      },
    });
    if (!response.ok) {
      let problem: ApiProblem;
      try { problem = await response.json() as ApiProblem; }
      catch {
        problem = {
          type: "grok-build:internal_error",
          title: "Request failed",
          status: response.status,
          code: "INTERNAL_ERROR",
          detail: `The local service returned HTTP ${response.status}.`,
        };
      }
      throw new ApiError(problem);
    }
    return response;
  }
}

export async function desktopBootstrap(): Promise<RendererBootstrap> {
  if (window.grokDesktop) return window.grokDesktop.getBootstrap();
  const origin = window.location.origin;
  const isLanShare = !/^(?:127\.0\.0\.1|localhost)$/.test(window.location.hostname);
  if (isLanShare) {
    return {
      apiBaseUrl: `${origin}/api/v1`,
      websocketUrl: `${origin.replace(/^http/, "ws")}/api/v1/events`,
      launchToken: "lan-open",
      websocketProtocol: "grok-build.lan.open",
      platform: "darwin",
      appVersion: "LAN",
      packaged: true,
      workspace: "/",
    };
  }
  return {
    apiBaseUrl: `${origin}/api/v1`,
    websocketUrl: `${origin.replace(/^http/, "ws")}/api/v1/events`,
    launchToken: "development-only-token",
    websocketProtocol: "grok-build.auth.development-only-token",
    platform: "darwin",
    appVersion: "development",
    packaged: false,
    workspace: "/",
  };
}
