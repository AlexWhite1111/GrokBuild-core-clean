import type { SpiceAnalysis, SpiceAnalysisKind, SpiceComponent, SpiceDiagnostic, SpiceNetlistSummary } from "./contracts/spice.js";

const TWO_NODE = new Set(["r", "c", "l", "v", "i", "d", "b"]);
const THREE_NODE = new Set(["q", "j", "z", "u"]);
const FOUR_NODE = new Set(["m", "e", "g", "s", "w", "t", "o", "y"]);
const ANALYSES = new Set<SpiceAnalysisKind>(["op", "tran", "ac", "dc", "noise", "tf", "pz", "four", "sens"]);

interface LogicalLine { text: string; line: number }

export function parseSpiceNetlist(source: string): SpiceNetlistSummary {
  const lines = logicalLines(source);
  const firstPhysical = source.replace(/^\uFEFF/, "").split(/\r?\n/).findIndex((line) => line.trim().length > 0) + 1;
  const titleLine = lines.find((line) => line.line === firstPhysical);
  const title = titleLine?.text.trim() || "SPICE Netlist";
  const components: SpiceComponent[] = [];
  const analyses: SpiceAnalysis[] = [];
  const models = new Set<string>();
  const subcircuits = new Set<string>();
  const nodes = new Map<string, string>();
  const diagnostics: SpiceDiagnostic[] = [];
  let control = false;
  let hasEnd = false;
  let hasExternalReferences = false;

  for (const line of lines) {
    const text = line.text.trim();
    if (!text || text.startsWith("*") || line.line === firstPhysical) continue;
    if (text.startsWith(".")) {
      const tokens = tokenize(text);
      const directive = (tokens[0] || "").slice(1).toLowerCase();
      if (directive === "control") { control = true; continue; }
      if (directive === "endc") { control = false; continue; }
      if (control) continue;
      if (directive === "end") { hasEnd = true; continue; }
      if (ANALYSES.has(directive as SpiceAnalysisKind)) analyses.push({ kind: directive as SpiceAnalysisKind, directive: text, line: line.line });
      if (directive === "model" && tokens[1]) models.add(tokens[1]);
      if (directive === "subckt" && tokens[1]) subcircuits.add(tokens[1]);
      if (directive === "include" || directive === "lib") hasExternalReferences = true;
      continue;
    }
    if (control) continue;
    const component = parseComponent(text, line.line);
    if (!component) {
      diagnostics.push({ severity: "warning", message: `Unrecognized netlist statement: ${oneLine(text)}`, line: line.line });
      continue;
    }
    components.push(component);
    for (const node of component.nodes) {
      const key = node.toLowerCase();
      if (!nodes.has(key)) nodes.set(key, node);
    }
  }

  if (titleLine && likelyComponentTitle(titleLine.text.trim(), titleLine.line)) diagnostics.push({
    severity: "warning",
    message: "The first non-empty line is the SPICE title and is not simulated. Add a title line above this component.",
    line: titleLine.line,
  });
  if (!hasEnd) diagnostics.push({ severity: "warning", message: "The netlist has no .end directive.", line: null });
  if (!analyses.length) diagnostics.push({ severity: "info", message: "No .op, .tran, .ac, .dc, .noise, .tf, .pz, .four, or .sens analysis was found.", line: null });

  return {
    title,
    components,
    nodes: [...nodes.values()].sort(nodeOrder),
    analyses,
    models: [...models],
    subcircuits: [...subcircuits],
    diagnostics,
    hasExternalReferences,
  };
}

export function isSpiceNetlistSource(source: string): boolean {
  if (!/^\s*\.end\b/im.test(source)) return false;
  const parsed = parseSpiceNetlist(source);
  return parsed.components.length >= 2 && parsed.analyses.length >= 1;
}

function logicalLines(source: string): LogicalLine[] {
  const result: LogicalLine[] = [];
  for (const [index, raw] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = index + 1;
    if (/^\s*\+/.test(raw) && result.length) {
      result[result.length - 1].text += ` ${raw.replace(/^\s*\+\s*/, "")}`;
    } else {
      result.push({ text: stripInlineComment(raw), line });
    }
  }
  return result;
}

function stripInlineComment(value: string): string {
  let quote = ""; let braces = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && (!quote || quote === char)) quote = quote ? "" : char;
    else if (!quote && char === "{") braces += 1;
    else if (!quote && char === "}") braces = Math.max(0, braces - 1);
    else if (!quote && !braces && (char === "$" || char === ";")) return value.slice(0, index);
  }
  return value;
}

function tokenize(value: string): string[] {
  const tokens: string[] = []; let token = ""; let quote = ""; let depth = 0;
  for (const char of value.trim()) {
    if ((char === "\"" || char === "'") && (!quote || quote === char)) { quote = quote ? "" : char; token += char; }
    else if (!quote && (char === "(" || char === "{" || char === "[")) { depth += 1; token += char; }
    else if (!quote && (char === ")" || char === "}" || char === "]")) { depth = Math.max(0, depth - 1); token += char; }
    else if (!quote && depth === 0 && /\s/.test(char)) { if (token) { tokens.push(token); token = ""; } }
    else token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}

function parseComponent(text: string, line: number): SpiceComponent | null {
  const tokens = tokenize(text);
  const id = tokens[0] || "";
  if (!/^[A-Za-z][^\s]*$/.test(id)) return null;
  const type = id[0].toLowerCase();
  let nodeCount = TWO_NODE.has(type) ? 2 : THREE_NODE.has(type) ? 3 : FOUR_NODE.has(type) ? 4 : type === "f" || type === "h" ? 2 : 0;
  if (type === "x") {
    const parameterIndex = tokens.findIndex((token, index) => index > 1 && (/^params?:/i.test(token) || token.includes("=")));
    const subcktIndex = (parameterIndex < 0 ? tokens.length : parameterIndex) - 1;
    nodeCount = Math.max(0, subcktIndex - 1);
  }
  if (!nodeCount && type !== "k") return null;
  if (tokens.length < nodeCount + 2 && type !== "k") return null;
  const componentNodes = tokens.slice(1, 1 + nodeCount);
  return { id, type: componentType(type), nodes: componentNodes, value: tokens.slice(1 + nodeCount).join(" "), line };
}

function componentType(prefix: string): string {
  const values: Record<string, string> = {
    r: "Resistor", c: "Capacitor", l: "Inductor", v: "Voltage source", i: "Current source", d: "Diode",
    q: "BJT", m: "MOSFET", j: "JFET", x: "Subcircuit", e: "VCVS", f: "CCCS", g: "VCCS", h: "CCVS",
    b: "Behavioral source", s: "Switch", w: "Current switch", t: "Transmission line", o: "Lossy transmission line",
    u: "Uniform RC line", y: "Transmission line", z: "MESFET", k: "Coupling",
  };
  return values[prefix] || prefix.toUpperCase();
}

function likelyComponentTitle(value: string, line: number): boolean {
  const component = parseComponent(value, line);
  if (!component) return false;
  return /\d/.test(component.id) || /^(?:[+-]?(?:\d|\.\d)|\{|dc\b|ac\b|pulse\s*\(|pwl\s*\(|sin\s*\(|exp\s*\()/i.test(component.value);
}

function nodeOrder(left: string, right: string): number {
  if (isGround(left)) return -1;
  if (isGround(right)) return 1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function isGround(node: string): boolean { return node === "0" || /^gnd!?$/i.test(node); }
function oneLine(value: string): string { return value.replace(/\s+/g, " ").trim().slice(0, 180); }
