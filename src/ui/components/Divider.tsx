import styles from "./Divider.module.css";

export function Divider({ orientation = "horizontal", extent = "full", className = "" }: {
  orientation?: "horizontal" | "vertical";
  extent?: "full" | "half";
  className?: string;
}) {
  return <span className={`${styles.divider} ${className}`} data-orientation={orientation} data-extent={extent} aria-hidden />;
}
