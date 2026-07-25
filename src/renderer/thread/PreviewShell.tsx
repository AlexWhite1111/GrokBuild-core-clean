import { Maximize2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Control, Modal, ModalClose } from "../../ui/components/index.js";
import styles from "./PreviewShell.module.css";

export function PreviewExpandButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return <Control recipe="icon" density="compact" onClick={onClick} aria-label={t("expandPreview")}><Maximize2 size={13} /></Control>;
}

export function PreviewShell({ open, onOpenChange, accessibleTitle, toolbarTitle, actions, bottomStart, tone = "neutral", edgeToEdge = false, children, contentClassName = "" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessibleTitle: string;
  toolbarTitle?: ReactNode;
  actions?: ReactNode;
  bottomStart?: ReactNode;
  tone?: "neutral" | "inverse";
  edgeToEdge?: boolean;
  children: ReactNode;
  contentClassName?: string;
}) {
  const { t } = useTranslation();
  return <Modal open={open} onOpenChange={onOpenChange} title={accessibleTitle} titleHidden size="full" bodyInset="none" className={`${styles.modal} ${edgeToEdge ? styles.edgeToEdge : ""}`}>
    <div className={styles.shell} data-tone={tone}>
      <div className={`${styles.content} ${contentClassName}`}>{children}</div>
      <div className={styles.toolbar}>
        {toolbarTitle ? <span className={styles.title}>{toolbarTitle}</span> : null}
        <div className={styles.actions}>
          {actions}
          <ModalClose><Control recipe="icon" density="compact" tone={tone} aria-label={t("close")}><X size={13} /></Control></ModalClose>
        </div>
      </div>
      {bottomStart ? <div className={styles.bottomStart}>{bottomStart}</div> : null}
    </div>
  </Modal>;
}
