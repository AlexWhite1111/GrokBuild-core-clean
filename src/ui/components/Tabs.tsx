import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import styles from "./Tabs.module.css";

export const TabsRoot = TabsPrimitive.Root;

export function TabsList({ className = "", ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List {...props} className={`${styles.list} ${className}`} />;
}

export function TabsTrigger({ className = "", ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger {...props} className={`${styles.trigger} ${className}`} data-shape="control" />;
}

export function TabsContent({ className = "", ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content {...props} className={`${styles.content} ${className}`} />;
}
