import { ChevronDown } from "lucide-react";
import { Control } from "./Control.js";
import { MenuContent, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger } from "./Menu.js";
import styles from "./ThemedSelect.module.css";

interface ThemedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function ThemedSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className = "",
}: {
  value: string;
  options: ThemedSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return <MenuRoot>
    <MenuTrigger asChild disabled={disabled}>
      <Control recipe="quiet" className={`${styles.trigger} ${className}`} aria-label={ariaLabel} aria-haspopup="listbox">
        <span>{selected?.label || value}</span><ChevronDown size={12} aria-hidden />
      </Control>
    </MenuTrigger>
    <MenuContent align="start" sideOffset={5} collisionPadding={10} aria-label={ariaLabel}>
      <MenuRadioGroup value={value} onValueChange={onValueChange}>
        {options.map((option) => <MenuRadioItem disabled={option.disabled} key={option.value} value={option.value}>{option.label}</MenuRadioItem>)}
      </MenuRadioGroup>
    </MenuContent>
  </MenuRoot>;
}
