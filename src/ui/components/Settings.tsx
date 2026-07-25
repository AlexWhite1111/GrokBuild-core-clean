import type { PropsWithChildren } from "react";
import { Surface } from "./Surface.js";
import { Text } from "./Text.js";
import styles from "./Settings.module.css";

export function SettingSection({ title, description, children }: PropsWithChildren<{ title: string; description: string }>) {
  return <section className={styles.section} data-ui-setting-section>
    <header><Text as="h2" font="heading" size="body" weight="semibold">{title}</Text><Text as="p" tone="muted" size="caption">{description}</Text></header>
    <Surface className={styles.rows} appearance="surface" elevation="content">{children}</Surface>
  </section>;
}

export function SettingCard({ title, description, children, grouped = false }: PropsWithChildren<{ title: string; description: string; grouped?: boolean }>) {
  return <Surface as="section" appearance={grouped ? "plain" : "surface"} elevation={grouped ? "none" : "content"} shape={grouped ? "none" : "surface"} className={styles.card} data-ui-setting-card data-grouped={grouped || undefined}>
    <div><Text as="h3" size="body" weight="semibold">{title}</Text><Text as="p" tone="muted" size="label">{description}</Text></div>
    <div className={styles.control}>{children}</div>
  </Surface>;
}
