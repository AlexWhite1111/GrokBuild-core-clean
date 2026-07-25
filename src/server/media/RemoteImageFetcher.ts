import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import http, { type IncomingMessage, type RequestOptions } from "node:http";
import https from "node:https";
import net, { BlockList } from "node:net";
import path from "node:path";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { AppProblem } from "../security/problemResponse.js";

export interface RemoteImagePayload {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";
  name: string;
  finalUrl: string;
}

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_DOH_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 12_000;
const PROXY_CACHE_MS = 30_000;
const DOH_CACHE_MS = 60_000;
const DOH_HOST = "cloudflare-dns.com";
const ALLOWED_MIME = new Set<RemoteImagePayload["mimeType"]>(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const MIME_EXTENSION: Record<RemoteImagePayload["mimeType"], string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif",
};
const BLOCKED = blockedAddresses();
const proxyDns = new Map<string, { address: LookupAddress; expiresAt: number }>();
let macProxyCache: { expiresAt: number; http?: URL; https?: URL } | null = null;

/** Fetches one public raster image while pinning each request to pre-validated DNS results. */
export async function fetchRemoteImage(value: string): Promise<RemoteImagePayload> {
  let current = remoteUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const route = await publicRoute(current);
    const response = await request(current, route);
    if (response.redirect) {
      if (redirects === MAX_REDIRECTS) throw new AppProblem(400, "VALIDATION_FAILED", "Remote image redirected too many times.");
      current = remoteUrl(new URL(response.redirect, current).href);
      continue;
    }
    const mimeType = normalizedMime(response.contentType);
    const sniffed = sniffImage(response.bytes);
    if (!mimeType || !sniffed || mimeType !== sniffed) throw new AppProblem(400, "VALIDATION_FAILED", "Remote image type did not match its bytes.");
    return { bytes: response.bytes, mimeType, name: remoteName(current, mimeType), finalUrl: current.href };
  }
  throw new AppProblem(400, "VALIDATION_FAILED", "Remote image redirect chain was invalid.");
}

interface RemoteResponse { redirect?: string; contentType?: string; bytes: Buffer }
interface PublicRoute { address: LookupAddress; proxy?: URL }

function request(url: URL, route: PublicRoute): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const agent = route.proxy
      ? url.protocol === "https:"
        ? new HttpsProxyAgent(route.proxy)
        : new HttpProxyAgent(route.proxy)
      : undefined;
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: route.proxy ? route.address.address : url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9",
        "Accept-Encoding": "identity",
        Host: url.host,
        "User-Agent": "Grok-Build-Remote-Image/1.0",
      },
      ...(agent ? { agent } : { lookup: (_hostname, _options, callback) => callback(null, route.address.address, route.address.family) }),
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
    };
    const pending = transport.request(options, (response) => receive(response, resolve, reject));
    pending.setTimeout(REQUEST_TIMEOUT_MS, () => pending.destroy(new Error("Remote image request timed out.")));
    pending.once("error", reject);
    pending.end();
  });
}

async function publicRoute(url: URL): Promise<PublicRoute> {
  const proxy = proxyFor(url.protocol);
  return proxy
    ? { address: await proxyPublicAddress(url.hostname, proxy), proxy }
    : { address: await publicAddress(url.hostname) };
}

function receive(response: IncomingMessage, resolve: (value: RemoteResponse) => void, reject: (reason?: unknown) => void): void {
  const status = response.statusCode || 0;
  const location = header(response.headers.location);
  if ([301, 302, 303, 307, 308].includes(status) && location) {
    response.resume();
    resolve({ redirect: location, bytes: Buffer.alloc(0) });
    return;
  }
  if (status < 200 || status >= 300) {
    response.resume();
    reject(new AppProblem(409, "CAPABILITY_UNAVAILABLE", `Remote image returned HTTP ${status || "unknown"}.`));
    return;
  }
  const contentLength = Number(header(response.headers["content-length"]) || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    response.destroy();
    reject(new AppProblem(400, "VALIDATION_FAILED", "Remote image exceeded the size limit."));
    return;
  }
  const encoding = header(response.headers["content-encoding"]);
  if (encoding && encoding.toLowerCase() !== "identity") {
    response.destroy();
    reject(new AppProblem(400, "VALIDATION_FAILED", "Remote image used an unsupported content encoding."));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  response.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BYTES) {
      response.destroy(new AppProblem(400, "VALIDATION_FAILED", "Remote image exceeded the size limit."));
      return;
    }
    chunks.push(chunk);
  });
  response.once("error", reject);
  response.once("end", () => {
    if (!size) { reject(new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Remote image response was empty.")); return; }
    resolve({ contentType: header(response.headers["content-type"]), bytes: Buffer.concat(chunks, size) });
  });
}

async function publicAddress(hostname: string): Promise<LookupAddress> {
  const host = publicHostname(hostname);
  const family = net.isIP(host);
  const addresses = family ? [{ address: host, family }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => blocked(entry.address, entry.family))) {
    throw new AppProblem(400, "PATH_REJECTED", "Remote image host resolved to a restricted address.");
  }
  return addresses[0];
}

async function proxyPublicAddress(hostname: string, proxy: URL): Promise<LookupAddress> {
  const host = publicHostname(hostname);
  const family = net.isIP(host);
  if (family) {
    if (blocked(host, family)) throw new AppProblem(400, "PATH_REJECTED", "Remote image host resolved to a restricted address.");
    return { address: host, family };
  }
  const key = `${proxy.href}\0${host}`;
  const cached = proxyDns.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.address;
  const settled = await Promise.allSettled([dohAddresses(host, 1, proxy), dohAddresses(host, 28, proxy)]);
  const addresses = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!addresses.length || addresses.some((entry) => blocked(entry.address, entry.family))) {
    throw new AppProblem(400, "PATH_REJECTED", "Remote image host resolved to a restricted address.");
  }
  const address = addresses[0];
  proxyDns.set(key, { address, expiresAt: Date.now() + DOH_CACHE_MS });
  if (proxyDns.size > 256) proxyDns.delete(proxyDns.keys().next().value!);
  return address;
}

function publicHostname(hostname: string): string {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new AppProblem(400, "PATH_REJECTED", "Remote image host was not public.");
  }
  return host;
}

function dohAddresses(hostname: string, type: 1 | 28, proxy: URL): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: "https:",
      hostname: DOH_HOST,
      servername: DOH_HOST,
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      method: "GET",
      agent: new HttpsProxyAgent(proxy),
      headers: {
        Accept: "application/dns-json",
        "Accept-Encoding": "identity",
        "User-Agent": "Grok-Build-Remote-Image/1.0",
      },
    }, (response) => receiveDoh(response, resolve, reject));
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Remote DNS validation timed out.")));
    request.once("error", reject);
    request.end();
  });
}

function receiveDoh(response: IncomingMessage, resolve: (value: LookupAddress[]) => void, reject: (reason?: unknown) => void): void {
  if (response.statusCode !== 200) {
    response.resume();
    reject(new AppProblem(409, "CAPABILITY_UNAVAILABLE", `Remote DNS validation returned HTTP ${response.statusCode || "unknown"}.`));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  response.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_DOH_BYTES) {
      response.destroy(new AppProblem(400, "VALIDATION_FAILED", "Remote DNS validation response exceeded its size limit."));
      return;
    }
    chunks.push(chunk);
  });
  response.once("error", reject);
  response.once("end", () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as { Status?: unknown; Answer?: Array<{ type?: unknown; data?: unknown }> };
      if (payload.Status !== 0 || !Array.isArray(payload.Answer)) { resolve([]); return; }
      resolve(payload.Answer.flatMap((answer) => {
        const address = typeof answer.data === "string" ? answer.data : "";
        const family = net.isIP(address);
        return (answer.type === 1 || answer.type === 28) && family ? [{ address, family }] : [];
      }));
    } catch (error) { reject(error); }
  });
}

function proxyFor(protocol: string): URL | undefined {
  const environment = protocol === "https:"
    ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy
    : process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  const configured = environment ? proxyUrl(environment) : undefined;
  if (configured) return configured;
  if (process.platform !== "darwin") return undefined;
  const now = Date.now();
  if (!macProxyCache || macProxyCache.expiresAt <= now) macProxyCache = readMacProxy(now);
  return protocol === "https:" ? macProxyCache.https || macProxyCache.http : macProxyCache.http;
}

function readMacProxy(now: number): { expiresAt: number; http?: URL; https?: URL } {
  try {
    const output = execFileSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 1_500, maxBuffer: 256 * 1024 });
    return {
      expiresAt: now + PROXY_CACHE_MS,
      ...(proxyFromScutil(output, "HTTP") ? { http: proxyFromScutil(output, "HTTP") } : {}),
      ...(proxyFromScutil(output, "HTTPS") ? { https: proxyFromScutil(output, "HTTPS") } : {}),
    };
  } catch {
    return { expiresAt: now + PROXY_CACHE_MS };
  }
}

function proxyFromScutil(output: string, prefix: "HTTP" | "HTTPS"): URL | undefined {
  if (scutilValue(output, `${prefix}Enable`) !== "1") return undefined;
  const hostname = scutilValue(output, `${prefix}Proxy`);
  const port = Number(scutilValue(output, `${prefix}Port`));
  if (!hostname || !Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
  const formattedHost = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return proxyUrl(`http://${formattedHost}:${port}`);
}

function scutilValue(output: string, key: string): string | undefined {
  return new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m").exec(output)?.[1];
}

function proxyUrl(value: string): URL | undefined {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url : undefined;
  } catch {
    return undefined;
  }
}

function remoteUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AppProblem(400, "VALIDATION_FAILED", "Remote image URL was invalid."); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new AppProblem(400, "VALIDATION_FAILED", "Remote image URL scheme or credentials were rejected.");
  }
  url.hash = "";
  return url;
}

function normalizedMime(value: string | undefined): RemoteImagePayload["mimeType"] | null {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  return normalized && ALLOWED_MIME.has(normalized as RemoteImagePayload["mimeType"])
    ? normalized as RemoteImagePayload["mimeType"]
    : null;
}

function sniffImage(bytes: Buffer): RemoteImagePayload["mimeType"] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const six = bytes.subarray(0, 6).toString("ascii");
  if (six === "GIF87a" || six === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))) return "image/avif";
  return null;
}

function remoteName(url: URL, mimeType: RemoteImagePayload["mimeType"]): string {
  let base = "remote-image";
  try { base = path.basename(decodeURIComponent(url.pathname)) || base; } catch { /* Keep the neutral name. */ }
  base = base.replace(/[\0\r\n/\\]/g, "-").slice(0, 480) || "remote-image";
  return path.extname(base) ? base : `${base}${MIME_EXTENSION[mimeType]}`;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function blocked(address: string, family: number): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  return BLOCKED.check(address, family === 6 ? "ipv6" : "ipv4");
}

function blockedAddresses(): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) list.addSubnet(address, prefix, "ipv4");
  for (const [address, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) list.addSubnet(address, prefix, "ipv6");
  return list;
}
