import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Surface.module.css";

type SurfaceAppearance = "plain" | "canvas" | "surface" | "raised" | "muted" | "sidebar" | "drawer" | "menu" | "composer" | "message" | "messageUser" | "question" | "code" | "terminal";
type SurfaceElevation = "none" | "inset" | "content" | "control" | "floating" | "popover" | "modal";
type SurfaceShape = "none" | "detail" | "control" | "surface" | "dialog" | "pill";
type SurfaceTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
type SurfaceElement = "div" | "span" | "figure" | "aside" | "section" | "article" | "nav" | "main";

interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: SurfaceElement;
  appearance?: SurfaceAppearance;
  elevation?: SurfaceElevation;
  shape?: SurfaceShape;
  children?: ReactNode;
  interactive?: boolean;
  selected?: boolean;
  tone?: SurfaceTone;
  attention?: boolean;
  elementRef?: (element: HTMLElement | null) => void;
}

export function Surface({
  as = "div",
  appearance = "surface",
  elevation = "none",
  shape = "surface",
  className = "",
  children,
  interactive = false,
  selected = false,
  tone = "neutral",
  attention = false,
  elementRef,
  ...props
}: SurfaceProps) {
  const Component = as;
  return <Component
    {...props}
    ref={elementRef as never}
    className={`${styles.surface} ${className}`}
    data-ui-surface
    data-appearance={appearance}
    data-elevation={elevation}
    data-shape={shape}
    data-interactive={interactive || undefined}
    data-selected={selected || undefined}
    data-tone={tone}
    data-attention={attention || undefined}
  >{children}</Component>;
}
