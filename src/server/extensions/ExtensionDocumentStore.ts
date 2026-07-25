import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type {
  ExtensionDocumentDetail,
  ExtensionDocumentKind,
  ExtensionDocumentSummary,
  ExtensionInventorySnapshot,
  ExtensionMutationPreview,
} from "../../shared/contracts.js";
import { atomicReplace, isNodeError, isRecord, nonNegative, records, safeText } from "./ExtensionRuntime.js";

type Scope = "user" | "project";
type Input = Record<string, unknown>;
type InspectRecord = Record<string, unknown>;

interface DocumentRecord {
  id: string;
  kind: ExtensionDocumentKind;
  name: string;
  scope: Scope;
  sourceType: string;
  file: string;
  relativePath: string;
  enabled: boolean;
}

interface DocumentMutation {
  action: "create" | "save" | "delete" | "toggle";
  kind: ExtensionDocumentKind;
  scope: Scope;
  name: string;
  file: string;
  record?: DocumentRecord;
  raw?: string;
  content?: string;
  enabled?: boolean;
}

interface NativeDocumentInventory {
  plugins: ExtensionDocumentSummary[];
  projectRules: ExtensionInventorySnapshot["projectRules"];
  hooks: ExtensionInventorySnapshot["hooks"];
  skills: ExtensionInventorySnapshot["skills"];
  agents: ExtensionInventorySnapshot["agents"];
}

const MAX_DOCUMENT_BYTES = 1_000_000;
const WRITE_ONLY = "__GROK_BUILD_WRITE_ONLY__";
const RULE_FILES = new Set(["Agents.md", "Claude.md", "CLAUDE.md", "CLAUDE.local.md", "AGENT.md", "AGENTS.md"]);

export class ExtensionDocumentStore {
  private readonly documents = new Map<string, DocumentRecord>();

  constructor(private readonly grokHome: string, private readonly workspace: () => string) {}

  async discover(inspect: InspectRecord): Promise<NativeDocumentInventory> {
    this.documents.clear();
    const config = await this.readUserConfig();
    const disabledSkills = stringSet(nested(config, "skills", "disabled"));
    const agentToggles = booleanMap(nested(config, "subagents", "toggle"));
    const [plugins, skills, agents, hooks, rules] = await Promise.all([
      this.discoverPlugins(inspect),
      this.discoverSkills(inspect, disabledSkills),
      this.discoverAgents(inspect, agentToggles),
      this.discoverHooks(inspect),
      this.discoverRules(inspect),
    ]);
    return { plugins, skills, agents, hooks, projectRules: rules };
  }

  async detail(idInput: unknown): Promise<ExtensionDocumentDetail> {
    const record = this.record(idInput);
    const raw = await this.readDocument(record);
    const hook = record.kind === "hook" || record.kind === "plugin" ? redactJsonDocument(raw) : { content: raw, redacted: false };
    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      scope: record.scope,
      sourceType: record.sourceType,
      relativePath: record.relativePath,
      editable: true,
      enabled: record.enabled,
      language: record.kind === "hook" || record.kind === "plugin" ? "json" : "markdown",
      content: hook.content,
      revision: revision(raw),
      writeOnlyValuesRedacted: hook.redacted,
    };
  }

  async preview(inputValue: unknown): Promise<ExtensionMutationPreview> {
    return this.mutationPreview(await this.prepare(inputValue));
  }

  async apply(inputValue: unknown, confirmation: unknown): Promise<{ ok: true; action: string; target: string }> {
    const mutation = await this.prepare(inputValue);
    const preview = this.mutationPreview(mutation);
    if (confirmation !== preview.token) throw new Error("Exact extension document confirmation is required");
    if (mutation.action === "create") await atomicCreate(mutation.file, mutation.content!, this.base(mutation.scope));
    else if (mutation.action === "save") await atomicWrite(mutation.file, mutation.content!, this.base(mutation.scope));
    else if (mutation.action === "delete") await fs.unlink(mutation.file);
    else await this.toggle(mutation.record!, mutation.enabled!);
    this.documents.clear();
    return { ok: true, action: mutation.action, target: preview.target };
  }

  private async prepare(inputValue: unknown): Promise<DocumentMutation> {
    const input = inputRecord(inputValue);
    const action = documentAction(input.action);
    const kind = documentKind(input.kind);
    if (action === "create") {
      const scope = documentScope(input.scope);
      const name = documentName(input.name);
      const content = documentContent(input.content);
      validateDocument(kind, name, content);
      const file = this.newDocumentFile(kind, scope, name);
      await assertMissing(file);
      return { action, kind, scope, name, file, content };
    }
    const record = this.record(input.id);
    if (record.kind !== kind) throw new Error("Document kind does not match the selected entry");
    const raw = await this.readDocument(record);
    checkRevision(input.expectedRevision, raw);
    if (action === "save") {
      const requested = documentContent(input.content);
      const content = kind === "hook" || kind === "plugin" ? mergeJsonSecrets(requested, raw) : requested;
      validateDocument(kind, record.name, content);
      return { action, kind, scope: record.scope, name: record.name, file: record.file, record, raw, content };
    }
    return { action, kind, scope: record.scope, name: record.name, file: record.file, record, raw, enabled: action === "toggle" ? booleanInput(input.enabled, "enabled") : undefined };
  }

  private mutationPreview(mutation: DocumentMutation): ExtensionMutationPreview {
    const target = mutation.record?.relativePath ?? relativeTarget(mutation.file, mutation.scope, this.grokHome, this.workspace());
    const currentRevision = mutation.raw === undefined ? "" : revision(mutation.raw);
    const token = mutation.action === "create" ? `create:${mutation.kind}:${mutation.scope}:${mutation.name}`
      : mutation.action === "toggle" ? `toggle:${mutation.kind}:${mutation.record!.id}:${String(mutation.enabled)}`
        : `${mutation.action}:${mutation.kind}:${mutation.record!.id}:${currentRevision}`;
    const changes = mutation.action === "create"
      ? [{ field: "document", before: "missing", after: contentSummary(mutation.content!) }]
      : mutation.action === "save"
        ? [{ field: "content", before: contentSummary(mutation.raw!), after: contentSummary(mutation.content!) }]
        : mutation.action === "delete"
          ? [{ field: "document", before: contentSummary(mutation.raw!), after: "deleted" }]
          : [{ field: "enabled", before: String(mutation.record!.enabled), after: String(mutation.enabled) }];
    return {
      token, domain: mutation.kind, action: mutation.action, target, changes,
      warnings: mutationWarnings(mutation.kind, mutation.scope, mutation.action),
    };
  }

  private async discoverPlugins(inspect: InspectRecord): Promise<ExtensionDocumentSummary[]> {
    const output: ExtensionDocumentSummary[] = [];
    for (const item of records(inspect.plugins).slice(0, 500)) {
      if (typeof item.path !== "string") continue;
      const scope = this.scopeForPath(item.path);
      if (!scope) continue;
      const manifest = path.basename(item.path) === "plugin.json" ? item.path : path.join(item.path, "plugin.json");
      if (!await exists(manifest)) continue;
      const record = await this.addDocument("plugin", safeText(item.name, documentStem(manifest), 100), scope, manifest, item.enabled !== false);
      if (!record) continue;
      record.sourceType = "plugin";
      output.push(documentSummary(record));
    }
    return output;
  }

  private async discoverSkills(inspect: InspectRecord, disabled: Set<string>): Promise<ExtensionInventorySnapshot["skills"]> {
    return this.discoverMarkdown("skill", inspect.skills, [
      { root: path.join(this.grokHome, "skills"), scope: "user", mode: "skill" },
      { root: path.join(this.workspace(), ".grok", "skills"), scope: "project", mode: "skill" },
      { root: path.join(this.grokHome, "commands"), scope: "user", mode: "markdown" },
      { root: path.join(this.workspace(), ".grok", "commands"), scope: "project", mode: "markdown" },
    ], (name) => !disabled.has(name));
  }

  private async discoverAgents(inspect: InspectRecord, toggles: Map<string, boolean>): Promise<ExtensionInventorySnapshot["agents"]> {
    return this.discoverMarkdown("agent", inspect.agents, [
      { root: path.join(this.grokHome, "agents"), scope: "user", mode: "markdown" },
      { root: path.join(this.workspace(), ".grok", "agents"), scope: "project", mode: "markdown" },
    ], (name) => toggles.get(name) !== false);
  }

  private discoverMarkdown(kind: "skill", inspectValue: unknown, roots: Array<{ root: string; scope: Scope; mode: "skill" | "markdown" }>, enabled: (name: string) => boolean): Promise<ExtensionInventorySnapshot["skills"]>;
  private discoverMarkdown(kind: "agent", inspectValue: unknown, roots: Array<{ root: string; scope: Scope; mode: "skill" | "markdown" }>, enabled: (name: string) => boolean): Promise<ExtensionInventorySnapshot["agents"]>;
  private async discoverMarkdown(kind: "skill" | "agent", inspectValue: unknown, roots: Array<{ root: string; scope: Scope; mode: "skill" | "markdown" }>, enabled: (name: string) => boolean) {
    const native = await this.scanNative(kind, roots);
    const summaries = await Promise.all(native.map(async (record) => {
      const meta = markdownMetadata(await this.readDocument(record), record.name);
      record.name = meta.name;
      record.enabled = enabled(record.name);
      return { ...documentSummary(record), description: meta.description, ...(kind === "skill" ? { userInvocable: meta.userInvocable } : {}) };
    }));
    const seen = new Set(native.map((item) => canonicalKey(item.file)));
    for (const [index, item] of records(inspectValue).entries()) {
      const source = sourceRecord(item.source);
      if (typeof source.path === "string" && seen.has(canonicalKey(source.path))) continue;
      const name = safeText(item.name, "unnamed", 100);
      const editable = typeof source.path === "string" ? await this.addDiscoveredDocument(kind, name, source, source.path, enabled(name)) : null;
      if (editable) {
        const meta = markdownMetadata(await this.readDocument(editable), editable.name);
        editable.name = meta.name;
        editable.enabled = enabled(meta.name);
        summaries.push({ ...documentSummary(editable), description: meta.description, ...(kind === "skill" ? { userInvocable: meta.userInvocable } : {}) });
        continue;
      }
      summaries.push({ ...readonlySummary(kind, name, source, index, enabled(name)), description: safeText(item.description, "", 500), ...(kind === "skill" ? { userInvocable: item.userInvocable === true } : {}) });
    }
    return uniqueBy(summaries, (item) => `${item.scope}:${item.name}:${item.relativePath ?? item.sourceType}`);
  }

  private async discoverHooks(inspect: InspectRecord): Promise<ExtensionInventorySnapshot["hooks"]> {
    const native = await this.scanNative("hook", [
      { root: path.join(this.grokHome, "hooks"), scope: "user", mode: "hook" },
      { root: path.join(this.workspace(), ".grok", "hooks"), scope: "project", mode: "hook" },
    ]);
    const summaries = await Promise.all(native.map(async (record) => {
      const meta = hookMetadata(await this.readDocument(record));
      return { ...documentSummary(record), ...meta };
    }));
    const editableSources = new Set<string>();
    const sourceCandidates = new Map<string, { source: { type: string; path?: unknown }; file: string }>();
    for (const item of records(inspect.hooks)) {
      const source = sourceRecord(item.source);
      if (typeof source.path !== "string" || !this.scopeForPath(source.path)) continue;
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try { stat = await fs.lstat(source.path); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      const files = stat.isFile() ? [source.path] : await walk(source.path, (name) => /\.json$/i.test(name), 3);
      for (const file of files) sourceCandidates.set(canonicalKey(file), { source, file });
    }
    for (const candidate of sourceCandidates.values()) {
      let meta: ReturnType<typeof hookMetadata>;
      try { meta = hookMetadata(await fs.readFile(candidate.file, "utf8")); } catch { continue; }
      if (!meta.eventCount) continue;
      const record = await this.addDiscoveredDocument("hook", documentStem(candidate.file), candidate.source, candidate.file, true);
      if (!record) continue;
      summaries.push({ ...documentSummary(record), ...meta });
      if (typeof candidate.source.path === "string") editableSources.add(canonicalKey(candidate.source.path));
    }
    for (const [index, item] of records(inspect.hooks).entries()) {
      const source = sourceRecord(item.source);
      if (source.type === "user" || source.type === "project" || typeof source.path === "string" && editableSources.has(canonicalKey(source.path))) continue;
      summaries.push({
        ...readonlySummary("hook", `${safeText(item.event, "Hook", 100)} ${index + 1}`, source, index),
        event: safeText(item.event, "unknown", 100),
        hookType: safeText(item.hookType, "unknown", 100),
        hasMatcher: typeof item.matcher === "string" && item.matcher.length > 0,
        eventCount: 1,
      });
    }
    return uniqueBy(summaries, (item) => item.id);
  }

  private async discoverRules(inspect: InspectRecord): Promise<ExtensionInventorySnapshot["projectRules"]> {
    const candidates = new Map<string, { file: string; scope: Scope; fileType: string; sizeBytes?: number; approxTokens?: number }>();
    for (const item of records(inspect.projectInstructions)) {
      if (typeof item.path !== "string") continue;
      const scope = item.scope === "global" ? "user" : "project";
      candidates.set(canonicalKey(item.path), {
        file: item.path,
        scope,
        fileType: safeText(item.fileType, "rules", 60),
        sizeBytes: nonNegative(item.sizeBytes),
        approxTokens: nonNegative(item.approxTokens),
      });
    }
    for (const file of await walk(path.join(this.workspace(), ".grok", "rules"), (name) => /\.md(?:\.disabled)?$/i.test(name))) {
      candidates.set(canonicalKey(file), { file, scope: "project", fileType: "rules" });
    }
    for (const { root, scope } of [{ root: this.grokHome, scope: "user" as const }, { root: this.workspace(), scope: "project" as const }]) {
      for (const name of RULE_FILES) {
        const file = path.join(root, name);
        if (await exists(file)) candidates.set(canonicalKey(file), { file, scope, fileType: "agents_md" });
        const disabled = `${file}.disabled`;
        if (await exists(disabled)) candidates.set(canonicalKey(disabled), { file: disabled, scope, fileType: "agents_md" });
      }
    }
    const summaries: ExtensionInventorySnapshot["projectRules"] = [];
    let index = 0;
    for (const candidate of candidates.values()) {
      const record = await this.addDocument("rule", documentStem(candidate.file), candidate.scope, candidate.file, !candidate.file.endsWith(".disabled"));
      if (!record) {
        summaries.push({
          ...readonlySummary("rule", ruleDisplayName(candidate.file, candidate.fileType, index), { type: candidate.scope }, index),
          fileType: candidate.fileType,
          sizeBytes: candidate.sizeBytes ?? 0,
          approxTokens: candidate.approxTokens ?? 0,
        });
        index += 1;
        continue;
      }
      const stat = await fs.stat(record.file);
      summaries.push({
        ...documentSummary(record),
        fileType: candidate.fileType,
        sizeBytes: candidate.sizeBytes ?? stat.size,
        approxTokens: candidate.approxTokens ?? Math.ceil(stat.size / 4),
      });
      index += 1;
    }
    return uniqueBy([...summaries].reverse(), (item) => item.id).reverse();
  }

  private async scanNative(kind: ExtensionDocumentKind, roots: Array<{ root: string; scope: Scope; mode: "skill" | "hook" | "markdown" }>): Promise<DocumentRecord[]> {
    const output: DocumentRecord[] = [];
    for (const source of roots) {
      const files = await walk(source.root, (name) => source.mode === "skill"
        ? name === "SKILL.md"
        : source.mode === "hook"
          ? /\.json(?:\.disabled)?$/i.test(name)
          : /\.md$/i.test(name), source.mode === "markdown" ? 1 : 8);
      for (const file of files) {
        const name = source.mode === "skill" && path.basename(file) === "SKILL.md" ? path.basename(path.dirname(file)) : documentStem(file);
        const record = await this.addDocument(kind, name, source.scope, file, !file.endsWith(".disabled"));
        if (record) output.push(record);
      }
    }
    return output;
  }

  private async addDocument(kind: ExtensionDocumentKind, name: string, scope: Scope, file: string, enabled: boolean): Promise<DocumentRecord | null> {
    try {
      const base = this.base(scope);
      await assertRegularFile(file, base);
      const canonical = await fs.realpath(file);
      const absolute = path.resolve(file);
      const record: DocumentRecord = {
        id: documentId(kind, canonical), kind, name: documentName(name), scope, sourceType: scope,
        file: absolute, relativePath: relativeTarget(absolute, scope, this.grokHome, this.workspace()), enabled,
      };
      this.documents.set(record.id, record);
      return record;
    } catch { return null; }
  }

  private async addDiscoveredDocument(kind: ExtensionDocumentKind, name: string, source: { type: string; path?: unknown }, file: string, enabled: boolean): Promise<DocumentRecord | null> {
    const scope = this.scopeForPath(file);
    if (!scope) return null;
    const record = await this.addDocument(kind, name, scope, file, enabled);
    if (record) record.sourceType = source.type;
    return record;
  }

  private scopeForPath(file: string): Scope | null {
    if (isWithin(this.grokHome, file)) return "user";
    if (isWithin(this.workspace(), file)) return "project";
    return null;
  }

  private record(idInput: unknown): DocumentRecord {
    if (typeof idInput !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(idInput)) throw new Error("Invalid extension document id");
    const record = this.documents.get(idInput);
    if (!record) throw new Error("Extension document is stale; refresh the inventory");
    return record;
  }

  private async readDocument(record: DocumentRecord): Promise<string> {
    await assertRegularFile(record.file, this.base(record.scope));
    return fs.readFile(record.file, "utf8");
  }

  private newDocumentFile(kind: ExtensionDocumentKind, scope: Scope, name: string): string {
    const root = scope === "user" ? this.grokHome : path.join(this.workspace(), ".grok");
    if (kind === "plugin") return path.join(root, "plugins", name, "plugin.json");
    if (kind === "skill") return path.join(root, "skills", name, "SKILL.md");
    if (kind === "hook") return path.join(root, "hooks", `${name}.json`);
    if (kind === "agent") return path.join(root, "agents", `${name}.md`);
    return scope === "user" ? path.join(this.grokHome, "AGENTS.md") : path.join(root, "rules", `${name}.md`);
  }

  private async toggle(record: DocumentRecord, enabled: boolean): Promise<void> {
    if (record.enabled === enabled) return;
    if (record.kind === "plugin") throw new Error("Plugin enable state is managed by the official Plugin CLI");
    if (record.kind === "skill") {
      const config = await this.readUserConfigText();
      const parsed = parseConfig(config);
      const disabled = stringSet(nested(parsed, "skills", "disabled"));
      if (enabled) disabled.delete(record.name); else disabled.add(record.name);
      await atomicWrite(path.join(this.grokHome, "config.toml"), patchTomlKey(config, "skills", "disabled", JSON.stringify([...disabled].sort())), this.grokHome);
      return;
    }
    if (record.kind === "agent") {
      const config = await this.readUserConfigText();
      await atomicWrite(path.join(this.grokHome, "config.toml"), patchTomlKey(config, "subagents.toggle", record.name, enabled ? null : "false"), this.grokHome);
      return;
    }
    const destination = enabled ? record.file.replace(/\.disabled$/, "") : `${record.file}.disabled`;
    if (destination === record.file) return;
    await assertMissing(destination);
    await assertRegularFile(record.file, this.base(record.scope));
    await fs.rename(record.file, destination);
  }

  private base(scope: Scope): string { return path.resolve(scope === "user" ? this.grokHome : this.workspace()); }

  private async readUserConfig(): Promise<Record<string, unknown>> { return parseConfig(await this.readUserConfigText()); }

  private async readUserConfigText(): Promise<string> {
    const file = path.join(this.grokHome, "config.toml");
    try {
      await assertRegularFile(file, this.grokHome, 2_000_000);
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return "";
      throw error;
    }
  }
}

function documentSummary(record: DocumentRecord): ExtensionDocumentSummary {
  return { id: record.id, name: record.name, scope: record.scope, sourceType: record.sourceType, relativePath: record.relativePath, editable: true, enabled: record.enabled };
}

function readonlySummary(kind: ExtensionDocumentKind, name: string, source: { type: string; path?: unknown }, index: number, enabled = true): ExtensionDocumentSummary {
  const scope = sourceScope(source.type);
  return { id: documentId(kind, `${source.type}:${name}:${index}`), name, scope, sourceType: source.type, relativePath: null, editable: false, enabled };
}

function sourceScope(type: string): ExtensionDocumentSummary["scope"] {
  if (type === "user") return "user";
  if (type === "project") return "project";
  if (type === "plugin") return "plugin";
  if (type === "builtin" || type === "bundled") return "builtin";
  if (type.includes("claude") || type.includes("cursor") || type === "compat") return "compat";
  return "unknown";
}

function sourceRecord(value: unknown): { type: string; path?: unknown } {
  return isRecord(value) ? { type: safeText(value.type, "unknown", 60), path: value.path } : { type: typeof value === "string" ? value : "unknown" };
}

function markdownMetadata(content: string, fallbackName: string): { name: string; description: string; userInvocable: boolean } {
  try {
    const frontmatter = parseFrontmatter(content);
    return {
      name: typeof frontmatter.name === "string" ? documentName(frontmatter.name) : documentName(fallbackName),
      description: typeof frontmatter.description === "string" ? frontmatter.description.trim().slice(0, 500) : firstParagraph(content).slice(0, 500),
      userInvocable: frontmatter["user-invocable"] !== false,
    };
  } catch { return { name: documentName(fallbackName), description: "Definition needs attention", userInvocable: true }; }
}

function hookMetadata(content: string): { event: string; hookType: string; hasMatcher: boolean; eventCount: number } {
  try {
    const root = JSON.parse(content) as unknown;
    const hooks = isRecord(root) && isRecord(root.hooks) ? root.hooks : {};
    const events = Object.keys(hooks);
    const groups = events.flatMap((event) => Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []);
    const handlers = groups.flatMap((group) => isRecord(group) && Array.isArray(group.hooks) ? group.hooks : []);
    const first = handlers.find(isRecord);
    return {
      event: events.length === 1 ? events[0] : `${events.length} events`,
      hookType: first ? safeText(first.type, "mixed", 100) : "empty",
      hasMatcher: groups.some((group) => isRecord(group) && typeof group.matcher === "string" && group.matcher.length > 0),
      eventCount: events.length,
    };
  } catch { return { event: "Invalid JSON", hookType: "invalid", hasMatcher: false, eventCount: 0 }; }
}

function validateDocument(kind: ExtensionDocumentKind, name: string, content: string): void {
  if (kind === "rule") return;
  if (kind === "plugin") {
    let manifest: unknown;
    try { manifest = JSON.parse(content); } catch { throw new Error("Plugin manifest must be valid JSON"); }
    if (!isRecord(manifest)) throw new Error("Plugin manifest must be a JSON object");
    rejectPrototypeKeys(manifest);
    return;
  }
  if (kind === "hook") { validateHook(content); return; }
  const frontmatter = parseFrontmatter(content);
  if (frontmatter.name != null && frontmatter.name !== name) throw new Error(`When present, frontmatter name must exactly equal ${name}`);
}

function validateHook(content: string): void {
  let root: unknown;
  try { root = JSON.parse(content); } catch { throw new Error("Hook content must be valid JSON"); }
  if (!isRecord(root) || !isRecord(root.hooks) || !Object.keys(root.hooks).length) throw new Error("Hook JSON must contain a non-empty hooks object");
  rejectPrototypeKeys(root);
  for (const [event, groups] of Object.entries(root.hooks)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event)) throw new Error(`Invalid hook event name: ${event}`);
    if (!Array.isArray(groups) || !groups.length) throw new Error(`${event} must contain at least one hook group`);
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks) || !group.hooks.length) throw new Error(`${event} group must contain hooks`);
      for (const handler of group.hooks) {
        if (!isRecord(handler) || (handler.type !== "command" && handler.type !== "http")) throw new Error("Each hook must be a command or http handler");
        const target = handler.type === "command" ? handler.command : handler.url;
        if (typeof target !== "string" || !target.trim() || target.length > 10_000 || target.includes("\0")) throw new Error("Each hook handler requires a valid command or URL");
      }
    }
  }
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error("A YAML frontmatter block is required");
  const parsed = parseYaml(match[1]);
  if (!isRecord(parsed)) throw new Error("Frontmatter must be a mapping");
  rejectPrototypeKeys(parsed);
  return parsed;
}

function redactJsonDocument(content: string): { content: string; redacted: boolean } {
  try {
    const parsed = JSON.parse(content) as unknown;
    const state = { redacted: false };
    const redacted = redactValue(parsed, "", state);
    return state.redacted ? { content: `${JSON.stringify(redacted, null, 2)}\n`, redacted: true } : { content, redacted: false };
  } catch { return { content, redacted: false }; }
}

function redactValue(value: unknown, key: string, state: { redacted: boolean }): unknown {
  if (typeof value === "string") {
    if (isSecretKey(key) || secretBearingString(value)) { state.redacted = true; return WRITE_ONLY; }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key, state));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value)) {
    if ((key === "env" || key === "headers" || childKey === "env" || childKey === "headers") && isRecord(child)) {
      output[childKey] = Object.fromEntries(Object.keys(child).map((entry) => [entry, WRITE_ONLY]));
      if (Object.keys(child).length) state.redacted = true;
    } else output[childKey] = redactValue(child, childKey, state);
  }
  return output;
}

function mergeJsonSecrets(requested: string, current: string): string {
  let next: unknown; let before: unknown;
  try { next = JSON.parse(requested); before = JSON.parse(current); } catch { return requested; }
  return `${JSON.stringify(mergeWriteOnly(next, before), null, 2)}\n`;
}

function mergeWriteOnly(next: unknown, before: unknown): unknown {
  if (next === WRITE_ONLY) return before;
  if (Array.isArray(next)) return next.map((item, index) => mergeWriteOnly(item, Array.isArray(before) ? before[index] : undefined));
  if (!isRecord(next)) return next;
  const previous = isRecord(before) ? before : {};
  return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, mergeWriteOnly(value, previous[key])]));
}

function mutationWarnings(kind: ExtensionDocumentKind, scope: Scope, action: string): string[] {
  return [
    "Only the selected source file is changed; other extension documents are left as they are.",
    ...(kind === "plugin" && scope === "project" ? ["Project plugins remain subject to Grok project trust before executable components activate."] : []),
    ...(kind === "hook" ? ["Hook environment and credential-like values are write-only; placeholders preserve the stored value."] : []),
    ...(kind === "hook" && scope === "project" ? ["Project hooks execute after the project passes Grok folder trust."] : []),
    ...(action === "delete" ? ["Deleting this definition removes it from new Grok sessions after reload."] : []),
  ];
}

function patchTomlKey(content: string, section: string, key: string, encoded: string | null): string {
  const lines = content ? content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : [];
  let start = -1; let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (!header) continue;
    if (start >= 0) { end = index; break; }
    if (header[1].trim() === section) start = index;
  }
  const renderedKey = /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
  const assignment = new RegExp(`^\\s*(?:${escapeRegex(key)}|${escapeRegex(JSON.stringify(key))}|${escapeRegex(`'${key}'`)})\\s*=`);
  if (start < 0) {
    if (encoded == null) return content;
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}[${section}]\n${renderedKey} = ${encoded}\n`;
  }
  const relative = lines.slice(start + 1, end).findIndex((line) => assignment.test(line));
  if (relative < 0) {
    if (encoded != null) lines.splice(end, 0, `${renderedKey} = ${encoded}`);
    return `${lines.join("\n").replace(/\n+$/, "")}\n`;
  }
  const index = start + 1 + relative;
  const last = assignmentEnd(lines, index, end);
  if (encoded == null) lines.splice(index, last - index + 1);
  else lines.splice(index, last - index + 1, `${renderedKey} = ${encoded}`);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function assignmentEnd(lines: string[], start: number, sectionEnd: number): number {
  let brackets = 0; let quote = ""; let escaped = false;
  for (let index = start; index < sectionEnd; index += 1) {
    for (const char of lines[index]) {
      if (escaped) { escaped = false; continue; }
      if (quote && char === "\\") { escaped = true; continue; }
      if (char === '"' || char === "'") { quote = quote === char ? "" : quote ? quote : char; continue; }
      if (quote) continue;
      if (char === "[") brackets += 1;
      if (char === "]") brackets -= 1;
    }
    if (index > start && brackets <= 0) return index;
    if (index === start && brackets <= 0) return start;
  }
  return start;
}

async function atomicWrite(file: string, content: string, base: string): Promise<void> {
  if (!isWithin(base, file)) throw new Error("Extension document path escaped its configured scope");
  await ensureSafeParents(path.dirname(file), base);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (await exists(file)) {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Extension target must be a regular file");
  }
  await atomicReplace(file, content);
}

async function atomicCreate(file: string, content: string, base: string): Promise<void> {
  if (!isWithin(base, file)) throw new Error("Extension document path escaped its configured scope");
  await ensureSafeParents(path.dirname(file), base);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await fs.link(temporary, file); }
  catch (error) { await fs.rm(temporary, { force: true }); if (isNodeError(error) && error.code === "EEXIST") throw new Error("An extension document with this name already exists"); throw error; }
  await fs.rm(temporary, { force: true });
}

async function ensureSafeParents(directory: string, base: string): Promise<void> {
  if (!isWithin(base, directory)) throw new Error("Extension directory escaped its configured scope");
  const relative = path.relative(path.resolve(base), path.resolve(directory));
  let cursor = path.resolve(base);
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Extension parent must be a real directory");
    } catch (error) { if (isNodeError(error) && error.code === "ENOENT") break; throw error; }
  }
}

async function assertRegularFile(file: string, base: string, max = MAX_DOCUMENT_BYTES): Promise<void> {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > max) throw new Error("Extension document must be a regular file within the size limit");
  const [realFile, realBase] = await Promise.all([fs.realpath(file), realBasePath(base)]);
  if (!isWithin(realBase, realFile)) throw new Error("Extension file resolved outside its configured scope");
}

async function realBasePath(base: string): Promise<string> {
  try { return await fs.realpath(base); } catch (error) { if (isNodeError(error) && error.code === "ENOENT") return path.resolve(base); throw error; }
}

async function assertMissing(file: string): Promise<void> {
  if (await exists(file)) throw new Error("An extension document with this name already exists");
}

async function walk(root: string, accept: (name: string, file: string) => boolean, maxDepth = 8): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth || output.length >= 1_000) return;
    let entries: Dirent<string>[];
    try { entries = await fs.readdir(directory, { withFileTypes: true, encoding: "utf8" }); }
    catch (error) { if (isNodeError(error) && error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(file, depth + 1);
      else if (entry.isFile() && accept(entry.name, file)) output.push(file);
      if (output.length >= 1_000) break;
    }
  }
  await visit(root, 0);
  return output;
}

function parseConfig(content: string): Record<string, unknown> {
  if (!content.trim()) return {};
  try { const parsed = parseToml(content); return isRecord(parsed) ? parsed : {}; }
  catch { throw new Error("Grok config.toml must parse before extension toggles can be changed"); }
}

function nested(value: unknown, ...keys: string[]): unknown { let current = value; for (const key of keys) { if (!isRecord(current)) return undefined; current = current[key]; } return current; }
function stringSet(value: unknown): Set<string> { return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []); }
function booleanMap(value: unknown): Map<string, boolean> { return new Map(isRecord(value) ? Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean") : []); }
function documentId(kind: ExtensionDocumentKind, file: string): string { return crypto.createHash("sha256").update(`${kind}\0${file}`).digest("base64url").slice(0, 24); }
function revision(content: string): string { return crypto.createHash("sha256").update(content).digest("hex"); }
function contentSummary(content: string): string { return `${Buffer.byteLength(content, "utf8")} bytes · ${revision(content).slice(0, 10)}`; }
function relativeTarget(file: string, scope: Scope, grokHome: string, workspace: string): string { const root = canonicalKey(scope === "user" ? grokHome : workspace); const relative = path.relative(root, canonicalKey(file)).split(path.sep).join("/"); return scope === "user" ? `~/.grok/${relative}` : relative; }
function documentStem(file: string): string { return path.basename(file).replace(/\.disabled$/i, "").replace(/\.(?:md|json)$/i, ""); }
function ruleDisplayName(file: string, fallback: string, index: number): string { const normalized = file.replace(/\\/g, "/"); const name = normalized.split("/").pop()?.replace(/\.disabled$/i, "").replace(/\.md$/i, ""); return name || `${fallback}-${index + 1}`; }
function canonicalKey(file: string): string { return path.resolve(file).replace(/^\/private(?=\/(?:var|tmp)\/)/, ""); }
function firstParagraph(content: string): string { return content.replace(/^---\n[\s\S]*?\n---\n?/, "").split(/\n\s*\n/).find((item) => item.trim())?.replace(/^#+\s*/, "").trim() ?? ""; }
function isSecretKey(key: string): boolean { return /(?:secret|token|password|passphrase|api[_-]?key|authorization|cookie|credential)/i.test(key); }
function secretBearingString(value: string): boolean { return /(?:secret|token|password|passphrase|api[_-]?key|authorization|cookie|credential)\s*[=:]\s*\S+/i.test(value) || /(?:xai|sk)-[A-Za-z0-9._-]{8,}/i.test(value); }
function checkRevision(expected: unknown, content: string): void { if (expected != null && expected !== revision(content)) throw new Error("Extension document changed on disk; reload before applying edits"); }
function inputRecord(value: unknown): Input { if (!isRecord(value)) throw new Error("Extension document mutation is invalid"); return value; }
function documentAction(value: unknown): "create" | "save" | "delete" | "toggle" { if (value === "create" || value === "save" || value === "delete" || value === "toggle") return value; throw new Error("Unsupported extension document action"); }
function documentKind(value: unknown): ExtensionDocumentKind { if (value === "plugin" || value === "skill" || value === "hook" || value === "agent" || value === "rule") return value; throw new Error("Unsupported extension document kind"); }
function documentScope(value: unknown): Scope { if (value === "user" || value === "project") return value; throw new Error("Extension scope must be user or project"); }
function documentName(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) throw new Error("Extension name contains unsupported path characters"); return value; }
function documentContent(value: unknown): string { if (typeof value !== "string" || value.length > MAX_DOCUMENT_BYTES || value.includes("\0")) throw new Error("Extension document content exceeds the size limit"); return value.replace(/\r\n/g, "\n"); }
function booleanInput(value: unknown, label: string): boolean { if (typeof value !== "boolean") throw new Error(`${label} must be boolean`); return value; }
function isWithin(base: string, candidate: string): boolean { const relative = path.relative(canonicalKey(base), canonicalKey(candidate)); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function rejectPrototypeKeys(value: unknown): void { if (Array.isArray(value)) { value.forEach(rejectPrototypeKeys); return; } if (!isRecord(value)) return; for (const [key, child] of Object.entries(value)) { if (key === "__proto__" || key === "prototype" || key === "constructor") throw new Error("Prototype keys are not allowed"); rejectPrototypeKeys(child); } }
async function exists(file: string): Promise<boolean> { try { await fs.lstat(file); return true; } catch (error) { if (isNodeError(error) && error.code === "ENOENT") return false; throw error; } }
