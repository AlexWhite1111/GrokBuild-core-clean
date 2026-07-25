import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { typographyScope } from "../core/index.js";
import { Control } from "./Control.js";
import { UiIcon, type UiIconSource } from "./Icon.js";
import { Text } from "./Text.js";
import styles from "./Panel.module.css";

type PanelTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function PanelSection({ title, icon, count, active = false, action, children }: {
  title: ReactNode;
  icon?: UiIconSource;
  count?: number;
  active?: boolean;
  action?: { label: string; onClick: () => void; icon?: LucideIcon; disabled?: boolean };
  children: ReactNode;
}) {
  const ActionIcon = action?.icon || ChevronRight;
  return <section className={styles.section} data-ui-panel-section data-active={active || undefined}>
    <header className={styles.header}>
      {icon && <UiIcon source={icon} size="detail" />}
      <Text as="strong" tone="muted" size="body" weight="semibold">{title}</Text>
      {count != null && <Text as="span" tone="muted" font="ui" size="micro">{count}</Text>}
      {action && <Control recipe="icon" density="compact" disabled={action.disabled} onClick={action.onClick} aria-label={action.label} title={action.label}><UiIcon source={ActionIcon} size="detail" /></Control>}
    </header>
    <div className={styles.sectionBody}>{children}</div>
  </section>;
}

export function PanelRow({ icon, title, detail, meta, trailing, actions = [], onClick, selected = false, tone = "neutral", wrap = false, contentText = false }: {
  icon?: UiIconSource;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  actions?: Array<{ label: string; onClick: () => void; icon: UiIconSource; tone?: PanelTone; disabled?: boolean }>;
  onClick?: () => void;
  selected?: boolean;
  tone?: PanelTone;
  wrap?: boolean;
  contentText?: boolean;
}) {
  const content = <>
    {icon && <UiIcon source={icon} size="control" />}
    <span className={styles.copy}>
      <Text as="strong" tone="secondary" font={contentText ? "body" : "ui"} size="body" weight="medium" truncate={!wrap}>{title}</Text>
      {detail != null && <Text as="small" tone="muted" font={contentText ? "body" : "ui"} size="label" truncate={!wrap}>{detail}</Text>}
    </span>
    {meta != null && <Text as="small" tone="muted" font="numeric" size="caption" truncate>{meta}</Text>}
    {trailing != null && <span className={styles.trailing}>{trailing}</span>}
  </>;
  const shared = {
    className: styles.row,
    "data-ui-panel-row": "",
    "data-has-icon": Boolean(icon),
    "data-tone": tone,
    "data-wrap": wrap || undefined,
    ...(contentText ? typographyScope("content") : {}),
  } as const;
  const row = onClick
    ? <Control {...shared} recipe="row" density="standard" selected={selected} onClick={onClick}>{content}</Control>
    : <div {...shared}>{content}</div>;
  if (!actions.length) return row;
  return <div className={styles.rowFrame}>
    {row}
    <span className={styles.rowActions}>
      {actions.map((action) => <Control key={action.label} recipe={action.tone === "danger" ? "danger" : "icon"} tone={action.tone} density="detail" iconOnly aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.onClick}><UiIcon source={action.icon} size="detail" /></Control>)}
    </span>
  </div>;
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <Text as="div" className={styles.empty} tone="muted" size="caption">{children}</Text>;
}
