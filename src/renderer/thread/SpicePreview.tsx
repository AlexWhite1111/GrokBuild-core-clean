import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parseSpiceNetlist, type SpiceComponent, type SpiceNetlistSummary } from "../../shared/contracts.js";
import { Text } from "../../ui/components/index.js";
import styles from "./SpicePreview.module.css";

export function SpicePreview({ source, detail = false }: { source: string; detail?: boolean }) {
  const { t } = useTranslation();
  const netlist = useMemo(() => parseSpiceNetlist(source), [source]);
  return <div className={`${styles.preview} ${detail ? styles.detail : ""}`}>
    <header className={styles.header}>
      <div><Text as="strong" truncate title={netlist.title}>{netlist.title}</Text><Text as="span" tone="muted" size="label">{t("spiceNetlist")}</Text></div>
      <div className={styles.metrics}>
        <Metric value={netlist.components.length} label={t("spiceComponents")} />
        <Metric value={netlist.nodes.length} label={t("spiceNodes")} />
        <Metric value={netlist.analyses.length} label={t("spiceAnalyses")} />
      </div>
    </header>
    {netlist.analyses.length > 0 && <div className={styles.chips}>{netlist.analyses.map((analysis) => <span key={`${analysis.line}:${analysis.kind}`}>.{analysis.kind}</span>)}</div>}
    <Topology netlist={netlist} />
    <ComponentTable components={netlist.components} detail={detail} />
    {netlist.diagnostics.length > 0 && <div className={styles.diagnostics}>{netlist.diagnostics.map((item, index) => <div key={`${item.line}:${index}`} data-severity={item.severity}>
      <span>{item.line ? `L${item.line}` : item.severity}</span><span>{item.message}</span>
    </div>)}</div>}
  </div>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <span><strong>{value}</strong>{label}</span>;
}

function Topology({ netlist }: { netlist: SpiceNetlistSummary }) {
  const nodes = netlist.nodes.slice(0, 24);
  if (!nodes.length || !netlist.components.length) return null;
  const positions = nodePositions(nodes);
  const visible = netlist.components.filter((component) => component.nodes.some((node) => positions.has(node.toLowerCase()))).slice(0, 48);
  return <div className={styles.topology} data-shape="control">
    <svg viewBox="0 0 900 420" role="img" aria-label="SPICE topology">
      {visible.map((component, index) => <ComponentEdge key={`${component.line}:${component.id}`} component={component} positions={positions} index={index} />)}
      {nodes.map((node) => {
        const point = positions.get(node.toLowerCase())!;
        const ground = node === "0" || /^gnd!?$/i.test(node);
        return <g key={node} className={ground ? styles.groundNode : styles.node} transform={`translate(${point.x} ${point.y})`}>
          <circle r="18" /><text textAnchor="middle" dominantBaseline="central">{shortLabel(node, 10)}</text>
        </g>;
      })}
    </svg>
    {netlist.nodes.length > nodes.length && <span className={styles.overflow}>+{netlist.nodes.length - nodes.length} nodes</span>}
  </div>;
}

function ComponentEdge({ component, positions, index }: { component: SpiceComponent; positions: Map<string, Point>; index: number }) {
  const pins = component.nodes.flatMap((node) => {
    const point = positions.get(node.toLowerCase());
    return point ? [point] : [];
  });
  if (!pins.length) return null;
  const center = pins.reduce((value, point) => ({ x: value.x + point.x / pins.length, y: value.y + point.y / pins.length }), { x: 0, y: 0 });
  const spread = ((index % 5) - 2) * 8;
  const anchor = { x: clamp(center.x + spread, 56, 844), y: clamp(center.y - spread, 48, 372) };
  return <g className={styles.component}>
    {pins.map((point, pin) => <line key={pin} x1={point.x} y1={point.y} x2={anchor.x} y2={anchor.y} />)}
    <rect x={anchor.x - 28} y={anchor.y - 12} width="56" height="24" rx="8" />
    <text x={anchor.x} y={anchor.y} textAnchor="middle" dominantBaseline="central">{shortLabel(component.id, 9)}</text>
  </g>;
}

function ComponentTable({ components, detail }: { components: SpiceComponent[]; detail: boolean }) {
  const { t } = useTranslation();
  if (!components.length) return null;
  const visible = components.slice(0, detail ? 240 : 64);
  return <div className={styles.tableWrap} data-shape="control"><table><thead><tr><th>{t("spiceDevice")}</th><th>{t("spiceType")}</th><th>{t("spiceNodes")}</th><th>{t("spiceValueModel")}</th></tr></thead><tbody>
    {visible.map((component) => <tr key={`${component.line}:${component.id}`}><td>{component.id}</td><td>{component.type}</td><td>{component.nodes.join(" · ") || "—"}</td><td>{component.value || "—"}</td></tr>)}
  </tbody></table>{components.length > visible.length && <div className={styles.tableMore}>+{components.length - visible.length}</div>}</div>;
}

interface Point { x: number; y: number }
function nodePositions(nodes: string[]): Map<string, Point> {
  const result = new Map<string, Point>();
  const groundIndex = nodes.findIndex((node) => node === "0" || /^gnd!?$/i.test(node));
  const regular = nodes.filter((_, index) => index !== groundIndex);
  regular.forEach((node, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(regular.length, 1);
    result.set(node.toLowerCase(), { x: 450 + Math.cos(angle) * 350, y: 205 + Math.sin(angle) * 145 });
  });
  if (groundIndex >= 0) result.set(nodes[groundIndex].toLowerCase(), { x: 450, y: 385 });
  return result;
}

function shortLabel(value: string, length: number): string { return value.length <= length ? value : `${value.slice(0, length - 1)}…`; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
