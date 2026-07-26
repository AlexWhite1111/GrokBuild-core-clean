import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { isExactOrigin, isTokenGatedPreviewOrigin, tokenMatches } from "../security/apiSecurity.js";
import type { LocalRunService } from "../runtime/LocalRunService.js";
import type { TaskSupervisor } from "../tasks/TaskSupervisor.js";
import type { TaskDetailProjection, TaskProjectionFrame } from "../../shared/contracts.js";

export interface TaskSocketOptions {
  expectedOrigin: string;
  launchToken: string;
  supervisor: TaskSupervisor;
  localRuns: LocalRunService;
}

export interface TaskSocketServer {
  closeClients(): void;
  close(): void;
}

const APPLICATION_PROTOCOL = "grok-build-v1";
const AUTH_PREFIX = "grok-build.auth.";

export function attachTaskSocketServer(
  server: http.Server,
  options: TaskSocketOptions,
): TaskSocketServer {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 256_000,
    handleProtocols(protocols) {
      return protocols.has(APPLICATION_PROTOCOL) ? APPLICATION_PROTOCOL : false;
    },
  });
  const interactiveSockets = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  const figureClients = new Map<string, Set<WebSocket>>();
  const removeInteractiveListener = options.localRuns.onInteractiveFrame((frame) => {
    const clients = figureClients.get(figureKey(frame.runId, frame.figureId));
    if (!clients) return;
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame.payload, { binary: frame.binary });
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    const interactive = interactiveSocketPath(url.pathname);
    if (interactive) {
      try {
        const token = url.searchParams.get("token") || "";
        if (!isTokenGatedPreviewOrigin(request.headers.origin, options.expectedOrigin)) throw new Error("origin");
        options.localRuns.authorizeInteractive(interactive.runId, token, interactive.figureId);
        interactiveSockets.handleUpgrade(request, socket, head, (webSocket) => {
          connectInteractiveSocket(webSocket, interactive.runId, token, interactive.figureId);
        });
      } catch {
        rejectUpgrade(socket);
      }
      return;
    }
    const protocols = parseProtocols(request.headers["sec-websocket-protocol"]);
    const authProtocol = protocols.find((protocol) => protocol.startsWith(AUTH_PREFIX));
    const token = authProtocol?.slice(AUTH_PREFIX.length);
    if (
      url.pathname !== "/api/v1/events"
      || !isExactOrigin(request.headers.origin, options.expectedOrigin)
      || !protocols.includes(APPLICATION_PROTOCOL)
      || !tokenMatches(token, options.launchToken)
    ) {
      rejectUpgrade(socket);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      sockets.emit("connection", webSocket, request);
    });
  });

  sockets.on("connection", (socket) => {
    send(socket, { type: "workspace.snapshot", workspace: options.supervisor.workspace() });
    for (const detail of options.supervisor.activeDetails()) {
      send(socket, { type: "task.projection", frame: snapshotFrame(detail) });
    }
  });
  options.supervisor.on("task.created", (detail) => broadcast({ type: "task.projection", frame: snapshotFrame(detail) }));
  options.supervisor.on("task.changed", (frame: TaskProjectionFrame) => broadcast({ type: "task.projection", frame }));
  options.supervisor.on("task.notification", (value) => broadcast({ type: "task.notification", ...value }));
  options.supervisor.on("task.retired", (value) => broadcast({ type: "task.retired", ...value }));
  options.supervisor.on("workspace.changed", (workspace) => broadcast({ type: "workspace.snapshot", workspace }));

  function connectInteractiveSocket(socket: WebSocket, runId: string, token: string, figureId: number): void {
    const key = figureKey(runId, figureId);
    let clients = figureClients.get(key);
    if (!clients) { clients = new Set(); figureClients.set(key, clients); }
    const first = clients.size === 0;
    clients.add(socket);
    if (first) options.localRuns.attachInteractive(runId, token, figureId);
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      try { options.localRuns.interactiveEvent(runId, token, figureId, JSON.parse(String(data)) as unknown); }
      catch { socket.close(1008, "Invalid interactive event"); }
    });
    socket.once("close", () => {
      const current = figureClients.get(key);
      current?.delete(socket);
      if (current?.size) return;
      figureClients.delete(key);
      try { options.localRuns.detachInteractive(runId, token, figureId); } catch { /* The run may already have ended. */ }
    });
  }

  function broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of sockets.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  return {
    closeClients() {
      for (const client of sockets.clients) client.close(1001, "Grok Build is shutting down");
      for (const clients of figureClients.values()) for (const client of clients) client.close(1001, "Grok Build is shutting down");
    },
    close() {
      removeInteractiveListener();
      sockets.close();
      interactiveSockets.close();
    },
  };
}

function snapshotFrame(detail: TaskDetailProjection): TaskProjectionFrame {
  return { kind: "snapshot", detail };
}

function interactiveSocketPath(pathname: string): { runId: string; figureId: number } | null {
  const match = /^\/local-runs\/([0-9a-f-]{36})\/interactive\/figures\/(\d+)\/ws$/i.exec(pathname);
  if (!match) return null;
  const figureId = Number(match[2]);
  return Number.isSafeInteger(figureId) && figureId > 0 ? { runId: match[1], figureId } : null;
}

function figureKey(runId: string, figureId: number): string { return `${runId}:${figureId}`; }

function rejectUpgrade(socket: import("node:stream").Duplex): void {
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function parseProtocols(value: string | string[] | undefined): string[] {
  const text = Array.isArray(value) ? value.join(",") : value || "";
  return text.split(",").map((entry) => entry.trim()).filter(Boolean);
}
