import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import styles from "./Popover.module.css";

export const PopoverRoot = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className = "", size = "standard", ...props }: ComponentProps<typeof PopoverPrimitive.Content> & {
  size?: "standard" | "wide";
}) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content {...props} className={`${styles.content} ${className}`} data-shape="surface" data-size={size} /></PopoverPrimitive.Portal>;
}
