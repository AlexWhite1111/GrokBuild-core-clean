import { EventEmitter } from "node:events";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os, { type NetworkInterfaceInfo } from "node:os";
import net, { type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { createProxyServer, type ProxyServer, type ServerOptions as ProxyOptions } from "http-proxy-3";
import QRCode from "qrcode";
import type { LanShareStatus, RendererBootstrap } from "../shared/contracts.js";

const APPLICATION_PROTOCOL = "grok-build-v1";
const DEFAULT_PORT = 5179;
const PORT_SCAN_LIMIT = 128;
const NETWORK_REFRESH_MS = 5_000;

export interface LanShareServiceOptions {
  backendBootstrap: () => RendererBootstrap;
  preferredPort?: number;
  networkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  qrCodeFactory?: (value: string) => Promise<string>;
}

/** Open trusted-LAN gateway. The backend remains loopback-only behind this proxy. */
export class LanShareService extends EventEmitter {
  #server: Server | null = null;
  #proxy: ProxyServer | null = null;
  #address = "";
  #port = 0;
  #preferredPort: number;
  #qrCodeDataUrl: string | null = null;
  #networkTimer: NodeJS.Timeout | null = null;
  #connections = new Set<Socket>();

  constructor(private readonly options: LanShareServiceOptions) {
    super();
    this.#preferredPort = validPreferredPort(options.preferredPort ?? DEFAULT_PORT);
  }

  status(): LanShareStatus {
    const displayUrl = this.#address && this.#port ? `http://${this.#address}:${this.#port}` : null;
    return {
      enabled: Boolean(this.#server),
      preferredPort: this.#preferredPort,
      port: this.#port || null,
      portAdjusted: Boolean(this.#port && this.#port !== this.#preferredPort),
      address: this.#address || null,
      displayUrl,
      accessUrl: displayUrl,
      qrCodeDataUrl: this.#qrCodeDataUrl,
    };
  }

  async enable(preferredPort = this.#preferredPort): Promise<LanShareStatus> {
    this.#preferredPort = validPreferredPort(preferredPort);
    if (this.#server) return this.status();
    const address = selectLanAddress(this.#networkInterfaces());
    if (!address) throw new Error("No active Wi-Fi or LAN IPv4 address is available.");

    const backend = this.options.backendBootstrap();
    this.#address = address;
    this.#proxy = createGatewayProxy(backend, () => this.status().displayUrl);
    this.#server = http.createServer((request, response) => this.#handleRequest(request, response));
    this.#server.on("connection", (socket) => {
      this.#connections.add(socket);
      socket.once("close", () => this.#connections.delete(socket));
    });
    this.#server.on("upgrade", (request, socket, head) => this.#handleUpgrade(request, socket, head));
    this.#proxy.on("error", (_error, _request, response) => {
      if (response && "writeHead" in response && !response.headersSent) {
        response.writeHead(502, { "Content-Type": "application/problem+json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(problem(502, "INTERNAL_ERROR", "The local Grok service is unavailable.")));
      }
    });

    try {
      this.#port = await listenOnAvailablePort(this.#server, this.#preferredPort, PORT_SCAN_LIMIT);
      await this.#refreshQrCode();
      this.#networkTimer = setInterval(() => void this.#refreshNetworkAddress(), NETWORK_REFRESH_MS);
      this.#networkTimer.unref();
      this.emit("changed", this.status());
      return this.status();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<LanShareStatus> {
    const server = this.#server;
    if (this.#networkTimer) clearInterval(this.#networkTimer);
    this.#networkTimer = null;
    this.#server = null;
    const closing = server ? closeServer(server) : Promise.resolve();
    for (const connection of this.#connections) connection.destroy();
    this.#connections.clear();
    this.#proxy?.close();
    this.#proxy = null;
    this.#address = "";
    this.#port = 0;
    this.#qrCodeDataUrl = null;
    await closing;
    const status = this.status();
    this.emit("changed", status);
    return status;
  }

  async #refreshNetworkAddress(): Promise<void> {
    if (!this.#server) return;
    const next = selectLanAddress(this.#networkInterfaces());
    if (next === this.#address) return;
    this.#address = next || "";
    await this.#refreshQrCode();
    this.emit("changed", this.status());
  }

  async #refreshQrCode(): Promise<void> {
    const accessUrl = this.status().accessUrl;
    this.#qrCodeDataUrl = accessUrl
      ? await (this.options.qrCodeFactory?.(accessUrl) || QRCode.toDataURL(accessUrl, { width: 320, margin: 1, errorCorrectionLevel: "M" }))
      : null;
  }

  #networkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]> {
    return this.options.networkInterfaces?.() || os.networkInterfaces();
  }

  #handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (!this.#proxy || !this.#server) return reject(response, 503, "INTERNAL_ERROR", "LAN sharing is not ready.");
    const pathname = safePathname(request);
    if (pathname.startsWith("/internal/")) return reject(response, 404, "NOT_FOUND", "Resource not found.");
    this.#proxy.web(request, response);
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.#proxy || safePathname(request) !== "/api/v1/events") {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.#proxy.ws(request, socket as Socket, head);
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function createGatewayProxy(backend: RendererBootstrap, lanOrigin: () => string | null): ProxyServer {
  const target = new URL(backend.apiBaseUrl).origin;
  const options: ProxyOptions = { target, changeOrigin: true, ws: true, xfwd: false, secure: false };
  const proxy = createProxyServer(options);
  const backendOrigin = target;
  proxy.on("proxyReq", (request) => {
    request.setHeader("Origin", backendOrigin);
    request.setHeader("Referer", `${backendOrigin}/`);
    request.setHeader("X-Grok-Build-Launch-Token", backend.launchToken);
  });
  proxy.on("proxyReqWs", (request) => {
    request.setHeader("Origin", backendOrigin);
    request.setHeader("Sec-WebSocket-Protocol", `${APPLICATION_PROTOCOL}, ${backend.websocketProtocol}`);
  });
  proxy.on("proxyRes", (response) => {
    const origin = lanOrigin();
    const policy = response.headers["content-security-policy"];
    if (origin && typeof policy === "string") {
      response.headers["content-security-policy"] = policy.replace(
        "connect-src 'self'",
        `connect-src 'self' ${origin.replace(/^http:/, "ws:")}`,
      );
    }
  });
  return proxy;
}

function selectLanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
    .filter((entry) => !entry.internal && entry.family === "IPv4" && entry.address !== "0.0.0.0")
    .map((entry) => ({ name, address: entry.address, rank: addressRank(name, entry.address) })));
  candidates.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
  return candidates[0]?.address || null;
}

function addressRank(name: string, address: string): number {
  if (/^en\d+$/i.test(name) && isPrivateIpv4(address)) return 0;
  if (isPrivateIpv4(address) && !/^(?:utun|awdl|llw|bridge|vbox|vmnet)/i.test(name)) return 1;
  if (isPrivateIpv4(address)) return 2;
  return 3;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

async function listenOnAvailablePort(server: Server, preferredPort: number, attempts: number, probeHosts: string[] = ["127.0.0.1"]): Promise<number> {
  const start = validPreferredPort(preferredPort);
  for (let offset = 0; offset < Math.max(1, attempts); offset += 1) {
    const port = start + offset;
    if (port > 65_535) break;
    if (await isPortOccupied(port, probeHosts)) continue;
    try {
      await listen(server, port);
      return port;
    } catch (error) {
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw new Error(`No available LAN port was found from ${start} to ${Math.min(65_535, start + attempts - 1)}.`);
}

async function isPortOccupied(port: number, hosts: string[]): Promise<boolean> {
  for (const host of [...new Set(hosts)]) {
    if (await canConnect(host, port)) return true;
  }
  return false;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(160, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onListening = () => { cleanup(); resolve(); };
    const cleanup = () => { server.off("error", onError); server.off("listening", onListening); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "0.0.0.0");
  });
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function validPreferredPort(value: number): number {
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) throw new Error("LAN port must be an integer from 1024 to 65535.");
  return value;
}

function safePathname(request: IncomingMessage): string {
  try { return new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname; }
  catch { return "/"; }
}

function reject(response: ServerResponse, status: number, code: "NOT_FOUND" | "INTERNAL_ERROR", detail: string): void {
  response.writeHead(status, { "Content-Type": "application/problem+json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(problem(status, code, detail)));
}

function problem(status: number, code: "NOT_FOUND" | "INTERNAL_ERROR", detail: string): object {
  return { type: `grok-build:${code.toLowerCase()}`, title: "Request rejected", status, code, detail };
}
