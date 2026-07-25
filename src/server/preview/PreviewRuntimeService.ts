import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PreviewGraphSummary, PreviewPrepareRequest, PreviewPrepareResponse } from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";
import { buildPreviewDocument, resolveWorkspaceModule, transformWorkspaceModule } from "./previewDocument.js";

const RUNTIME_VERSION = 3;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 256;
const MAX_TRANSFORMED_MODULES = 512;
const PRUNE_EVERY_PREPARES = 8;
const PRUNE_INTERVAL_MS = 5_000;

interface PreviewManifest {
  version: number;
  hash: string;
  workspace: string;
  createdAt: string;
  sizeBytes: number;
  graph: PreviewGraphSummary;
}

interface TransformedModuleEntry {
  modifiedMs: number;
  size: number;
  body: string;
  etag: string;
}

export type PreviewAsset =
  | { kind: "file"; file: string; contentType: string; cacheControl: string }
  | { kind: "body"; body: string; contentType: string; cacheControl: string; etag: string };

export class PreviewRuntimeService {
  readonly #manifestCache = new Map<string, PreviewManifest>();
  readonly #transformedModules = new Map<string, TransformedModuleEntry>();
  readonly #entryWrites = new Map<string, Promise<void>>();
  #lastPruneAt = 0;
  #preparesSincePrune = 0;
  #pruning: Promise<void> | null = null;

  constructor(private readonly cacheDirectory: string) {}

  async prepare(input: PreviewPrepareRequest, workspace: string): Promise<PreviewPrepareResponse> {
    const started = performance.now();
    const canonicalWorkspace = await fs.realpath(path.resolve(workspace)).catch(() => path.resolve(workspace));
    const built = await buildPreviewDocument({
      language: input.language,
      source: input.source,
      embedded: input.embedded,
      workspace: canonicalWorkspace,
    });
    const hash = digest(JSON.stringify({
      version: RUNTIME_VERSION,
      language: input.language.trim().toLowerCase(),
      embedded: input.embedded,
      workspace: canonicalWorkspace,
      html: built.htmlTemplate,
      local: built.localFingerprints,
    }));
    const html = built.htmlTemplate.replaceAll("__GROK_PREVIEW_BASE__", `/preview-runtime/${hash}/`);
    const sizeBytes = Buffer.byteLength(html);
    const manifest: PreviewManifest = {
      version: RUNTIME_VERSION,
      hash,
      workspace: canonicalWorkspace,
      createdAt: new Date().toISOString(),
      sizeBytes,
      graph: built.graph,
    };
    await fs.mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 });
    const cacheHit = Boolean(await this.#manifest(hash));
    if (!cacheHit) await this.#ensureEntry(hash, html, manifest);
    await this.#pruneIfDue(hash);
    return {
      hash,
      path: `/preview-runtime/${hash}/index.html`,
      cacheHit,
      buildMs: Math.max(0, Math.round((performance.now() - started) * 10) / 10),
      sizeBytes,
      graph: built.graph,
    };
  }

  async index(hash: string): Promise<string> {
    this.#assertHash(hash);
    if (!await this.#manifest(hash)) throw new AppProblem(404, "NOT_FOUND", "Preview document not found.");
    return fs.readFile(path.join(this.cacheDirectory, hash, "index.html"), "utf8");
  }

  async asset(hash: string, requestedPath: string): Promise<PreviewAsset> {
    this.#assertHash(hash);
    const manifest = await this.#manifest(hash);
    if (!manifest) throw new AppProblem(404, "NOT_FOUND", "Preview document not found.");
    const clean = requestedPath.replace(/^\/+/, "");
    if (!clean || clean.includes("\0")) throw new AppProblem(404, "NOT_FOUND", "Preview resource not found.");
    const resolved = await resolveWorkspaceModule(manifest.workspace, "", `./${clean}`);
    if (!resolved) throw new AppProblem(404, "NOT_FOUND", "Preview resource not found.");
    const extension = path.extname(resolved.absolute).toLowerCase();
    if ([".ts", ".tsx", ".jsx", ".mts", ".cts"].includes(extension)) {
      const transformed = await this.#transformedModule(manifest, resolved.absolute, resolved.relative);
      return { kind: "body", body: transformed.body, contentType: "application/javascript; charset=utf-8", cacheControl: "no-cache", etag: transformed.etag };
    }
    return {
      kind: "file",
      file: resolved.absolute,
      contentType: contentType(extension),
      cacheControl: "no-cache",
    };
  }

  runtime(): string { return PREVIEW_RUNTIME; }

  #ensureEntry(hash: string, html: string, manifest: PreviewManifest): Promise<void> {
    const existing = this.#entryWrites.get(hash);
    if (existing) return existing;
    const writing = this.#writeEntry(hash, html, manifest).finally(() => {
      if (this.#entryWrites.get(hash) === writing) this.#entryWrites.delete(hash);
    });
    this.#entryWrites.set(hash, writing);
    return writing;
  }

  async #writeEntry(hash: string, html: string, manifest: PreviewManifest): Promise<void> {
    const target = path.join(this.cacheDirectory, hash);
    const temporary = path.join(this.cacheDirectory, `.${hash}.${randomUUID()}`);
    await fs.mkdir(temporary, { recursive: false, mode: 0o700 });
    try {
      await Promise.all([
        fs.writeFile(path.join(temporary, "index.html"), html, { mode: 0o600 }),
        fs.writeFile(path.join(temporary, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 }),
      ]);
      try {
        await fs.rename(temporary, target);
      } catch (error) {
        if (!isEntryCollision(error)) throw error;
        const existing = await this.#readManifest(hash);
        if (existing) {
          this.#rememberManifest(existing);
          return;
        }
        await fs.rm(target, { recursive: true, force: true });
        try {
          await fs.rename(temporary, target);
        } catch (replacementError) {
          if (!isEntryCollision(replacementError)) throw replacementError;
          const raced = await this.#readManifest(hash);
          if (!raced) throw replacementError;
          this.#rememberManifest(raced);
          return;
        }
      }
      this.#rememberManifest(manifest);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  async #manifest(hash: string): Promise<PreviewManifest | null> {
    if (!HASH_PATTERN.test(hash)) return null;
    const cached = this.#manifestCache.get(hash);
    if (cached) {
      this.#manifestCache.delete(hash);
      this.#manifestCache.set(hash, cached);
      return cached;
    }
    const manifest = await this.#readManifest(hash);
    if (manifest) this.#rememberManifest(manifest);
    return manifest;
  }

  async #readManifest(hash: string): Promise<PreviewManifest | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(this.cacheDirectory, hash, "manifest.json"), "utf8")) as unknown;
      if (!isManifest(parsed) || parsed.hash !== hash || parsed.version !== RUNTIME_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  #rememberManifest(manifest: PreviewManifest): void {
    this.#manifestCache.delete(manifest.hash);
    this.#manifestCache.set(manifest.hash, manifest);
    while (this.#manifestCache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.#manifestCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#manifestCache.delete(oldest);
    }
  }

  async #transformedModule(manifest: PreviewManifest, absolute: string, relative: string): Promise<TransformedModuleEntry> {
    const stat = await fs.stat(absolute);
    const key = `${manifest.workspace}\0${relative}`;
    const cached = this.#transformedModules.get(key);
    if (cached && cached.modifiedMs === stat.mtimeMs && cached.size === stat.size) {
      this.#transformedModules.delete(key);
      this.#transformedModules.set(key, cached);
      return cached;
    }
    const source = await fs.readFile(absolute, "utf8");
    const body = await transformWorkspaceModule(source, relative);
    const transformed = { modifiedMs: stat.mtimeMs, size: stat.size, body, etag: `"${digest(body)}"` };
    this.#transformedModules.delete(key);
    this.#transformedModules.set(key, transformed);
    while (this.#transformedModules.size > MAX_TRANSFORMED_MODULES) {
      const oldest = this.#transformedModules.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#transformedModules.delete(oldest);
    }
    return transformed;
  }

  async #pruneIfDue(keepHash: string): Promise<void> {
    this.#preparesSincePrune += 1;
    const now = Date.now();
    const due = this.#lastPruneAt === 0
      || this.#preparesSincePrune >= PRUNE_EVERY_PREPARES
      || now - this.#lastPruneAt >= PRUNE_INTERVAL_MS;
    if (!due) return;
    if (this.#pruning) {
      await this.#pruning;
      return;
    }
    this.#lastPruneAt = now;
    this.#preparesSincePrune = 0;
    const pruning = this.#prune(keepHash).catch(() => undefined).finally(() => {
      if (this.#pruning === pruning) this.#pruning = null;
    });
    this.#pruning = pruning;
    await pruning;
  }

  async #prune(keepHash: string): Promise<void> {
    let names: string[];
    try { names = (await fs.readdir(this.cacheDirectory)).filter((name) => HASH_PATTERN.test(name)); }
    catch { return; }
    const inspected = await Promise.all(names.map(async (name) => {
      const manifest = await this.#readManifest(name);
      if (!manifest) return { name, invalid: true as const };
      this.#rememberManifest(manifest);
      const stat = await fs.stat(path.join(this.cacheDirectory, name)).catch(() => null);
      return stat ? { name, invalid: false as const, size: manifest.sizeBytes, modified: stat.mtimeMs } : null;
    }));
    const invalid = inspected.filter((entry): entry is { name: string; invalid: true } => Boolean(entry?.invalid));
    await Promise.all(invalid.map(async ({ name }) => {
      if (name === keepHash) return;
      this.#manifestCache.delete(name);
      await fs.rm(path.join(this.cacheDirectory, name), { recursive: true, force: true });
    }));
    const entries = inspected.filter((entry): entry is { name: string; invalid: false; size: number; modified: number } => Boolean(entry && !entry.invalid));
    let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    let count = entries.length;
    for (const entry of entries.sort((left, right) => left.modified - right.modified)) {
      if (count <= MAX_CACHE_ENTRIES && bytes <= MAX_CACHE_BYTES) break;
      if (entry.name === keepHash) continue;
      await fs.rm(path.join(this.cacheDirectory, entry.name), { recursive: true, force: true });
      this.#manifestCache.delete(entry.name);
      bytes -= entry.size;
      count -= 1;
    }
  }

  #assertHash(hash: string): void {
    if (!HASH_PATTERN.test(hash)) throw new AppProblem(404, "NOT_FOUND", "Preview document not found.");
  }
}

function isManifest(value: unknown): value is PreviewManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.version === "number" && typeof item.hash === "string" && typeof item.workspace === "string"
    && typeof item.createdAt === "string" && typeof item.sizeBytes === "number"
    && Boolean(item.graph) && typeof item.graph === "object";
}

function isEntryCollision(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EEXIST" || code === "ENOTEMPTY";
}

function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

function contentType(extension: string): string {
  return ({
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8", ".cjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".wasm": "application/wasm", ".gltf": "model/gltf+json", ".glb": "model/gltf-binary",
    ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

const PREVIEW_RUNTIME = String.raw`(()=>{
  const channel='grok-build-preview';
  const query=new URLSearchParams(location.search);
  const id=query.get('instance')||'preview';
  const send=(type,value)=>parent.postMessage({channel,id,type,value},'*');
  const themeListeners=new Set(),visibilityListeners=new Set(),disposeListeners=new Set();
  let theme={appearance:'light',variables:{}},hostVisible=true,visible=true,disposed=false,lastHeight=-1;
  const text=value=>{try{return typeof value==='string'?value:JSON.stringify(value)}catch{return String(value)}};
  const notify=(listeners,value)=>listeners.forEach(listener=>{try{listener(value)}catch(error){send('console','error: '+text(error))}});
  const contentHeight=()=>{
    const body=document.body;
    if(!body)return 1;
    const top=body.getBoundingClientRect().top;
    let height=body.offsetHeight;
    for(const child of body.children){
      const rect=child.getBoundingClientRect();
      height=Math.max(height,rect.top-top+Math.max(rect.height,child.scrollHeight));
    }
    return Math.max(1,Math.ceil(height));
  };
  const resize=()=>{
    if(disposed)return;
    const height=contentHeight();
    if(height===lastHeight)return;
    lastHeight=height;
    send('resize',{height,viewport:innerHeight});
  };
  const applyTheme=value=>{
    if(!value||typeof value!=='object')return;
    theme=value;
    const root=document.documentElement;
    root.dataset.appearance=value.appearance||'light';
    root.style.colorScheme=value.appearance||'light';
    if(value.variables&&typeof value.variables==='object')for(const [name,token] of Object.entries(value.variables))root.style.setProperty(name,String(token));
    notify(themeListeners,theme);resize();
  };
  const refreshVisible=()=>{const next=hostVisible&&document.visibilityState!=='hidden';if(next===visible)return;visible=next;notify(visibilityListeners,visible)};
  const setVisible=value=>{hostVisible=Boolean(value);refreshVisible()};
  const dispose=()=>{if(disposed)return;disposed=true;observer.disconnect();notify(disposeListeners);themeListeners.clear();visibilityListeners.clear();disposeListeners.clear()};
  const subscribe=(set,listener)=>{if(typeof listener!=='function')return()=>{};set.add(listener);return()=>set.delete(listener)};
  const packageUrl=specifier=>'https://esm.sh/'+String(specifier);
  const api={
    version:'1',
    get theme(){return theme},
    get visible(){return visible},
    onThemeChange:listener=>subscribe(themeListeners,listener),
    onVisibilityChange:listener=>subscribe(visibilityListeners,listener),
    onDispose:listener=>subscribe(disposeListeners,listener),
    resize,
    resolvePackage:packageUrl,
    import:specifier=>import(packageUrl(specifier))
  };
  Object.defineProperty(globalThis,'grokPreview',{value:api,configurable:true});
  for(const level of ['log','info','warn','error']){
    const original=console[level].bind(console);
    console[level]=(...args)=>{send('console',level+': '+args.map(text).join(' '));original(...args)};
  }
  addEventListener('message',event=>{
    const message=event.data;
    if(event.source!==parent||!message||message.channel!=='grok-build-preview-control'||message.id!==id)return;
    if(message.type==='theme')applyTheme(message.value);
    else if(message.type==='visibility')setVisible(message.value);
    else if(message.type==='dispose')dispose();
  });
  document.addEventListener('visibilitychange',refreshVisible);
  addEventListener('error',event=>{
    const target=event.target;
    const resource=target&&target!==window&&(target.currentSrc||target.src||target.href);
    if(!resource){send('console','error: '+(event.message||'runtime error'));return}
    queueMicrotask(()=>{if(typeof target.onerror!=='function'&&!event.defaultPrevented&&target.isConnected)send('console','error: resource '+resource)});
  },true);
  addEventListener('unhandledrejection',event=>send('console','error: unhandled rejection '+text(event.reason)));
  const observer=new ResizeObserver(resize);
  const ready=()=>{if(document.body)observer.observe(document.body);send('ready',{version:api.version});resize()};
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',ready,{once:true});else queueMicrotask(ready);
  addEventListener('load',resize,true);
  requestAnimationFrame(resize);
})();`;
