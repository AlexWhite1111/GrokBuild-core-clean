import { forwardRef } from "react";
import { TextArea, type TextAreaProps } from "./Field.js";

interface AutoGrowTextareaProps extends Omit<TextAreaProps, "autoGrow"> {}

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(function AutoGrowTextarea(props, ref) {
  return <TextArea {...props} ref={ref} autoGrow />;
});
