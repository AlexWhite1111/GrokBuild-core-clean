#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

if (process.argv.includes("--recording-help")) {
  process.stdout.write([
    "ACP recording proxy",
    "",
    "GROK_RECORD_TARGET=$HOME/.grok/bin/grok \\",
    "GROK_RECORD_OUTPUT=/absolute/path/capture.jsonl \\",
    "GROK_BIN=$PWD/scripts/acp-recording-proxy.mjs npm run dev",
    "",
    "The proxy forwards the real CLI byte-for-byte and writes redacted JSON-RPC lines.",
  ].join("\n"));
  process.exit(0);
}

const target = path.resolve(process.env.GROK_RECORD_TARGET || path.join(process.env.GROK_HOME || path.join(os.homedir(), ".grok"), "bin", "grok"));
const output = process.env.GROK_RECORD_OUTPUT ? path.resolve(process.env.GROK_RECORD_OUTPUT) : null;
const self = fs.realpathSync(process.argv[1]);
if (!output) throw new Error("GROK_RECORD_OUTPUT must be an absolute capture .jsonl path.");
if (fs.realpathSync(target) === self) throw new Error("GROK_RECORD_TARGET points back to the recording proxy.");
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
  const version = spawnSync(target, ["--version"], { encoding: "utf8" }).stdout.trim() || "unknown";
  append({ format: "grok-acp-recording/v1", source: { cli: "grok", version }, normalized: false });
}

const child = spawn(target, process.argv.slice(2), {
  cwd: process.cwd(),
  env: { ...process.env, GROK_RECORDING_ACTIVE: "1" },
  shell: false,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});

pipeJsonLines(process.stdin, child.stdin, "client_to_agent");
pipeJsonLines(child.stdout, process.stdout, "agent_to_client");
child.stderr.pipe(process.stderr);
child.once("error", (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

function pipeJsonLines(source, destination, direction) {
  let buffered = "";
  source.on("data", (chunk) => {
    destination.write(chunk);
    buffered += chunk.toString("utf8");
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      try { append({ direction, message: sanitize(JSON.parse(line)) }); } catch { /* Non-JSON CLI output remains forwarded only. */ }
    }
  });
  source.once("end", () => destination.end());
}

function append(value) {
  fs.appendFileSync(output, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function sanitize(value, key = "", depth = 0) {
  if (/(?:authorization|cookie|credential|password|secret|(?:access|refresh|id|auth|session)[_-]?token|(?:^|_)token|api[_-]?key)/i.test(key)) return "[redacted]";
  if (depth > 10) return "[depth-truncated]";
  if (typeof value === "string") return redact(value).slice(0, 100_000);
  if (Array.isArray(value)) return value.slice(0, 500).map((entry) => sanitize(entry, key, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).slice(0, 500).map(([name, entry]) => [name, sanitize(entry, name, depth + 1)]));
}

function redact(value) {
  return value
    .replace(/\b(?:xai|sk|key)-[A-Za-z0-9._-]{8,}\b/gi, "[redacted-token]")
    .replace(/((?:access|refresh|id)_token\s*[=:]\s*["']?)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(authorization\s*[=:]\s*(?:bearer\s+)?)[^\s,"'}]+/gi, "$1[redacted]");
}
