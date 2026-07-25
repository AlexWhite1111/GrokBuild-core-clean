import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConfigFieldSnapshot, ConfigInventory, ConfigMutationPreview } from "../../shared/contracts.js";

type Value = boolean | number | string | null;
type Definition = {
  id: string; section: string; key: string; group: ConfigFieldSnapshot["group"]; label: string; description: string;
  kind: ConfigFieldSnapshot["kind"]; defaultValue: Value; env?: string; options?: string[]; min?: number; max?: number;
  applies: ConfigFieldSnapshot["applies"];
};

const DEFINITIONS: Definition[] = [
  def("ui.simple_mode", "ui", "simple_mode", "interface", "Simple prompt editing", "Readline-style prompt editor; false enables experimental vim input.", "boolean", true, "next-launch"),
  def("ui.vim_mode", "ui", "vim_mode", "interface", "Vim scrollback navigation", "Enable vim-style keys in TUI scrollback.", "boolean", false, "immediate-tui"),
  def("ui.show_thinking_blocks", "ui", "show_thinking_blocks", "interface", "Show thinking blocks", "Show reasoning blocks in the TUI.", "boolean", true, "next-launch"),
  def("ui.group_tool_verbs", "ui", "group_tool_verbs", "interface", "Group tool verbs", "Fold consecutive read/search/list actions in TUI scrollback.", "boolean", true, "next-launch"),
  def("ui.default_selected_permission", "ui", "default_selected_permission", "interface", "Default permission choice", "Preselected row on the first approval prompt; later choices remain sticky inside Grok.", "enum", "always_allow_all_sessions", "new-session", { env: "GROK_DEFAULT_SELECTED_PERMISSION", options: ["always_allow_all_sessions", "allow_command_always", "allow_once", "reject"] }),
  def("ui.scroll_speed", "ui", "scroll_speed", "interface", "TUI scroll speed", "Wheel and trackpad speed, 1–100.", "integer", 50, "immediate-tui", { env: "GROK_SCROLL_SPEED", min: 1, max: 100 }),
  def("ui.scroll_mode", "ui", "scroll_mode", "interface", "TUI scroll input", "Auto, wheel, or trackpad event interpretation.", "enum", "auto", "immediate-tui", { env: "GROK_SCROLL_MODE", options: ["auto", "wheel", "trackpad"] }),
  def("ui.scroll_lines", "ui", "scroll_lines", "interface", "TUI scroll lines", "Explicit lines per event; remove override to use terminal profile.", "integer", null, "immediate-tui", { env: "GROK_SCROLL_LINES", min: 1, max: 10 }),
  def("ui.invert_scroll", "ui", "invert_scroll", "interface", "Invert TUI scroll", "Reverse vertical scroll direction.", "boolean", false, "immediate-tui", { env: "GROK_INVERT_SCROLL" }),
  def("features.telemetry", "features", "telemetry", "features", "Anonymous telemetry", "Grok anonymous usage telemetry.", "boolean", false, "next-launch"),
  def("features.feedback", "features", "feedback", "features", "Feedback system", "Enable Grok's feedback workflow.", "boolean", true, "next-launch"),
  def("features.lsp_tools", "features", "lsp_tools", "features", "LSP tool", "Expose the optional lsp tool to new sessions.", "boolean", false, "new-session"),
  def("features.codebase_indexing", "features", "codebase_indexing", "features", "Codebase indexing", "Enable code graph indexing.", "boolean", true, "new-session"),
  def("features.remote_fetch", "features", "remote_fetch", "features", "Remote fetch", "Fetch model catalog and remote settings from xAI backends.", "boolean", true, "next-launch"),
  def("session.auto_compact_threshold_percent", "session", "auto_compact_threshold_percent", "session", "Auto-compact threshold", "Percent of model context window that triggers compaction.", "integer", 85, "new-session", { min: 1, max: 100 }),
  def("session.load_envrc", "session", "load_envrc", "session", "Load .envrc", "Load workspace .envrc variables for new sessions.", "boolean", true, "new-session"),
  def("tools.respect_gitignore", "tools", "respect_gitignore", "tools", "Respect .gitignore", "Make file tools skip gitignored paths.", "boolean", false, "new-session"),
  def("toolset.bash.timeout_secs", "toolset.bash", "timeout_secs", "tools", "Bash timeout", "Foreground command timeout in seconds.", "number", 120, "new-session", { min: 1, max: 86400 }),
  def("toolset.bash.output_byte_limit", "toolset.bash", "output_byte_limit", "tools", "Bash output cap", "Maximum captured foreground output bytes.", "integer", 20000, "new-session", { min: 1000, max: 10000000 }),
  def("toolset.ask_user_question.timeout_enabled", "toolset.ask_user_question", "timeout_enabled", "tools", "Question timeout", "Enable automatic timeout for native question pickers.", "boolean", true, "new-session", { env: "GROK_ASK_USER_QUESTION_TIMEOUT_ENABLED" }),
  def("toolset.ask_user_question.timeout_secs", "toolset.ask_user_question", "timeout_secs", "tools", "Question timeout seconds", "Positive wait time for native question responses.", "integer", 1800, "new-session", { env: "GROK_ASK_USER_QUESTION_TIMEOUT_SECS", min: 1, max: 86400 }),
  ...["cursor", "claude"].flatMap((vendor) => ["skills", "rules", "agents", "mcps", "hooks"].map((surface) =>
    def(`compat.${vendor}.${surface}`, `compat.${vendor}`, surface, "compatibility", `${vendor} ${surface}`, `Scan ${vendor} ${surface} compatibility sources.`, "boolean", true, "next-launch", { env: `GROK_${vendor.toUpperCase()}_${surface.toUpperCase()}_ENABLED` }),
  )),
];

export class ConfigService {
  private readonly configFile: string;
  constructor(private readonly grokHome: string, private readonly environment: NodeJS.ProcessEnv = process.env) { this.configFile = path.join(grokHome, "config.toml"); }

  async inventory(): Promise<ConfigInventory> {
    const content = await this.readConfig();
    const parsed = parseKnownValues(content);
    const fields = DEFINITIONS.map((definition) => snapshot(definition, parsed.get(definition.id) ?? null, this.environment));
    return {
      scannedAt: new Date().toISOString(), fields,
      sources: await Promise.all([
        sourceFact(this.configFile, "config.toml", "user"),
        sourceFact(path.join(this.grokHome, "managed_config.toml"), "managed_config.toml", "managed"),
        sourceFact(path.join(this.grokHome, "requirements.toml"), "requirements.toml", "requirements"),
      ]),
      boundary: "The GUI edits only allowlisted user config fields. CLI flags, managed/requirements layers, remote settings, secrets, raw TOML, notification hooks, and unknown keys are never overwritten or reported as resolved when Grok does not expose that resolution.",
    };
  }

  async preview(input: unknown): Promise<ConfigMutationPreview> {
    const changes = validatedChanges(input);
    const inventory = await this.inventory();
    const byId = new Map(inventory.fields.map((field) => [field.id, field]));
    const rows = [...changes].map(([id, value]) => {
      const field = byId.get(id)!;
      return { id, label: field.label, before: display(field.configuredValue), after: value == null ? "unset (use precedence/default)" : display(value), action: value == null ? "remove" as const : "set" as const };
    }).filter((row) => row.before !== row.after);
    if (!rows.length) throw new Error("No configuration changes to preview");
    const canonical = JSON.stringify([...changes].sort(([a], [b]) => a.localeCompare(b)));
    return { token: `config:${crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`, changes: rows, warnings: ["Unknown sections, keys, and comments are preserved.", "Environment, CLI, managed, requirements, or remote layers may override a user value; only documented environment overrides are shown."] };
  }

  async apply(input: unknown, confirmation: unknown): Promise<{ ok: true; changed: number }> {
    const preview = await this.preview(input);
    if (confirmation !== preview.token) throw new Error(`Confirmation must exactly equal ${preview.token}`);
    const changes = validatedChanges(input);
    let content = await this.readConfig();
    for (const definition of DEFINITIONS) if (changes.has(definition.id)) content = patchKey(content, definition.section, definition.key, changes.get(definition.id)!);
    await atomicWrite(this.configFile, content);
    return { ok: true, changed: preview.changes.length };
  }

  private async readConfig(): Promise<string> { try { const stat = await fs.lstat(this.configFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error("Grok config is not a regular file within the 2 MB limit"); return await fs.readFile(this.configFile, "utf8"); } catch (error) { if (isNodeError(error) && error.code === "ENOENT") return ""; throw error; } }
}

function def(id: string, section: string, key: string, group: Definition["group"], label: string, description: string, kind: Definition["kind"], defaultValue: Value, applies: Definition["applies"], extra: Partial<Definition> = {}): Definition { return { id, section, key, group, label, description, kind, defaultValue, applies, ...extra }; }
function parseKnownValues(content: string): Map<string, Value> { const output = new Map<string, Value>(); let section = ""; for (const line of content.replace(/\r\n/g, "\n").split("\n")) { const header = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/); if (header) { section = header[1].trim(); continue; } const assignment = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*([^#]*?)\s*(?:#.*)?$/); if (!assignment) continue; const definition = DEFINITIONS.find((item) => item.section === section && item.key === assignment[1]); if (!definition) continue; const value = parseScalar(assignment[2], definition); if (value !== undefined) output.set(definition.id, value); } return output; }
function parseScalar(raw: string, definition: Definition): Value | undefined { const value = raw.trim(); if (definition.kind === "boolean") return /^true$/i.test(value) ? true : /^false$/i.test(value) ? false : undefined; if (definition.kind === "enum") { try { const parsed = JSON.parse(value); return typeof parsed === "string" && definition.options?.includes(parsed) ? parsed : undefined; } catch { return undefined; } } if (!/^-?\d+(?:\.\d+)?$/.test(value)) return undefined; const number = Number(value); return Number.isFinite(number) && (definition.kind !== "integer" || Number.isInteger(number)) ? number : undefined; }
function snapshot(definition: Definition, configuredValue: Value, environment: NodeJS.ProcessEnv): ConfigFieldSnapshot { const environmentValue = definition.env ? parseEnvironment(environment[definition.env], definition) : undefined; return { id: definition.id, group: definition.group, label: definition.label, description: definition.description, kind: definition.kind, value: environmentValue !== undefined ? environmentValue : configuredValue ?? definition.defaultValue, configuredValue, defaultValue: definition.defaultValue, source: environmentValue !== undefined ? "environment" : configuredValue != null ? "user-config" : "default", environmentVariable: definition.env ?? null, options: definition.options ?? [], min: definition.min ?? null, max: definition.max ?? null, applies: definition.applies }; }
function parseEnvironment(raw: string | undefined, definition: Definition): Value | undefined { if (raw == null || !raw.trim()) return undefined; if (definition.kind === "boolean") { const value = raw.trim().toLowerCase(); return value === "1" || value === "true" ? true : value === "0" || value === "false" ? false : undefined; } if (definition.kind === "enum") return definition.options?.includes(raw.trim()) ? raw.trim() : undefined; const number = Number(raw); if (!Number.isFinite(number) || (definition.kind === "integer" && !Number.isInteger(number))) return undefined; return clamp(number, definition.min, definition.max); }
function validatedChanges(input: unknown): Map<string, Value> { if (!isRecord(input) || !isRecord(input.changes)) throw new Error("changes must be an object"); const entries = Object.entries(input.changes); if (!entries.length || entries.length > DEFINITIONS.length) throw new Error("changes count is invalid"); const changes = new Map<string, Value>(); for (const [id, raw] of entries) { const definition = DEFINITIONS.find((item) => item.id === id); if (!definition) throw new Error(`Unsupported config field: ${id}`); if (raw == null) { changes.set(id, null); continue; } if (definition.kind === "boolean") { if (typeof raw !== "boolean") throw new Error(`${id} must be boolean`); changes.set(id, raw); continue; } if (definition.kind === "enum") { if (typeof raw !== "string" || !definition.options?.includes(raw)) throw new Error(`${id} is not an allowed option`); changes.set(id, raw); continue; } if (typeof raw !== "number" || !Number.isFinite(raw) || (definition.kind === "integer" && !Number.isInteger(raw)) || (definition.min != null && raw < definition.min) || (definition.max != null && raw > definition.max)) throw new Error(`${id} is out of range`); changes.set(id, raw); } return changes; }
function patchKey(content: string, section: string, key: string, value: Value): string { const lines = content ? content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : []; let start = -1; let end = lines.length; for (let i = 0; i < lines.length; i += 1) { const match = lines[i].match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/); if (!match) continue; if (start >= 0) { end = i; break; } if (match[1].trim() === section) start = i; } if (start < 0) { if (value == null) return content; const prefix = content.trimEnd(); return `${prefix}${prefix ? "\n\n" : ""}[${section}]\n${key} = ${encode(value)}\n`; } const relative = lines.slice(start + 1, end).findIndex((line) => new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(line)); if (relative >= 0) { if (value == null) lines.splice(start + 1 + relative, 1); else lines[start + 1 + relative] = `${key} = ${encode(value)}`; } else if (value != null) lines.splice(end, 0, `${key} = ${encode(value)}`); return `${lines.join("\n").replace(/\n+$/, "")}\n`; }
function encode(value: Exclude<Value, null>): string { return typeof value === "string" ? JSON.stringify(value) : String(value); }
function display(value: Value): string { return value == null ? "unset" : JSON.stringify(value); }
async function sourceFact(file: string, name: string, role: ConfigInventory["sources"][number]["role"]): Promise<ConfigInventory["sources"][number]> { try { const stat = await fs.lstat(file); return { name, role, exists: stat.isFile() && !stat.isSymbolicLink(), sizeBytes: stat.isFile() ? stat.size : 0, modifiedAt: stat.isFile() ? stat.mtime.toISOString() : null }; } catch (error) { if (isNodeError(error) && error.code === "ENOENT") return { name, role, exists: false, sizeBytes: 0, modifiedAt: null }; throw error; } }
async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { await fs.rename(temporary, file); return; }
    catch (error) {
      lastError = error;
      if (!isReplaceConflict(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  if (process.platform === "win32" && isReplaceConflict(lastError)) {
    const backup = `${file}.${process.pid}.${crypto.randomUUID()}.bak`;
    let backedUp = false;
    try {
      await fs.rename(file, backup); backedUp = true;
      await fs.rename(temporary, file);
      await fs.rm(backup, { force: true });
      return;
    } catch (error) {
      if (backedUp) {
        try { await fs.rename(backup, file); } catch { /* preserve original error; backup remains recoverable */ }
      }
      lastError = error;
    }
  }
  await fs.rm(temporary, { force: true });
  throw lastError;
}
function isReplaceConflict(value: unknown): boolean { return isNodeError(value) && (value.code === "EPERM" || value.code === "EACCES" || value.code === "EEXIST"); }
function clamp(value: number, min?: number, max?: number): number { return Math.min(max ?? value, Math.max(min ?? value, value)); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error && "code" in value; }
