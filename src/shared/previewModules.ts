import { parser as javascriptParser } from "@lezer/javascript";

type SyntaxNodeLike = {
  name: string;
  from: number;
  to: number;
  firstChild: SyntaxNodeLike | null;
  nextSibling: SyntaxNodeLike | null;
  getChild(name: string): SyntaxNodeLike | null;
};

const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration"]);
const NODE_GLOBALS = new Set(["Buffer", "__dirname", "__filename", "global", "module", "process", "require"]);
const JSX_PARSER = javascriptParser.configure({ dialect: "jsx" });
const TSX_PARSER = javascriptParser.configure({ dialect: "ts jsx" });
const WEB_LANGUAGE_ALIASES = new Map<string, PreviewCodeFamily>([
  ["html", "html"], ["htm", "html"],
  ["css", "css"],
  ["javascript", "javascript"], ["js", "javascript"],
  ["typescript", "typescript"], ["ts", "typescript"],
  ["jsx", "javascript"], ["tsx", "typescript"],
]);

export type PreviewCodeFamily = "html" | "css" | "javascript" | "typescript";

export function previewCodeFamilies(language: string, source: string): PreviewCodeFamily[] {
  const family = WEB_LANGUAGE_ALIASES.get(language.trim().toLowerCase());
  if (!family) return [];
  const families = new Set<PreviewCodeFamily>([family]);
  if (family !== "html") return [...families];
  if (/<style(?:\s|>)/i.test(source)) families.add("css");
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1].toLowerCase() || "";
    if (type === "importmap" || /json/.test(type)) continue;
    families.add(/typescript|tsx/.test(type) ? "typescript" : "javascript");
  }
  return [...families];
}

/** Browser preview is deliberately excluded for sources that require Node globals. */
export function supportsBrowserPreview(language: string, source: string): boolean {
  const normalized = language.trim().toLowerCase();
  const family = WEB_LANGUAGE_ALIASES.get(normalized);
  if (!family) return false;
  if (family === "css") return true;
  if (family === "html") {
    return [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].every((match) => {
      const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1].toLowerCase() || "";
      return type === "importmap" || /json/.test(type) || !scriptUsesNodeRuntime(match[2], /typescript|tsx/.test(type));
    });
  }
  return !scriptUsesNodeRuntime(source, normalized === "typescript" || normalized === "ts" || normalized === "tsx");
}

export function hasTopLevelAwait(source: string): boolean {
  return nodeHasTopLevelAwait(javascriptParser.parse(source).topNode, 0);
}

export function needsModuleScript(source: string): boolean {
  return hasTopLevelAwait(source) || /(?:^|[;}]|\n)\s*(?:import\s+(?!\()|export\s+)/m.test(source);
}

export function previewPackageUrl(specifier: string): string {
  return `https://esm.sh/${specifier}`;
}

export function collectRemotePreviewAlias(specifier: string, packages: Set<string>, aliases: Map<string, string>): void {
  const remote = remoteNpmPackage(specifier);
  if (!remote) return;
  packages.add(remote.name);
  const target = previewPackageUrl(`${remote.name}${remote.version ? `@${remote.version}` : ""}`);
  if (!aliases.has(remote.name) || isCanonicalRemoteEntry(remote)) {
    aliases.set(remote.name, isCanonicalRemoteEntry(remote) ? specifier : target);
  }
  if (!aliases.has(`${remote.name}/`)) aliases.set(`${remote.name}/`, `${target}/`);
}

function nodeHasTopLevelAwait(node: SyntaxNodeLike, functionDepth: number): boolean {
  const methodProperty = node.name === "Property" && Boolean(node.getChild("ParamList"));
  const nextDepth = functionDepth + (FUNCTION_NODES.has(node.name) || methodProperty ? 1 : 0);
  if (nextDepth === 0 && (node.name === "AwaitExpression" || node.name === "await")) return true;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (nodeHasTopLevelAwait(child, nextDepth)) return true;
  }
  return false;
}

function scriptUsesNodeRuntime(source: string, typed: boolean): boolean {
  const tree = (typed ? TSX_PARSER : JSX_PARSER).parse(source);
  const definitions = new Set<string>();
  const definitionCursor = tree.cursor();
  do {
    if (definitionCursor.name === "VariableDefinition") {
      definitions.add(source.slice(definitionCursor.from, definitionCursor.to));
    }
  } while (definitionCursor.next());
  const cursor = tree.cursor();
  do {
    if (cursor.name === "Hashbang" && /\bnode\b/.test(source.slice(cursor.from, cursor.to))) return true;
    if (cursor.name === "VariableName") {
      const name = source.slice(cursor.from, cursor.to);
      if (NODE_GLOBALS.has(name) && !definitions.has(name)) return true;
    }
  } while (cursor.next());
  return false;
}

function remoteNpmPackage(specifier: string): { name: string; version: string; subpath: string } | null {
  let url: URL;
  try { url = new URL(specifier); }
  catch { return null; }
  let pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (url.hostname === "cdn.jsdelivr.net") {
    if (!pathname.startsWith("npm/")) return null;
    pathname = pathname.slice(4);
  } else if (url.hostname === "esm.sh") {
    pathname = pathname.replace(/^v\d+\//, "");
  } else if (!/^(?:unpkg\.com|cdn\.skypack\.dev)$/.test(url.hostname)) return null;
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const token = parts[0].startsWith("@") ? `${parts[0]}/${parts[1] || ""}` : parts[0];
  const marker = token.lastIndexOf("@");
  const name = marker > 0 ? token.slice(0, marker) : token;
  const version = marker > 0 ? token.slice(marker + 1) : "";
  const consumed = name.startsWith("@") ? 2 : 1;
  const subpath = parts.slice(consumed).join("/");
  return /^(?:@[a-z\d_.-]+\/)?[a-z\d_.-]+$/i.test(name) ? { name, version, subpath } : null;
}

function isCanonicalRemoteEntry(remote: { name: string; subpath: string }): boolean {
  if (!remote.subpath) return true;
  const packageName = remote.name.split("/").at(-1)?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") || "";
  return new RegExp(`(?:^|/)(?:index|${packageName}(?:\\.min|\\.module|\\.esm)?)[.]m?js$`, "i").test(remote.subpath);
}
