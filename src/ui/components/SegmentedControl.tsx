import type { ReactNode } from "react";
import { Control, type ControlDensity } from "./Control.js";
import { UiIcon, type UiIconSource } from "./Icon.js";
import styles from "./SegmentedControl.module.css";

interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: UiIconSource;
  ariaLabel?: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  density = "compact",
  selection = "quiet",
  className = "",
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  density?: Exclude<ControlDensity, "titlebar">;
  selection?: "quiet" | "solid";
  className?: string;
}) {
  return <div className={`${styles.group} ${className}`} data-ui-segmented data-shape="control" data-density={density} role="radiogroup" aria-label={ariaLabel}>
    {options.map((option) => {
      const selected = option.value === value;
      return <Control
        key={String(option.value)}
        recipe={selected && selection === "solid" ? "solid" : "text"}
        hover="surface"
        density={density}
        selected={selected && selection === "quiet"}
        disabled={option.disabled}
        role="radio"
        aria-checked={selected}
        aria-label={option.ariaLabel}
        onClick={() => onChange(option.value)}
      >{option.icon && <UiIcon source={option.icon} size="detail" />}<span className={styles.label}>{option.label}</span></Control>;
    })}
  </div>;
}
