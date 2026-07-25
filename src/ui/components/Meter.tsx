import styles from "./Meter.module.css";
import type { CSSProperties } from "react";

type MeterTone = "neutral" | "calm" | "warning" | "danger";

interface MeterSlot {
  id: string | number;
  active?: boolean;
  enabled?: boolean;
  tone?: MeterTone;
}

export function Meter({ slots, className = "" }: { slots: MeterSlot[]; className?: string }) {
  return <span className={`${styles.meter} ${className}`} data-ui-meter style={{ "--meter-columns": slots.length } as CSSProperties}>
    {slots.map((slot) => <i
      key={slot.id}
      data-active={slot.active || undefined}
      data-enabled={slot.enabled || undefined}
      data-tone={slot.tone || "neutral"}
      data-shape="detail"
    />)}
  </span>;
}
