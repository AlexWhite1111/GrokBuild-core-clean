import { parser as javascriptParser } from "@lezer/javascript";

type SyntaxNodeLike = {
  name: string;
  firstChild: SyntaxNodeLike | null;
  nextSibling: SyntaxNodeLike | null;
  getChild(name: string): SyntaxNodeLike | null;
};

const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration"]);
const REMOTE_MODULE_URL = /https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdn\.skypack\.dev)\/[^\s"'`<>\\)]+/g;

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

/** Import-map fallback for CDN modules whose own source uses bare package imports. */
export function previewRemoteImportMap(source: string): string {
  if (/<script\b[^>]*\btype\s*=\s*["']importmap["']/i.test(source)) return "";
  const packages = new Set<string>();
  const aliases = new Map<string, string>();
  for (const match of source.matchAll(REMOTE_MODULE_URL)) collectRemotePreviewAlias(match[0], packages, aliases);
  for (const specifier of importedSpecifiers(source)) {
    if (isBareSpecifier(specifier)) packages.add(specifier);
  }
  const imports: Record<string, string> = Object.fromEntries([...aliases.entries()].sort(([left], [right]) => left.localeCompare(right)));
  for (const specifier of [...packages].sort()) imports[specifier] ??= previewPackageUrl(specifier);
  return Object.keys(imports).length
    ? `<script type="importmap">${JSON.stringify({ imports }).replace(/</g, "\\u003c")}</script>`
    : "";
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

function importedSpecifiers(source: string): string[] {
  const result: string[] = [];
  const pattern = /\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"'\r\n]+)["']/g;
  for (const match of source.matchAll(pattern)) result.push(match[1]);
  return result;
}

function isBareSpecifier(value: string): boolean {
  return Boolean(value) && !value.startsWith("./") && !value.startsWith("../") && !value.startsWith("/")
    && !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(value);
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
