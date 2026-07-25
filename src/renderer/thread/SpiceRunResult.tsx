import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SpicePlot, SpiceRunResult as SpiceResult, SpiceVector } from "../../shared/contracts.js";
import { Control, Text } from "../../ui/components/index.js";
import styles from "./SpiceRunResult.module.css";

const COLORS = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#fb7185", "#60a5fa", "#f472b6", "#a3e635"];

export function SpiceRunResult({ result, log, errorLog, running = false, detail = false }: { result: SpiceResult; log: string; errorLog: string; running?: boolean; detail?: boolean }) {
  const { t } = useTranslation();
  const [plotId, setPlotId] = useState(result.plots[0]?.id || "");
  const plot = result.plots.find((item) => item.id === plotId) || result.plots[0];
  useEffect(() => { if (plot?.id !== plotId) setPlotId(plot?.id || ""); }, [plot?.id, plotId]);
  return <div className={`${styles.result} ${detail ? styles.detail : ""}`}>
    {result.plots.length > 1 && <div className={styles.plotTabs}>{result.plots.map((item) => <Control key={item.id} recipe="text" density="compact" selected={item.id === plot?.id} onClick={() => setPlotId(item.id)}>{item.name}</Control>)}</div>}
    {plot ? plot.pointCount <= 1 ? <OperatingPoint plot={plot} /> : <Waveform plot={plot} /> : <div className={styles.empty}>{running ? t("spiceSimulationRunning") : t("spiceNoWaveform")}</div>}
    {result.measurements.length > 0 && <section className={styles.measurements}><Text as="strong" size="label">{t("spiceMeasurements")}</Text><div>{result.measurements.map((measurement) => <span key={measurement.name} data-shape="control"><code>{measurement.name}</code><strong>{formatEngineering(measurement.value)}{measurement.unit}</strong></span>)}</div></section>}
    {result.diagnostics.length > 0 && <section className={styles.diagnostics}>{result.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.line}:${diagnostic.message}:${index}`} data-severity={diagnostic.severity}><code>{diagnostic.line ? `L${diagnostic.line}` : diagnostic.severity}</code><span>{diagnostic.message}</span></div>)}</section>}
    {(log || errorLog) && <details className={styles.log}><summary>{t("spiceSimulatorLog")}</summary>{log && <pre data-copy-rendered data-shape="control">{log}</pre>}{errorLog && <pre data-copy-rendered data-shape="control" className={styles.errorLog}>{errorLog}</pre>}</details>}
  </div>;
}

function OperatingPoint({ plot }: { plot: SpicePlot }) {
  const { t } = useTranslation();
  return <section className={styles.operatingPoint}><Text as="strong" size="label">{plot.name}</Text><div data-shape="control"><table><thead><tr><th>{t("spiceVector")}</th><th>{t("spiceValue")}</th><th>{t("spiceUnit")}</th></tr></thead><tbody>{plot.traces.map((trace) => <tr key={trace.name}><td>{trace.name}</td><td>{trace.imaginary ? `${formatEngineering(trace.real[0] || 0)} ${formatEngineering(trace.imaginary[0] || 0)}j` : formatEngineering(trace.real[0] || 0)}</td><td>{trace.unit}</td></tr>)}</tbody></table></div></section>;
}

function Waveform({ plot }: { plot: SpicePlot }) {
  const { t } = useTranslation();
  const complex = plot.traces.some((trace) => trace.imaginary !== null);
  const [mode, setMode] = useState<TraceMode>(complex ? "magnitude" : "real");
  const [selected, setSelected] = useState<Set<string>>(() => initialTraces(plot));
  const [domain, setDomain] = useState<[number, number]>([0, 1]);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    setMode(plot.traces.some((trace) => trace.imaginary !== null) ? "magnitude" : "real");
    setSelected(initialTraces(plot));
    setDomain([0, 1]);
    setHover(null);
  }, [plot.id]);
  const traces = plot.traces.filter((trace) => selected.has(trace.name));
  const groups = useMemo(() => groupTraces(traces, mode), [mode, traces]);
  const reset = () => { setDomain([0, 1]); setHover(null); };
  return <section className={styles.waveform}>
    <div className={styles.waveformHeader}>
      <div><Text as="strong" size="label">{plot.name}</Text><Text as="span" tone="muted" size="caption">{plot.pointCount.toLocaleString()} {t("spicePoints")}</Text></div>
      {complex && <div className={styles.mode}>{(["magnitude", "phase", "real"] as const).map((value) => <Control key={value} recipe="text" density="compact" selected={mode === value} onClick={() => setMode(value)}>{t(`spiceMode_${value}`)}</Control>)}</div>}
    </div>
    <div className={styles.legend}>{plot.traces.map((trace, index) => <button key={trace.name} type="button" data-selected={selected.has(trace.name) || undefined} onClick={() => setSelected((current) => toggleTrace(current, trace.name))}>
      <i style={{ background: COLORS[index % COLORS.length] }} /><span>{trace.name}</span><small>{modeUnit(trace, mode)}</small>
    </button>)}</div>
    <div className={styles.charts} onDoubleClick={reset}>
      {groups.map(([unit, values]) => <ChartPanel key={unit} plot={plot} traces={values} allTraces={plot.traces} mode={mode} unit={unit} domain={domain} onDomain={setDomain} hover={hover} onHover={setHover} />)}
    </div>
    <Text as="div" tone="muted" size="caption" className={styles.hint}>{t("spiceWaveformHint")}</Text>
  </section>;
}

function ChartPanel({ plot, traces, allTraces, mode, unit, domain, onDomain, hover, onHover }: {
  plot: SpicePlot; traces: SpiceVector[]; allTraces: SpiceVector[]; mode: TraceMode; unit: string;
  domain: [number, number]; onDomain: (value: [number, number]) => void; hover: number | null; onHover: (value: number | null) => void;
}) {
  const drag = useRef<{ x: number; domain: [number, number] } | null>(null);
  const width = 900; const height = 260; const left = 68; const right = 20; const top = 18; const bottom = 38;
  const count = Math.min(plot.scale.real.length, ...traces.map((trace) => trace.real.length));
  const first = Math.max(0, Math.floor(domain[0] * Math.max(0, count - 1)));
  const last = Math.max(first + 1, Math.min(count - 1, Math.ceil(domain[1] * Math.max(0, count - 1))));
  const transformed = traces.map((trace) => ({ trace, values: transform(trace, mode) }));
  const yValues = transformed.flatMap(({ values }) => values.slice(first, last + 1).filter(Number.isFinite));
  const [yMin, yMax] = paddedDomain(yValues);
  const xValues = plot.scale.real;
  const xMin = xValues[first] ?? 0; const xMax = xValues[last] ?? 1;
  const logarithmicX = plot.analysis === "ac" && xMin > 0 && xMax > 0;
  const axisX = (value: number) => logarithmicX ? Math.log10(Math.max(Number.MIN_VALUE, value)) : value;
  const axisXMin = axisX(xMin); const axisXMax = axisX(xMax);
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const x = (index: number) => left + (axisX(xValues[index] ?? xMin) - axisXMin) / Math.max(Number.EPSILON, axisXMax - axisXMin) * plotWidth;
  const y = (value: number) => top + (yMax - value) / Math.max(Number.EPSILON, yMax - yMin) * plotHeight;
  const hoverIndex = hover === null ? null : nearestX(xValues, first, last, logarithmicX ? 10 ** (axisXMin + hover * (axisXMax - axisXMin)) : xMin + hover * (xMax - xMin));
  const pointerFraction = (clientX: number, element: SVGSVGElement) => clamp((clientX - element.getBoundingClientRect().left) / element.getBoundingClientRect().width, 0, 1);
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const position = pointerFraction(event.clientX, event.currentTarget);
    const span = domain[1] - domain[0];
    const nextSpan = clamp(span * (event.deltaY > 0 ? 1.24 : .8), .0125, 1);
    const anchor = domain[0] + position * span;
    onDomain(clampDomain(anchor - position * nextSpan, anchor + (1 - position) * nextSpan));
  };
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = { x: event.clientX, domain };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const fraction = pointerFraction(event.clientX, event.currentTarget);
    if (drag.current) {
      const shift = -(event.clientX - drag.current.x) / event.currentTarget.getBoundingClientRect().width * (drag.current.domain[1] - drag.current.domain[0]);
      onDomain(shiftDomain(drag.current.domain, shift));
    } else onHover(fraction);
  };
  return <div className={styles.chartPanel} data-shape="control">
    <span className={styles.unit}>{unit}</span>
    <svg viewBox={`0 0 ${width} ${height}`} onWheel={wheel} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerLeave={() => { if (!drag.current) onHover(null); }}>
      <g className={styles.grid}>{ticks(5).map((ratio) => <line key={`x${ratio}`} x1={left + ratio * plotWidth} x2={left + ratio * plotWidth} y1={top} y2={top + plotHeight} />)}{ticks(4).map((ratio) => <line key={`y${ratio}`} x1={left} x2={left + plotWidth} y1={top + ratio * plotHeight} y2={top + ratio * plotHeight} />)}</g>
      <g className={styles.axes}><line x1={left} x2={left} y1={top} y2={top + plotHeight} /><line x1={left} x2={left + plotWidth} y1={top + plotHeight} y2={top + plotHeight} /></g>
      <g className={styles.tickLabels}>{ticks(4).map((ratio) => <text key={`yl${ratio}`} x={left - 8} y={top + ratio * plotHeight} textAnchor="end" dominantBaseline="central">{formatAxis(yMax - ratio * (yMax - yMin))}</text>)}{ticks(5).map((ratio) => <text key={`xl${ratio}`} x={left + ratio * plotWidth} y={height - 13} textAnchor="middle">{formatAxis(logarithmicX ? 10 ** (axisXMin + ratio * (axisXMax - axisXMin)) : xMin + ratio * (xMax - xMin))}</text>)}</g>
      {transformed.map(({ trace, values }) => <path key={trace.name} className={styles.trace} style={{ stroke: COLORS[Math.max(0, allTraces.findIndex((candidate) => candidate.name === trace.name)) % COLORS.length] }} d={pathFor(values, first, last, x, y)} />)}
      {hoverIndex !== null && <g className={styles.cursor}><line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={top} y2={top + plotHeight} />{transformed.map(({ trace, values }) => Number.isFinite(values[hoverIndex]) ? <circle key={trace.name} cx={x(hoverIndex)} cy={y(values[hoverIndex])} r="3.5" style={{ fill: COLORS[Math.max(0, allTraces.findIndex((candidate) => candidate.name === trace.name)) % COLORS.length] }} /> : null)}</g>}
    </svg>
    {hoverIndex !== null && <div className={styles.tooltip} data-shape="control"><strong>{plot.scale.name}: {formatEngineering(xValues[hoverIndex] || 0)} {plot.scale.unit}</strong>{transformed.map(({ trace, values }) => <span key={trace.name}>{trace.name}: {formatEngineering(values[hoverIndex] || 0)} {unit}</span>)}</div>}
  </div>;
}

type TraceMode = "real" | "magnitude" | "phase";
function initialTraces(plot: SpicePlot): Set<string> { return new Set(plot.traces.slice(0, 8).map((trace) => trace.name)); }
function toggleTrace(current: Set<string>, name: string): Set<string> { const next = new Set(current); if (next.has(name)) next.delete(name); else next.add(name); return next; }
function groupTraces(traces: SpiceVector[], mode: TraceMode): Array<[string, SpiceVector[]]> {
  const groups = new Map<string, SpiceVector[]>();
  for (const trace of traces) { const unit = modeUnit(trace, mode); groups.set(unit, [...(groups.get(unit) || []), trace]); }
  return [...groups].slice(0, 4);
}
function modeUnit(trace: SpiceVector, mode: TraceMode): string { return trace.imaginary && mode === "magnitude" ? "dB" : trace.imaginary && mode === "phase" ? "deg" : trace.unit; }
function transform(trace: SpiceVector, mode: TraceMode): number[] {
  if (!trace.imaginary || mode === "real") return trace.real;
  if (mode === "phase") return trace.real.map((real, index) => Math.atan2(trace.imaginary?.[index] || 0, real) * 180 / Math.PI);
  return trace.real.map((real, index) => 20 * Math.log10(Math.max(1e-30, Math.hypot(real, trace.imaginary?.[index] || 0))));
}
function paddedDomain(values: number[]): [number, number] {
  if (!values.length) return [-1, 1];
  let minimum = Math.min(...values); let maximum = Math.max(...values);
  if (minimum === maximum) { const padding = Math.max(Math.abs(minimum) * .1, 1); minimum -= padding; maximum += padding; }
  else { const padding = (maximum - minimum) * .08; minimum -= padding; maximum += padding; }
  return [minimum, maximum];
}
function pathFor(values: number[], first: number, last: number, x: (index: number) => number, y: (value: number) => number): string {
  let path = ""; let started = false;
  for (let index = first; index <= last; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) { started = false; continue; }
    path += `${started ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`; started = true;
  }
  return path;
}
function shiftDomain(domain: [number, number], shift: number): [number, number] { return clampDomain(domain[0] + shift, domain[1] + shift); }
function nearestX(values: number[], first: number, last: number, target: number): number {
  let best = first; let distance = Infinity;
  for (let index = first; index <= last; index += 1) {
    const next = Math.abs((values[index] ?? target) - target);
    if (next < distance) { distance = next; best = index; }
  }
  return best;
}
function clampDomain(start: number, end: number): [number, number] { const span = Math.min(1, end - start); const left = clamp(start, 0, 1 - span); return [left, left + span]; }
function ticks(divisions: number): number[] { return Array.from({ length: divisions + 1 }, (_, index) => index / divisions); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function formatAxis(value: number): string { return formatEngineering(value, 3); }
function formatEngineering(value: number, precision = 5): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const prefixes: Record<number, string> = { [-12]: "p", [-9]: "n", [-6]: "µ", [-3]: "m", 0: "", 3: "k", 6: "M", 9: "G", 12: "T" };
  const exponent = clamp(Math.floor(Math.log10(Math.abs(value)) / 3) * 3, -12, 12);
  return `${Number((value / 10 ** exponent).toPrecision(precision))}${prefixes[exponent]}`;
}
