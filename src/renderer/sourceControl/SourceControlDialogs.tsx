import { GitBranch, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Control, Field, Input, Modal, ModalClose, Notice, Text } from "../../ui/components/index.js";
import styles from "./SourceControlControl.module.css";

export function CreateBranchDialog({ open, name, error, pending, locked, onNameChange, onOpenChange, onSubmit }: {
  open: boolean;
  name: string;
  error: string | null;
  pending: boolean;
  locked: boolean;
  onNameChange(value: string): void;
  onOpenChange(value: boolean): void;
  onSubmit(): void;
}) {
  const { t } = useTranslation();
  const valid = Boolean(name.trim());
  return <Modal open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }} title={t("createAndCheckoutBranch")} closeLabel={pending ? undefined : t("close")} size="compact" footer={<><ModalClose><Control recipe="quiet" disabled={pending}>{t("close")}</Control></ModalClose><Control recipe="solid" aria-busy={pending} disabled={!valid || locked} onClick={onSubmit}><GitBranch size={13} />{pending ? t("applying") : t("createAndCheckout")}</Control></>}>
    <div className={styles.dialogFields} aria-busy={pending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && valid && !locked) { event.preventDefault(); onSubmit(); } }}>
      <Field label={t("branchName")} error={error || undefined}><Input autoFocus appearance="surface" value={name} aria-invalid={Boolean(error)} onChange={(event) => onNameChange(event.target.value)} /></Field>
    </div>
  </Modal>;
}

export function ConfirmSourceControlDialog({ open, title, description, target, error, pending, locked, onOpenChange, onConfirm }: {
  open: boolean;
  title: string;
  description: string;
  target: string;
  error: string | null;
  pending: boolean;
  locked: boolean;
  onOpenChange(value: boolean): void;
  onConfirm(): void;
}) {
  const { t } = useTranslation();
  return <Modal open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }} title={title} description={description} size="compact" footer={<><ModalClose><Control recipe="quiet" disabled={pending}>{t("cancel")}</Control></ModalClose><Control recipe="danger" aria-busy={pending} disabled={locked} onClick={onConfirm}><Trash2 size={13} />{t("confirm")}</Control></>}>
    <div className={styles.dialogFields} aria-busy={pending}>
      {error && <Notice tone="danger" density="compact" role="alert">{error}</Notice>}
      <Text as="p" className={styles.confirmTarget} tone="secondary" font="body" size="copy">{target}</Text>
    </div>
  </Modal>;
}
