import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Text.module.css";

type TextTone = "primary" | "secondary" | "muted" | "accent" | "success" | "warning" | "danger" | "info";
type TextRole = "ui" | "body" | "heading" | "code" | "numeric";
type TextSize = "micro" | "caption" | "label" | "body" | "copy" | "title";
type TextElement = "span" | "p" | "small" | "strong" | "em" | "code" | "time" | "figcaption" | "div" | "h1" | "h2" | "h3";

export function Text({ as = "span", tone = "primary", font = "ui", size = "body", weight = "normal", truncate = false, children, className = "", ...props }: HTMLAttributes<HTMLElement> & {
  as?: TextElement;
  tone?: TextTone;
  font?: TextRole;
  size?: TextSize;
  weight?: "normal" | "medium" | "semibold" | "bold";
  truncate?: boolean;
  dateTime?: string;
  children: ReactNode;
}) {
  const Component = as;
  return <Component {...props} className={`${styles.text} ${className}`} data-ui-text data-tone={tone} data-role={font} data-size={size} data-weight={weight} data-truncate={truncate || undefined}>{children}</Component>;
}
