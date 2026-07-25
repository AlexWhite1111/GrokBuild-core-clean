import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Control, Modal, ModalClose, Notice, Surface, Text } from "../../ui/components/index.js";
import styles from "./SemanticMutationDialog.module.css";

interface SemanticChange {
  field: string;
  before: string;
  after: string;
}

interface SemanticMutationDialogProps {
  open: boolean;
  title: string;
  target?: string;
  changes: SemanticChange[];
  warnings: string[];
  pending?: boolean;
  destructive?: boolean;
  onOpenChange(open: boolean): void;
  onApply(): void;
}

export function SemanticMutationDialog(props: SemanticMutationDialogProps) {
  const { t } = useTranslation();
  const footer = <><ModalClose><Control recipe="quiet">{t("cancel")}</Control></ModalClose><Control recipe={props.destructive ? "danger" : "solid"} disabled={props.pending} onClick={props.onApply}><Check size={13} />{props.pending ? t("applying") : t("confirmApply")}</Control></>;
  return <Modal open={props.open} onOpenChange={props.onOpenChange} title={props.title} size="wide" footer={footer}>
    {props.target && <Text as="p" className={styles.target} tone="muted" font="code" size="label">{props.target}</Text>}
    <div className={styles.changes}>{props.changes.map((change) => <Surface key={change.field} appearance="muted" shape="control" className={styles.change}><Text as="strong" size="label" weight="semibold" truncate>{change.field}</Text><Text tone="secondary" font="code" size="label">{change.before}</Text><ArrowRight size={12} /><Text tone="secondary" font="code" size="label">{change.after}</Text></Surface>)}</div>
    {props.warnings.length > 0 && <Notice tone="warning" className={styles.warnings}><AlertTriangle size={13} /><div>{props.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></Notice>}
  </Modal>;
}
