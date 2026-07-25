import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Control } from "./Control.js";
import styles from "./Modal.module.css";

type ModalSize = "compact" | "standard" | "wide" | "full";
type ModalPlacement = "center" | "top";
type ModalKind = "dialog" | "palette";
type ModalBodyInset = "standard" | "none";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  titleHidden = false,
  closeLabel,
  size = "standard",
  placement = "center",
  kind = "dialog",
  bodyInset = "standard",
  children,
  footer,
  className = "",
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  titleHidden?: boolean;
  closeLabel?: string;
  size?: ModalSize;
  placement?: ModalPlacement;
  kind?: ModalKind;
  bodyInset?: ModalBodyInset;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={styles.overlay} data-kind={kind} />
    <DialogPrimitive.Content
      className={`${styles.modal} ${className}`}
      data-shape={size === "full" ? "none" : "dialog"}
      data-size={size}
      data-placement={placement}
      data-kind={kind}
    >
      <header className={titleHidden ? styles.visuallyHidden : styles.header}>
        <DialogPrimitive.Title className={styles.title}>{title}</DialogPrimitive.Title>
        {closeLabel && <DialogPrimitive.Close asChild><Control recipe="icon" density="compact" aria-label={closeLabel}><X aria-hidden /></Control></DialogPrimitive.Close>}
      </header>
      {description && <DialogPrimitive.Description className={styles.description}>{description}</DialogPrimitive.Description>}
      <div className={styles.body} data-inset={bodyInset}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal></DialogPrimitive.Root>;
}

export function ModalClose({ children }: { children: ReactNode }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>;
}
