import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Notice.module.css";

type NoticeTone = "neutral" | "info" | "success" | "warning" | "danger";

export function Notice({ tone = "neutral", density = "standard", children, className = "", ...props }: HTMLAttributes<HTMLDivElement> & {
  tone?: NoticeTone;
  density?: "compact" | "standard";
  children: ReactNode;
}) {
  return <div {...props} className={`${styles.notice} ${className}`} data-ui-notice data-shape="control" data-tone={tone} data-density={density}>{children}</div>;
}
