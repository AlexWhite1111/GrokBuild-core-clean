import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Badge.module.css";

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function Badge({ tone = "neutral", variant = "soft", shape = "control", iconOnly = false, children, className = "", ...props }: HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  variant?: "soft" | "solid" | "outline";
  shape?: "detail" | "control" | "pill" | "round";
  iconOnly?: boolean;
  children: ReactNode;
}) {
  return <span {...props} className={`${styles.badge} ${className}`} data-ui-badge data-tone={tone} data-variant={variant} data-shape={shape} data-icon-only={iconOnly || undefined}>{children}</span>;
}
