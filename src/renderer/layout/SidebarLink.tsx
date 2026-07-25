import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Control } from "../../ui/components/index.js";
import styles from "./Sidebar.module.css";

export function SidebarLink({ to, icon, label, activeIcon = false }: { to: string; icon: ReactNode; label: string; activeIcon?: boolean }) {
  return <Control asChild recipe="row" className={styles.navLink}>
    <Link to={to} data-active-icon={activeIcon || undefined}>{icon}<span>{label}</span></Link>
  </Control>;
}
