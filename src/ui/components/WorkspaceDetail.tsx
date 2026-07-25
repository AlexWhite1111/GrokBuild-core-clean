import type { ReactNode } from "react";
import styles from "./WorkspaceDetail.module.css";

export function WorkspaceDetail({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return <section className={styles.root} data-ui-workspace-detail>
    {actions && <header className={styles.header} data-ui-workspace-actions>{actions}</header>}
    <div className={styles.body}>{children}</div>
  </section>;
}
