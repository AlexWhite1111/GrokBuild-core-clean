import type { SpiceAnalysisKind, SpiceDiagnostic, SpiceMeasurement, SpicePlot, SpiceVector } from "../../shared/contracts.js";

const MAX_PLOTS = 6;
const MAX_TRACES = 24;
const MAX_POINTS = 1_200;

interface RawVariable { name: string; type: string }
interface ComplexValue { real: number; imaginary: number | null }

export function parseSpiceRawFile(source: string): SpicePlot[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const plots: SpicePlot[] = [];
  let cursor = 0;
  while (cursor < lines.length && plots.length < MAX_PLOTS) {
    while (cursor < lines.length && !/^Title:\s*/i.test(lines[cursor])) cursor += 1;
    if (cursor >= lines.length) break;
    const header = new Map<string, string>();
    while (cursor < lines.length && !/^Variables:\s*$/i.test(lines[cursor].trim())) {
      const match = /^([^:]+):\s*(.*)$/.exec(lines[cursor]);
      if (match) header.set(match[1].trim().toLowerCase(), match[2].trim());
      cursor += 1;
    }
    if (cursor >= lines.length) break;
    cursor += 1;
    const variables: RawVariable[] = [];
    while (cursor < lines.length && !/^Values:\s*$/i.test(lines[cursor].trim())) {
      const match = /^\s*\d+\s+([^\s]+)\s+([^\s]+)\s*$/.exec(lines[cursor]);
      if (match) variables.push({ name: match[1], type: match[2] });
      cursor += 1;
    }
    if (cursor >= lines.length || !variables.length) continue;
    cursor += 1;
    const rows: ComplexValue[][] = [];
    while (cursor < lines.length && !/^Title:\s*/i.test(lines[cursor])) {
      if (!lines[cursor].trim()) { cursor += 1; continue; }
      const first = /^\s*\d+\s+(.+?)\s*$/.exec(lines[cursor]);
      if (!first) { cursor += 1; continue; }
      const row: ComplexValue[] = [parseRawValue(first[1])];
      cursor += 1;
      while (row.length < variables.length && cursor < lines.length) {
        if (/^Title:\s*/i.test(lines[cursor])) break;
        const value = lines[cursor].trim();
        cursor += 1;
        if (value) row.push(parseRawValue(value));
      }
      if (row.length === variables.length) rows.push(row);
    }
    if (!rows.length) continue;
    const sampled = sampleRows(rows, MAX_POINTS);
    const vectors = variables.slice(0, MAX_TRACES + 1).map((variable, index) => vector(variable, sampled.map((row) => row[index])));
    const scale = vectors[0];
    if (!scale) continue;
    const name = header.get("plotname") || `Plot ${plots.length + 1}`;
    if (/^constants?$/i.test(name)) continue;
    plots.push({
      id: `plot-${plots.length + 1}`,
      name,
      analysis: analysisKind(name),
      pointCount: Number.parseInt(header.get("no. points") || "", 10) || rows.length,
      scale,
      traces: vectors.slice(1),
    });
  }
  return plots;
}

export function parseSpiceMeasurements(log: string): SpiceMeasurement[] {
  const measurements: SpiceMeasurement[] = [];
  const names = new Set<string>();
  for (const line of log.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][\w.$-]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:\s+([A-Za-zµΩ°/%]+))?(?:\s+.*)?$/i.exec(line);
    if (!match || names.has(match[1].toLowerCase())) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    names.add(match[1].toLowerCase());
    const unit = /^(?:at|from|to)$/i.test(match[3] || "") ? "" : match[3] || "";
    measurements.push({ name: match[1], value, unit });
  }
  return measurements.slice(0, 128);
}

export function parseSpiceDiagnostics(log: string): SpiceDiagnostic[] {
  const diagnostics: SpiceDiagnostic[] = [];
  const seen = new Set<string>();
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
    if (/comments and warnings go to log-file/i.test(line)) continue;
    if (!line || !/(?:fatal|error|warning|failed|singular matrix|timestep too small|no such)/i.test(line)) continue;
    const normalized = line.replace(/^\*+\s*/, "").slice(0, 600);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const lineNumber = /(?:on|at)?\s*line\s+(\d+)/i.exec(normalized);
    diagnostics.push({
      severity: /(?:fatal|error|failed|singular matrix|timestep too small|no such)/i.test(normalized) ? "error" : "warning",
      message: normalized,
      line: lineNumber ? Number(lineNumber[1]) : null,
    });
  }
  return diagnostics.slice(0, 128);
}

function parseRawValue(value: string): ComplexValue {
  const parts = value.split(",", 2);
  const real = finite(parts[0]);
  const imaginary = parts.length > 1 ? finite(parts[1]) : null;
  return { real, imaginary };
}

function finite(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function vector(variable: RawVariable, values: ComplexValue[]): SpiceVector {
  const imaginary = values.some((value) => value.imaginary !== null) ? values.map((value) => value.imaginary || 0) : null;
  return {
    name: variable.name,
    unit: unitFor(variable.type, variable.name),
    real: values.map((value) => value.real),
    imaginary,
  };
}

function unitFor(type: string, name: string): string {
  const normalized = type.toLowerCase();
  if (normalized === "time") return "s";
  if (normalized === "frequency") return "Hz";
  if (normalized === "voltage" || /^v\(/i.test(name)) return "V";
  if (normalized === "current" || /^i\(/i.test(name) || /#branch$/i.test(name)) return "A";
  if (normalized === "capacitance") return "F";
  if (normalized === "temperature") return "°C";
  return normalized || "value";
}

function analysisKind(name: string): SpiceAnalysisKind {
  const value = name.toLowerCase();
  if (value.includes("transient")) return "tran";
  if (value.includes("operating point") || value.includes("op analysis")) return "op";
  if (value.includes("ac analysis")) return "ac";
  if (value.includes("dc transfer") || value.includes("dc analysis")) return "dc";
  if (value.includes("noise")) return "noise";
  if (value.includes("transfer function")) return "tf";
  if (value.includes("pole-zero")) return "pz";
  if (value.includes("fourier")) return "four";
  if (value.includes("sensitivity")) return "sens";
  return "unknown";
}

function sampleRows(rows: ComplexValue[][], limit: number): ComplexValue[][] {
  if (rows.length <= limit) return rows;
  const result: ComplexValue[][] = [rows[0]];
  const bucket = (rows.length - 2) / (limit - 2);
  const spans = vectorSpans(rows);
  let selected = 0;
  for (let output = 0; output < limit - 2; output += 1) {
    const rangeStart = Math.floor(output * bucket) + 1;
    const rangeEnd = Math.min(rows.length - 1, Math.floor((output + 1) * bucket) + 1);
    const averageStart = Math.floor((output + 1) * bucket) + 1;
    const averageEnd = Math.min(rows.length, Math.floor((output + 2) * bucket) + 1);
    const average = averageRow(rows, averageStart, averageEnd);
    let best = rangeStart; let bestArea = -1;
    for (let candidate = rangeStart; candidate < rangeEnd; candidate += 1) {
      const area = multivectorArea(rows[selected], rows[candidate], average, spans);
      if (area > bestArea) { bestArea = area; best = candidate; }
    }
    result.push(rows[best]);
    selected = best;
  }
  result.push(rows.at(-1)!);
  return result;
}

function vectorSpans(rows: ComplexValue[][]): Array<{ real: number; imaginary: number }> {
  return rows[0].map((_, vector) => {
    let realMin = Infinity; let realMax = -Infinity; let imaginaryMin = Infinity; let imaginaryMax = -Infinity;
    for (const row of rows) {
      const value = row[vector];
      if (!value) continue;
      realMin = Math.min(realMin, value.real); realMax = Math.max(realMax, value.real);
      if (value.imaginary !== null) { imaginaryMin = Math.min(imaginaryMin, value.imaginary); imaginaryMax = Math.max(imaginaryMax, value.imaginary); }
    }
    return { real: Math.max(Number.EPSILON, realMax - realMin), imaginary: Math.max(Number.EPSILON, imaginaryMax - imaginaryMin) };
  });
}

function averageRow(rows: ComplexValue[][], start: number, end: number): ComplexValue[] {
  const from = Math.min(start, rows.length - 1); const to = Math.max(from + 1, Math.min(end, rows.length));
  return rows[0].map((_, vector) => {
    let real = 0; let imaginary = 0; let complex = false;
    for (let index = from; index < to; index += 1) {
      real += rows[index][vector]?.real || 0;
      if (rows[index][vector]?.imaginary !== null) { imaginary += rows[index][vector]?.imaginary || 0; complex = true; }
    }
    return { real: real / (to - from), imaginary: complex ? imaginary / (to - from) : null };
  });
}

function multivectorArea(anchor: ComplexValue[], candidate: ComplexValue[], average: ComplexValue[], spans: Array<{ real: number; imaginary: number }>): number {
  const ax = anchor[0]?.real || 0; const bx = candidate[0]?.real || 0; const cx = average[0]?.real || 0;
  let area = 0;
  for (let vector = 1; vector < candidate.length; vector += 1) {
    const a = anchor[vector]; const b = candidate[vector]; const c = average[vector];
    if (!a || !b || !c) continue;
    area += Math.abs((ax - cx) * (b.real - a.real) - (ax - bx) * (c.real - a.real)) / spans[vector].real;
    if (a.imaginary !== null || b.imaginary !== null || c.imaginary !== null) {
      area += Math.abs((ax - cx) * ((b.imaginary || 0) - (a.imaginary || 0)) - (ax - bx) * ((c.imaginary || 0) - (a.imaginary || 0))) / spans[vector].imaginary;
    }
  }
  return area;
}
