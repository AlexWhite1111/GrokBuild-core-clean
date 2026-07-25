import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import styles from "./Menu.module.css";

export const MenuRoot = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuContent({ className = "", ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return <DropdownMenu.Portal><DropdownMenu.Content {...props} className={`${styles.content} ${className}`} data-shape="surface" /></DropdownMenu.Portal>;
}

export function MenuItem({ className = "", tone = "neutral", ...props }: ComponentProps<typeof DropdownMenu.Item> & { tone?: "neutral" | "danger" }) {
  return <DropdownMenu.Item {...props} className={`${styles.item} ${className}`} data-shape="control" data-tone={tone} />;
}

export function MenuRadioItem({ className = "", children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return <DropdownMenu.RadioItem {...props} className={`${styles.item} ${styles.radioItem} ${className}`} data-shape="control">
    <DropdownMenu.ItemIndicator className={styles.indicator}><Check aria-hidden /></DropdownMenu.ItemIndicator>
    <span>{children}</span>
  </DropdownMenu.RadioItem>;
}

export function MenuSeparator({ className = "", ...props }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator {...props} className={`${styles.separator} ${className}`} />;
}
