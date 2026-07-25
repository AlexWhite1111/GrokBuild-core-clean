import { Check } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import styles from "./Field.module.css";

type FieldAppearance = "plain" | "surface";
type FieldDensity = "compact" | "standard" | "comfortable";
type FieldTone = "neutral" | "success" | "warning" | "danger";

export function Field({ label, hint, error, children, className = "" }: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <label className={`${styles.field} ${className}`} data-ui-field>
    {label !== undefined && <span className={styles.label}>{label}</span>}
    {children}
    {(error || hint) && <small className={error ? styles.error : styles.hint}>{error || hint}</small>}
  </label>;
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "style"> {
  appearance?: FieldAppearance;
  density?: FieldDensity;
  tone?: FieldTone;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({
  appearance = "plain",
  density = "standard",
  tone = "neutral",
  className = "",
  type = "text",
  ...props
}, ref) {
  const kind = inputKind(type);
  return <input
    {...props}
    ref={ref}
    type={type}
    className={`${styles.input} ${className}`}
    data-ui-input
    data-kind={kind}
    data-shape={kind === "text" || kind === "color" ? "control" : undefined}
    data-appearance={appearance}
    data-density={density}
    data-tone={tone}
  />;
});

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> {
  appearance?: FieldAppearance;
  density?: FieldDensity;
  tone?: FieldTone;
  autoGrow?: boolean;
  minLines?: number;
  maxLines?: number;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({
  appearance = "plain",
  density = "standard",
  tone = "neutral",
  autoGrow = false,
  minLines = 1,
  maxLines = 12,
  onInput,
  value,
  className = "",
  ...props
}, forwardedRef) {
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback((element: HTMLTextAreaElement) => {
    if (!autoGrow) return;
    const computed = getComputedStyle(element);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const chrome = pixels(computed.paddingTop) + pixels(computed.paddingBottom)
      + pixels(computed.borderTopWidth) + pixels(computed.borderBottomWidth);
    const minimum = lineHeight * minLines + chrome;
    const maximum = lineHeight * Math.max(minLines, maxLines) + chrome;
    element.style.height = "auto";
    element.style.height = `${Math.max(minimum, Math.min(element.scrollHeight, maximum))}px`;
    element.style.overflowY = element.scrollHeight > maximum + 1 ? "auto" : "hidden";
  }, [autoGrow, maxLines, minLines]);

  useLayoutEffect(() => {
    if (elementRef.current) resize(elementRef.current);
  }, [resize, value]);

  return <textarea
    {...props}
    ref={(element) => {
      elementRef.current = element;
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    }}
    rows={minLines}
    value={value}
    className={`${styles.input} ${styles.textarea} ${className}`}
    data-ui-input
    data-kind="textarea"
    data-shape="control"
    data-appearance={appearance}
    data-density={density}
    data-tone={tone}
    data-auto-grow={autoGrow || undefined}
    data-max-lines={maxLines}
    onInput={(event) => {
      resize(event.currentTarget);
      onInput?.(event);
    }}
  />;
});

export function Checkbox({ label, description, className = "", ...props }: Omit<InputProps, "type"> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return <label className={`${styles.choice} ${className}`} data-ui-choice>
    <Input {...props} type="checkbox" />
    <span className={styles.choiceMark} data-shape="detail"><Check aria-hidden /></span>
    <span className={styles.choiceCopy}><strong>{label}</strong>{description && <small>{description}</small>}</span>
  </label>;
}

export function Switch({ label, description, className = "", ...props }: Omit<InputProps, "type"> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return <label className={`${styles.switch} ${className}`} data-ui-switch>
    <Input {...props} type="checkbox" />
    <span className={styles.switchTrack}><i /></span>
    <span className={styles.choiceCopy}><strong>{label}</strong>{description && <small>{description}</small>}</span>
  </label>;
}

function inputKind(type: InputHTMLAttributes<HTMLInputElement>["type"]): string {
  if (type === "checkbox" || type === "radio") return "selection";
  if (type === "range") return "range";
  if (type === "file") return "file";
  if (type === "color") return "color";
  return "text";
}

function pixels(value: string): number {
  return Number.parseFloat(value) || 0;
}
