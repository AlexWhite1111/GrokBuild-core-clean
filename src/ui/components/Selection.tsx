import { Check } from "lucide-react";
import styles from "./Selection.module.css";

export function SelectionMark({ selected, multiple = false, className = "" }: {
  selected: boolean;
  multiple?: boolean;
  className?: string;
}) {
  return <span
    className={`${styles.mark} ${className}`}
    data-ui-selection-mark
    data-shape={multiple ? "detail" : "round"}
    data-selected={selected || undefined}
    data-multiple={multiple || undefined}
    aria-hidden
  >{selected && multiple && <Check />}</span>;
}
