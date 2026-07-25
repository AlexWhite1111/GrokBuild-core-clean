import { isSpiceNetlistSource } from "../../shared/contracts.js";

export type StaticPreviewKind = "mermaid" | "svg" | "dot" | "spice" | "json" | "jsonc" | "jsonl" | "yaml" | "toml" | "csv" | "tsv" | "notebook";
type ExecuteKind = "web" | "python" | "spice" | "shell";

export interface CodeCapability {
  language: string;
  preview?: StaticPreviewKind;
  execute?: ExecuteKind;
  defaultView: "source" | "preview";
}

const aliases: Record<string, Omit<CodeCapability, "language">> = {
  mermaid: { preview: "mermaid", defaultView: "preview" }, mmd: { preview: "mermaid", defaultView: "preview" },
  svg: { preview: "svg", defaultView: "preview" },
  dot: { preview: "dot", defaultView: "preview" }, gv: { preview: "dot", defaultView: "preview" }, graphviz: { preview: "dot", defaultView: "preview" },
  json: { preview: "json", defaultView: "preview" }, geojson: { preview: "json", defaultView: "preview" },
  jsonc: { preview: "jsonc", defaultView: "preview" }, jsonl: { preview: "jsonl", defaultView: "preview" }, ndjson: { preview: "jsonl", defaultView: "preview" },
  yaml: { preview: "yaml", defaultView: "preview" }, yml: { preview: "yaml", defaultView: "preview" },
  toml: { preview: "toml", defaultView: "preview" },
  csv: { preview: "csv", defaultView: "preview" }, tsv: { preview: "tsv", defaultView: "preview" },
  ipynb: { preview: "notebook", defaultView: "preview" }, notebook: { preview: "notebook", defaultView: "preview" },
  spice: { preview: "spice", execute: "spice", defaultView: "preview" }, ngspice: { preview: "spice", execute: "spice", defaultView: "preview" },
  ltspice: { preview: "spice", execute: "spice", defaultView: "preview" }, cir: { preview: "spice", execute: "spice", defaultView: "preview" },
  netlist: { preview: "spice", execute: "spice", defaultView: "preview" }, net: { preview: "spice", execute: "spice", defaultView: "preview" },
  sp: { preview: "spice", execute: "spice", defaultView: "preview" }, spi: { preview: "spice", execute: "spice", defaultView: "preview" }, ckt: { preview: "spice", execute: "spice", defaultView: "preview" },
  html: { execute: "web", defaultView: "preview" }, htm: { execute: "web", defaultView: "preview" },
  javascript: { execute: "web", defaultView: "preview" }, js: { execute: "web", defaultView: "preview" },
  typescript: { execute: "web", defaultView: "preview" }, ts: { execute: "web", defaultView: "preview" },
  tsx: { execute: "web", defaultView: "preview" }, jsx: { execute: "web", defaultView: "preview" },
  css: { execute: "web", defaultView: "preview" },
  python: { execute: "python", defaultView: "source" }, py: { execute: "python", defaultView: "source" },
  bash: { execute: "shell", defaultView: "source" }, sh: { execute: "shell", defaultView: "source" },
  zsh: { execute: "shell", defaultView: "source" }, shell: { execute: "shell", defaultView: "source" },
};

export function codeCapability(language?: string, source = ""): CodeCapability {
  const normalized = (language || "text").trim().toLowerCase();
  if ((normalized === "text" || normalized === "plaintext") && isSpiceNetlistSource(source)) return { language: "spice", ...aliases.spice };
  return { language: normalized, ...(aliases[normalized] || { defaultView: "source" as const }) };
}
