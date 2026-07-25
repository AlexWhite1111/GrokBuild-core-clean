import { typographyScope, type ProcessGroupModel, type ToolEvent } from "../core/contracts.js";
import { Collapsible } from "../primitives/index.js";
import { Control, DisclosureGlyph, ProcessGlyph } from "../components/index.js";
import styles from "./ProcessGroup.module.css";

export function ProcessGroup({ model, defaultOpen = false, live = false }: { model: ProcessGroupModel; defaultOpen?: boolean; live?: boolean }) {
  if (model.items.length === 1) return <section className={styles.group} data-process-group={model.id} data-kind={model.kind} data-status={model.status} {...typographyScope("content")}>
    <ProcessItem item={model.items[0]} level={1} liveSummary={live} />
  </section>;

  return <Collapsible defaultOpen={defaultOpen}>{({ open, toggle }) => <section className={styles.group} data-process-group={model.id} data-kind={model.kind} data-status={model.status} {...typographyScope("content")}>
    <Control recipe="text" density="body" shape="none" hover="color" className={styles.summary} data-process-summary data-process-level="1" data-status={model.status} data-process-live-summary={live || undefined} onClick={toggle} aria-expanded={open}>
      <ProcessGlyph kind={model.kind} className={styles.firstLineGlyph} />
      <ProcessLabel value={model.label} />
      <DisclosureGlyph className={`${styles.firstLineGlyph} ${styles.chevron} ${open ? styles.open : ""}`} />
    </Control>
    {open ? <div className={styles.details} data-process-details>
      {model.items.map((item) => <ProcessItem item={item} level={2} key={item.id} />)}
    </div> : null}
  </section>}</Collapsible>;
}

function ProcessItem({ item, level, liveSummary = false }: { item: ToolEvent; level: 1 | 2; liveSummary?: boolean }) {
  if (!item.detail) return <div className={styles.item} data-process-item={item.id} data-process-level={level} data-kind={item.kind} data-status={item.status}>
    <div className={styles.itemSummary} data-process-live-summary={liveSummary || undefined}>
      <ProcessGlyph kind={item.kind} className={styles.firstLineGlyph} />
      <ProcessLabel value={item.label} />
    </div>
  </div>;
  const detail = item.detail;

  return <Collapsible>{({ open, toggle }) => <div className={styles.item} data-process-item={item.id} data-process-level={level} data-kind={item.kind} data-status={item.status}>
    <Control recipe="text" density="body" shape="none" hover="color" className={styles.itemSummary} data-process-live-summary={liveSummary || undefined} onClick={toggle} aria-expanded={open}>
      <ProcessGlyph kind={item.kind} className={styles.firstLineGlyph} />
      <ProcessLabel
        value={open && item.detailFormat !== "code" ? detail : item.label}
        expanded={open && item.detailFormat !== "code"}
      />
      <DisclosureGlyph className={`${styles.firstLineGlyph} ${styles.itemChevron} ${open ? styles.open : ""}`} />
    </Control>
    {open && item.detailFormat === "code"
      ? <pre className={`${styles.itemDetail} ${styles.codeDetail}`} data-process-item-detail data-process-level={level} data-shape="detail"><code>{detail}</code></pre>
      : null}
  </div>}</Collapsible>;
}

function ProcessLabel({ value, expanded = false }: { value: string; expanded?: boolean }) {
  return <span className={styles.label} data-process-label={value} data-process-label-state={expanded ? "expanded" : "collapsed"}>{value}</span>;
}
