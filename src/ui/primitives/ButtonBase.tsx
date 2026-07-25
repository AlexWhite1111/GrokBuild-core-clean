import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";

export interface ButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> { asChild?: boolean }

export const ButtonBase = forwardRef<HTMLButtonElement, ButtonBaseProps>(function ButtonBase({
  asChild = false,
  className = "",
  type = "button",
  children,
  ...props
}, ref) {
  if (!asChild) return <button {...props} className={className} ref={ref} type={type}>{children}</button>;
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const element = child as ReactElement<{ className?: string }>;
  return cloneElement(element, { ...props, className: `${element.props.className || ""} ${className}`.trim() });
});
