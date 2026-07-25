import styles from "./Feedback.module.css";

export type FeedbackTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "onAccent";

export function Spinner({ tone = "neutral", size = "standard", className = "" }: {
  tone?: FeedbackTone;
  size?: "compact" | "standard";
  className?: string;
}) {
  return <span className={`${styles.spinner} ${className}`} data-tone={tone} data-size={size} role="progressbar" aria-label="Loading" />;
}

export function StatusDot({ tone = "neutral", appearance = "solid", pulse = false, label, className = "" }: {
  tone?: FeedbackTone;
  appearance?: "solid" | "hollow";
  pulse?: boolean;
  label?: string;
  className?: string;
}) {
  return <span
    className={`${styles.dot} ${className}`}
    data-tone={tone}
    data-appearance={appearance}
    data-pulse={pulse || undefined}
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  />;
}
