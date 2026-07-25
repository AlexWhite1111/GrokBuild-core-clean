import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ResolvedLocalFileReference {
  sourcePath: string;
  resolvedPath: string;
}

const MAX_REFERENCE_HOPS = 16;
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 512;
const FINDER_ALIAS_FLAG = 0x8000;
const resolvedCache = new Map<string, { stamp: string; resolvedPath: string; expiresAt: number }>();
const FINDER_ALIAS_SCRIPT = String.raw`
ObjC.import('Foundation');
function run(argv) {
  const source = $.NSURL.fileURLWithPath($(argv[0]));
  const error = Ref();
  const resolved = $.NSURL.URLByResolvingAliasFileAtURLOptionsError(source, 0, error);
  if (!resolved) throw new Error(ObjC.unwrap(error[0].localizedDescription));
  return ObjC.unwrap(resolved.path);
}
`;

/** Keeps the user-selected path while following symbolic links and Finder aliases internally. */
export function resolveLocalFileReference(candidate: string): ResolvedLocalFileReference {
  const sourcePath = path.resolve(candidate);
  const sourceCanonicalPath = fs.realpathSync.native(sourcePath);
  const sourceStat = fs.statSync(sourceCanonicalPath);
  const stamp = `${sourceCanonicalPath}\0${sourceStat.dev}\0${sourceStat.ino}\0${sourceStat.size}\0${sourceStat.mtimeMs}`;
  const cached = resolvedCache.get(sourcePath);
  if (cached?.stamp === stamp && cached.expiresAt > Date.now()) {
    try {
      fs.statSync(cached.resolvedPath);
      return { sourcePath, resolvedPath: cached.resolvedPath };
    } catch {
      resolvedCache.delete(sourcePath);
    }
  }
  let current = sourcePath;
  const visited = new Set<string>();

  for (let hop = 0; hop < MAX_REFERENCE_HOPS; hop += 1) {
    const canonical = fs.realpathSync.native(current);
    if (visited.has(canonical)) throw new Error("Local file reference contains a cycle.");
    visited.add(canonical);
    if (process.platform !== "darwin" || !isFinderAliasFile(canonical)) {
      rememberResolved(sourcePath, stamp, canonical);
      return { sourcePath, resolvedPath: canonical };
    }
    current = resolveFinderAliasFile(canonical);
  }
  throw new Error("Local file reference exceeded the supported alias depth.");
}

function rememberResolved(sourcePath: string, stamp: string, resolvedPath: string): void {
  resolvedCache.delete(sourcePath);
  resolvedCache.set(sourcePath, { stamp, resolvedPath, expiresAt: Date.now() + CACHE_TTL_MS });
  while (resolvedCache.size > MAX_CACHE_ENTRIES) resolvedCache.delete(resolvedCache.keys().next().value!);
}

function isFinderAliasFile(candidate: string): boolean {
  let stat: fs.Stats;
  try { stat = fs.statSync(candidate); }
  catch { return false; }
  if (!stat.isFile()) return false;

  try {
    const file = fs.openSync(candidate, "r");
    try {
      const header = Buffer.allocUnsafe(16);
      const bytesRead = fs.readSync(file, header, 0, header.length, 0);
      if (bytesRead >= 12 && header.subarray(0, 4).equals(Buffer.from("book")) && header.subarray(8, 12).equals(Buffer.from("mark"))) return true;
    } finally {
      fs.closeSync(file);
    }
  } catch {
    // Classic aliases can keep their marker only in FinderInfo.
  }

  try {
    const encoded = execFileSync("/usr/bin/xattr", ["-px", "com.apple.FinderInfo", candidate], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_000,
      maxBuffer: 4_096,
    }).replace(/\s/g, "");
    const finderInfo = Buffer.from(encoded, "hex");
    return finderInfo.length >= 10 && (finderInfo.readUInt16BE(8) & FINDER_ALIAS_FLAG) !== 0;
  } catch {
    return false;
  }
}

function resolveFinderAliasFile(candidate: string): string {
  const resolved = execFileSync("/usr/bin/osascript", [
    "-l", "JavaScript", "-e", FINDER_ALIAS_SCRIPT, "--", candidate,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 3_000,
    maxBuffer: 16_384,
  }).trim();
  if (!path.isAbsolute(resolved)) throw new Error("Finder alias returned an invalid destination.");
  return resolved;
}
