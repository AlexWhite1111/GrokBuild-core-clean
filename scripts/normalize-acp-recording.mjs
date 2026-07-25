#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error("Usage: node scripts/normalize-acp-recording.mjs INPUT.jsonl OUTPUT.jsonl");
const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const rows = fs.readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const rpcIds = new Map();
const sessionIds = new Map();
const normalized = rows.map((row, index) => index === 0
  ? { ...row, normalized: true }
  : normalize(row));
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
fs.writeFileSync(output, `${normalized.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });

function normalize(value, key = "") {
  if (Array.isArray(value)) return value.map((entry) => normalize(entry, key));
  if (!value || typeof value !== "object") {
    if (key === "id" && (typeof value === "string" || typeof value === "number")) return mapped(rpcIds, value, "RPC");
    if (/session_?id/i.test(key) && typeof value === "string") return mapped(sessionIds, value, "SESSION");
    if (/(?:path|file)$/i.test(key) && typeof value === "string" && path.isAbsolute(value)) return "ABSOLUTE_PATH";
    if (/(?:timestamp|recordedAt|occurredAt)$/i.test(key)) return "TIMESTAMP";
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, normalize(entry, name)]));
}

function mapped(map, value, prefix) {
  const identity = String(value);
  if (!map.has(identity)) map.set(identity, `${prefix}_${map.size + 1}`);
  return map.get(identity);
}
