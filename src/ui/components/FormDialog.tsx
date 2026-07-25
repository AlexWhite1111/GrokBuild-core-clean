import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Control } from "./Control.js";
import { Field, Input } from "./Field.js";
import { Modal, ModalClose } from "./Modal.js";
import styles from "./FormDialog.module.css";

interface FormDialogField {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
}

export function FormDialog(props: {
  open: boolean;
  title: string;
  fields: FormDialogField[];
  pending?: boolean;
  onOpenChange(open: boolean): void;
  onFieldChange(id: string, value: string): void;
  onApply(): void;
}) {
  const { t } = useTranslation();
  const valid = props.fields.every((field) => field.value.trim());
  return <Modal
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={props.title}
    size="compact"
    footer={<><ModalClose><Control recipe="quiet">{t("cancel")}</Control></ModalClose><Control recipe="solid" disabled={!valid || props.pending} onClick={props.onApply}><Check size={13} />{props.pending ? t("applying") : t("confirmApply")}</Control></>}
  >
    <div className={styles.fields} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && valid) { event.preventDefault(); props.onApply(); } }}>
      {props.fields.map((field, index) => <Field key={field.id} label={field.label}><Input autoFocus={index === 0} value={field.value} placeholder={field.placeholder} onChange={(event) => props.onFieldChange(field.id, event.target.value)} /></Field>)}
    </div>
  </Modal>;
}
