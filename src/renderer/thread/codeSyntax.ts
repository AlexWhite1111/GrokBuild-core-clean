import highlight from "highlight.js/lib/common";

highlight.registerLanguage("spice", (hljs) => ({
  name: "SPICE",
  aliases: ["ngspice", "ltspice", "cir", "netlist", "net", "sp", "spi", "ckt"],
  case_insensitive: true,
  contains: [
    { scope: "comment", begin: /^\s*\*/, end: /$/ },
    { scope: "comment", begin: /[$;].*$/ },
    { scope: "keyword", begin: /^\s*\.(?:op|tran|ac|dc|noise|tf|pz|four|sens)\b/ },
    { scope: "meta", begin: /^\s*\.(?:model|subckt|ends|include|lib|param|func|temp|options|ic|nodeset|save|print|plot|measure|meas|control|endc|end)\b/ },
    { scope: "title", begin: /^\s*[RCLVIDQMJZXEFGHBSTWKUOY][\w.$-]*/ },
    { scope: "variable", begin: /\b(?:v|i|vm|vp|vdb|vr|vi)\([^)]*\)/ },
    { scope: "literal", begin: /\b(?:pulse|pwl|sin|exp|sffm|am|dc|ac)\s*\(/ },
    { scope: "string", begin: /["']/, end: /["']/ },
    hljs.NUMBER_MODE,
  ],
}));

const languageAliases: Record<string, string> = {
  htm: "xml",
  html: "xml",
  svg: "xml",
  geojson: "json",
  jsonc: "json",
  jsonl: "json",
  ndjson: "json",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  shellscript: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  cs: "csharp",
  md: "markdown",
  tex: "latex",
  toml: "ini",
  ngspice: "spice",
  ltspice: "spice",
  cir: "spice",
  netlist: "spice",
  net: "spice",
  sp: "spice",
  spi: "spice",
  ckt: "spice",
};

export function highlightCodeSource(code: string, language?: string): string {
  const normalized = language?.trim().toLowerCase() || "plaintext";
  const resolved = languageAliases[normalized] || normalized;
  try {
    return highlight.getLanguage(resolved)
      ? highlight.highlight(code, { language: resolved, ignoreIllegals: true }).value
      : highlight.highlightAuto(code).value;
  } catch {
    return highlight.highlight(code, { language: "plaintext" }).value;
  }
}
