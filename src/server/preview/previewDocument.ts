import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { transform, type Loader } from "esbuild";
import { init as initModuleLexer, parse as parseModule } from "es-module-lexer";
import {
  defaultTreeAdapter,
  html as parse5Html,
  parse as parseHtml,
  serialize as serializeHtml,
  type DefaultTreeAdapterTypes,
} from "parse5";
import type { PreviewGraphSummary } from "../../shared/contracts.js";
import { collectRemotePreviewAlias, hasTopLevelAwait, previewPackageUrl } from "../../shared/previewModules.js";

const PREVIEW_BASE = "__GROK_PREVIEW_BASE__";
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"];
const TYPED_SCRIPT_TYPES = new Map<string, Loader>([
  ["text/typescript", "ts"], ["application/typescript", "ts"],
  ["text/tsx", "tsx"], ["application/tsx", "tsx"],
  ["text/jsx", "jsx"], ["text/babel", "jsx"],
]);

type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

interface ModuleRoot {
  source: string;
  importer: string;
  name: string;
}

export interface PreviewDocumentResult {
  htmlTemplate: string;
  graph: PreviewGraphSummary;
  localFingerprints: string[];
}

export async function buildPreviewDocument(input: {
  language: string;
  source: string;
  embedded: boolean;
  workspace: string;
}): Promise<PreviewDocumentResult> {
  const language = normalizeLanguage(input.language);
  if (language === "html" || language === "htm") return buildHtmlDocument(input.source, input.embedded, input.workspace);
  if (["javascript", "js", "typescript", "ts", "tsx", "jsx"].includes(language)) {
    return buildScriptDocument(language, input.source, input.workspace, input.embedded);
  }
  if (language === "css") return buildCssDocument(input.source, input.embedded);
  return buildPlainDocument(input.source);
}

async function buildHtmlDocument(source: string, embedded: boolean, workspace: string): Promise<PreviewDocumentResult> {
  const fullDocument = /<!doctype\s+html|<html(?:\s|>)/i.test(source);
  const document = parseHtml(fullDocument ? source : `<!doctype html><html><head></head><body>${source}</body></html>`);
  rewriteProjectRootUrls(document);
  const moduleRoots: ModuleRoot[] = [];
  const moduleEntries: string[] = [];
  const remoteModuleEntries: string[] = [];
  for (const script of findElements(document, "script")) {
    let type = (attribute(script, "type") || "").trim().toLowerCase();
    if (type === "importmap") continue;
    const src = attribute(script, "src")?.trim();
    const typedLoader = TYPED_SCRIPT_TYPES.get(type) || loaderForName(src || "");
    if (typedLoader && typedLoader !== "js") {
      setAttribute(script, "type", "module");
      type = "module";
      if (!src) setElementText(script, await transformModule(elementText(script), typedLoader, `inline.${typedLoader}`));
    }
    if (src) {
      if (type === "module" && isLocalSpecifier(src)) moduleEntries.push(src);
      else if (type === "module" && isRemoteSpecifier(src)) remoteModuleEntries.push(src);
      continue;
    }
    const code = elementText(script);
    if (!code.trim()) continue;
    const analysis = await moduleImports(code);
    if (type === "module" || analysis.module || hasTopLevelAwait(code)) {
      if (type !== "module") setAttribute(script, "type", "module");
      moduleRoots.push({ source: code, importer: "", name: "inline.html.js" });
    }
  }
  const graph = await analyzeModuleGraph(workspace, moduleRoots, moduleEntries, remoteModuleEntries);
  injectDocumentRuntime(document, graph.packages, graph.aliases, fullDocument ? null : embedded ? EMBED_STYLE : BASE_STYLE);
  return {
    htmlTemplate: serializeHtml(document),
    graph: graph.summary,
    localFingerprints: graph.fingerprints,
  };
}

async function buildScriptDocument(language: string, source: string, workspace: string, embedded: boolean): Promise<PreviewDocumentResult> {
  const loader = loaderForLanguage(language);
  let code = loader === "js" ? source : await transformModule(source, loader, `entry.${loader}`);
  const analysis = await moduleImports(code);
  const module = loader !== "js" || analysis.module || hasTopLevelAwait(code);
  const graph = await analyzeModuleGraph(workspace, module ? [{ source: code, importer: "", name: `entry.${loader}` }] : [], []);
  const script = `<script${module ? " type=\"module\"" : ""}>${escapeClosingTag(code, "script")}</script>`;
  const document = parseHtml(`<!doctype html><html><head></head><body>${SCRIPT_BODY}${script}</body></html>`);
  injectDocumentRuntime(document, graph.packages, graph.aliases, embedded ? EMBED_STYLE : BASE_STYLE);
  return { htmlTemplate: serializeHtml(document), graph: graph.summary, localFingerprints: graph.fingerprints };
}

function buildCssDocument(source: string, embedded: boolean): PreviewDocumentResult {
  const document = parseHtml(`<!doctype html><html><head><style>${escapeClosingTag(source, "style")}</style></head><body>${SAMPLE_BODY}</body></html>`);
  injectDocumentRuntime(document, [], {}, embedded ? EMBED_STYLE : BASE_STYLE);
  return { htmlTemplate: serializeHtml(document), graph: emptyGraph(), localFingerprints: [] };
}

function buildPlainDocument(source: string): PreviewDocumentResult {
  const document = parseHtml(`<!doctype html><html><head></head><body><pre>${escapeHtml(source)}</pre></body></html>`);
  injectDocumentRuntime(document, [], {}, BASE_STYLE);
  return { htmlTemplate: serializeHtml(document), graph: emptyGraph(), localFingerprints: [] };
}

function injectDocumentRuntime(document: Document, packages: string[], aliases: Record<string, string>, baseStyle: string | null): void {
  const head = findElements(document, "head")[0];
  if (!head) return;
  const prefix: Element[] = [];
  if (!findElements(document, "meta").some((node) => attribute(node, "charset"))) {
    prefix.push(element("meta", [{ name: "charset", value: "utf-8" }]));
  }
  if (!findElements(document, "meta").some((node) => attribute(node, "name")?.toLowerCase() === "viewport")) {
    prefix.push(element("meta", [{ name: "name", value: "viewport" }, { name: "content", value: "width=device-width,initial-scale=1" }]));
  }
  const existingBase = findElements(document, "base")[0];
  if (existingBase) {
    defaultTreeAdapter.detachNode(existingBase);
    prefix.push(existingBase);
  } else {
    prefix.push(element("base", [{ name: "href", value: PREVIEW_BASE }]));
  }
  const importMap = mergeImportMap(document, packages, aliases);
  if (importMap) {
    defaultTreeAdapter.detachNode(importMap);
    prefix.push(importMap);
  }
  prefix.push(element("script", [
    { name: "src", value: "/preview-runtime/runtime.js" },
    { name: "data-grok-preview-runtime", value: "" },
  ]));
  if (baseStyle) {
    const style = element("style");
    setElementText(style, baseStyle);
    prefix.push(style);
  }
  for (const node of prefix) node.parentNode = head;
  head.childNodes.unshift(...prefix);
}

function mergeImportMap(document: Document, packages: string[], aliases: Record<string, string>): Element | null {
  const existing = findElements(document, "script").find((node) => attribute(node, "type")?.trim().toLowerCase() === "importmap");
  if (!packages.length) return existing || null;
  let map: { imports?: Record<string, string>; [key: string]: unknown } = {};
  if (existing) {
    try {
      const parsed = JSON.parse(elementText(existing)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed as typeof map;
    } catch { /* The browser will surface the authored map error; missing entries still get a valid replacement. */ }
  }
  const imports = map.imports && typeof map.imports === "object" ? { ...map.imports } : {};
  for (const [specifier, url] of Object.entries(aliases)) imports[specifier] ??= url;
  for (const specifier of packages) imports[specifier] ??= previewPackageUrl(specifier);
  map.imports = imports;
  const target = existing || element("script", [{ name: "type", value: "importmap" }]);
  setElementText(target, JSON.stringify(map));
  return target;
}

async function analyzeModuleGraph(workspace: string, roots: ModuleRoot[], entries: string[], remoteEntries: string[] = []): Promise<{
  summary: PreviewGraphSummary;
  packages: string[];
  aliases: Record<string, string>;
  fingerprints: string[];
}> {
  await initModuleLexer;
  const packages = new Set<string>();
  const aliases = new Map<string, string>();
  const fingerprints = new Map<string, string>();
  const queued = [...roots];
  const seen = new Set<string>();
  for (const specifier of remoteEntries) collectRemotePreviewAlias(specifier, packages, aliases);
  for (const entry of entries) {
    const resolved = await resolveWorkspaceModule(workspace, "", entry);
    if (resolved) await queueLocalModule(resolved, queued, seen, fingerprints);
  }
  let cursor = 0;
  while (cursor < queued.length && cursor < 256) {
    const current = queued[cursor++];
    const imports = (await moduleImports(current.source)).imports;
    for (const specifier of imports) {
      if (isBareSpecifier(specifier)) {
        packages.add(specifier);
        continue;
      }
      if (isRemoteSpecifier(specifier)) {
        collectRemotePreviewAlias(specifier, packages, aliases);
        continue;
      }
      if (!isLocalSpecifier(specifier)) continue;
      const resolved = await resolveWorkspaceModule(workspace, current.importer, specifier);
      if (resolved) await queueLocalModule(resolved, queued, seen, fingerprints);
    }
  }
  const sortedPackages = [...packages].sort();
  return {
    summary: { moduleCount: roots.length + seen.size, localModuleCount: seen.size, packages: sortedPackages },
    packages: sortedPackages,
    aliases: Object.fromEntries([...aliases.entries()].sort(([left], [right]) => left.localeCompare(right))),
    fingerprints: [...fingerprints.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, hash]) => `${name}:${hash}`),
  };
}

async function queueLocalModule(
  resolved: ResolvedWorkspaceModule,
  queue: ModuleRoot[],
  seen: Set<string>,
  fingerprints: Map<string, string>,
): Promise<void> {
  if (seen.has(resolved.relative)) return;
  seen.add(resolved.relative);
  const source = await fs.readFile(resolved.absolute, "utf8");
  fingerprints.set(resolved.relative, digest(source));
  const loader = loaderForName(resolved.relative) || "js";
  const transformed = loader === "js" ? source : await transformModule(source, loader, resolved.relative);
  queue.push({ source: transformed, importer: resolved.relative, name: resolved.relative });
}

async function moduleImports(source: string): Promise<{ imports: string[]; module: boolean }> {
  await initModuleLexer;
  try {
    const [imports, exports, , hasModuleSyntax] = parseModule(source);
    return {
      imports: imports.flatMap((item) => item.n ? [item.n] : []),
      module: hasModuleSyntax || exports.length > 0,
    };
  } catch {
    return { imports: [], module: false };
  }
}

export interface ResolvedWorkspaceModule {
  absolute: string;
  relative: string;
}

export async function resolveWorkspaceModule(workspace: string, importer: string, specifier: string): Promise<ResolvedWorkspaceModule | null> {
  const clean = stripQueryAndHash(specifier);
  if (!clean || !isLocalSpecifier(clean)) return null;
  const root = path.resolve(workspace);
  const relativeTarget = clean.startsWith("/") ? clean.slice(1) : path.join(importer ? path.dirname(importer) : "", clean);
  const target = path.resolve(root, relativeTarget);
  if (!isInside(root, target)) return null;
  const candidates = [target];
  if (!path.extname(target)) candidates.push(...MODULE_EXTENSIONS.map((extension) => `${target}${extension}`));
  candidates.push(...MODULE_EXTENSIONS.map((extension) => path.join(target, `index${extension}`)));
  for (const candidate of candidates) {
    if (!isInside(root, candidate)) continue;
    try {
      if (!(await fs.stat(candidate)).isFile()) continue;
      return { absolute: candidate, relative: path.relative(root, candidate).split(path.sep).join("/") };
    } catch { /* Try the next extension. */ }
  }
  return null;
}

export async function transformWorkspaceModule(source: string, name: string): Promise<string> {
  const loader = loaderForName(name) || "js";
  return loader === "js" ? source : transformModule(source, loader, name);
}

function transformModule(source: string, loader: Loader, sourcefile: string): Promise<string> {
  return transform(source, {
    loader,
    sourcefile,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    sourcemap: "inline",
    legalComments: "none",
  }).then((result) => result.code);
}

function rewriteProjectRootUrls(document: Document): void {
  for (const node of findElements(document)) {
    for (const attributeName of ["src", "href", "poster"]) {
      const value = attribute(node, attributeName);
      if (value?.startsWith("/") && !value.startsWith("//") && !(node.tagName === "a" && attributeName === "href")) {
        setAttribute(node, attributeName, `.${value}`);
      }
    }
    const srcset = attribute(node, "srcset");
    if (srcset) setAttribute(node, "srcset", srcset.split(",").map((part) => part.trim().replace(/^\/(?!\/)/, "./")).join(", "));
  }
}

function findElements(root: Node, tagName?: string): Element[] {
  const result: Element[] = [];
  const visit = (node: Node) => {
    if (isElement(node)) {
      if (!tagName || node.tagName === tagName) result.push(node);
      if (node.tagName === "template" && "content" in node) visit(node.content);
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return result;
}

function isElement(node: Node): node is Element { return "tagName" in node; }
function attribute(node: Element, name: string): string | undefined { return node.attrs.find((item) => item.name === name)?.value; }
function setAttribute(node: Element, name: string, value: string): void {
  const current = node.attrs.find((item) => item.name === name);
  if (current) current.value = value;
  else node.attrs.push({ name, value });
}
function element(tagName: string, attrs: Array<{ name: string; value: string }> = []): Element {
  return defaultTreeAdapter.createElement(tagName, parse5Html.NS.HTML, attrs);
}
function elementText(node: Element): string {
  return node.childNodes.map((child) => child.nodeName === "#text" && "value" in child ? child.value : "").join("");
}
function setElementText(node: Element, value: string): void {
  node.childNodes = [];
  defaultTreeAdapter.insertText(node, value);
}

function normalizeLanguage(language: string): string { return language.trim().toLowerCase() || "html"; }
function loaderForLanguage(language: string): Loader {
  return language === "typescript" || language === "ts" ? "ts" : language === "tsx" ? "tsx" : language === "jsx" ? "jsx" : "js";
}
function loaderForName(name: string): Loader | null {
  const extension = path.extname(stripQueryAndHash(name)).toLowerCase();
  return extension === ".ts" || extension === ".mts" || extension === ".cts" ? "ts"
    : extension === ".tsx" ? "tsx"
    : extension === ".jsx" ? "jsx"
    : extension === ".js" || extension === ".mjs" || extension === ".cjs" ? "js"
    : null;
}
function isBareSpecifier(value: string): boolean {
  return Boolean(value) && !isLocalSpecifier(value) && !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(value);
}
function isLocalSpecifier(value: string): boolean { return value.startsWith("./") || value.startsWith("../") || value.startsWith("/"); }
function isRemoteSpecifier(value: string): boolean { return /^https?:\/\//i.test(value); }
function stripQueryAndHash(value: string): string { return value.split(/[?#]/, 1)[0] || ""; }
function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function escapeClosingTag(value: string, tag: "script" | "style"): string { return value.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`); }
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function emptyGraph(): PreviewGraphSummary { return { moduleCount: 0, localModuleCount: 0, packages: [] }; }

const BASE_STYLE = `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;color:var(--color-text,#292620);background:var(--color-canvas,#f5f0e5);font:14px/1.55 var(--font-body,system-ui,-apple-system,sans-serif)}.grok-preview-placeholder,.preview-root{padding:18px}button,input,select,textarea{font:inherit}img,svg,video,canvas{max-width:100%;height:auto}`;
const EMBED_STYLE = `:root{color-scheme:light dark}*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent;color:var(--color-text,inherit);font-family:var(--font-body,inherit)}`;
const SCRIPT_BODY = `<main id="app"><div class="grok-preview-placeholder"><h2>JavaScript Preview</h2><p>Use <code>document.getElementById('app')</code> to render here.</p></div></main>`;
const SAMPLE_BODY = `<main id="app" class="preview-root"><h2>Preview</h2><p>Typography, controls and tables render here.</p><p><button>Button</button> <input placeholder="Input"> <select><option>Option</option></select></p><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Sample</td><td>42</td></tr></tbody></table></main>`;
