import type { ReactNode } from "react";
import type { ClassNameSlotProps } from "../core/contracts.js";
import styles from "./AppShellLayout.module.css";

type StyledSlot = (props: ClassNameSlotProps) => ReactNode;

export function AppShellLayout({ titlebarControl, mobileScrim, sidebar, sidebarWidth, mobile, nativeTitlebar, workspace, floating }: {
  titlebarControl: StyledSlot;
  mobileScrim?: StyledSlot;
  sidebar?: ReactNode;
  sidebarWidth: number;
  mobile: boolean;
  nativeTitlebar: boolean;
  workspace: ReactNode;
  floating?: ReactNode;
}) {
  return <div className={styles.app} data-native-titlebar={nativeTitlebar || undefined}>
    <div className={styles.dragRegion} aria-hidden />
    {titlebarControl({ className: styles.sidebarToggle })}
    <div className={styles.body}>
      {mobileScrim?.({ className: styles.mobileScrim })}
      {sidebar && <div id="primary-sidebar" className={styles.sidebarSlot} data-mobile={mobile || undefined} style={{ width: sidebarWidth }}>{sidebar}</div>}
      <div className={styles.workspace}>{workspace}</div>
    </div>
    {floating}
  </div>;
}
