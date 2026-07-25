export type SpiceAnalysisKind = "op" | "tran" | "ac" | "dc" | "noise" | "tf" | "pz" | "four" | "sens" | "unknown";

export interface SpiceDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line: number | null;
}

export interface SpiceComponent {
  id: string;
  type: string;
  nodes: string[];
  value: string;
  line: number;
}

export interface SpiceAnalysis {
  kind: SpiceAnalysisKind;
  directive: string;
  line: number;
}

export interface SpiceNetlistSummary {
  title: string;
  components: SpiceComponent[];
  nodes: string[];
  analyses: SpiceAnalysis[];
  models: string[];
  subcircuits: string[];
  diagnostics: SpiceDiagnostic[];
  hasExternalReferences: boolean;
}

export interface SpiceVector {
  name: string;
  unit: string;
  real: number[];
  imaginary: number[] | null;
}

export interface SpicePlot {
  id: string;
  name: string;
  analysis: SpiceAnalysisKind;
  pointCount: number;
  scale: SpiceVector;
  traces: SpiceVector[];
}

export interface SpiceMeasurement {
  name: string;
  value: number;
  unit: string;
}

export interface SpiceRunResult {
  simulator: string;
  netlist: SpiceNetlistSummary;
  plots: SpicePlot[];
  measurements: SpiceMeasurement[];
  diagnostics: SpiceDiagnostic[];
}
