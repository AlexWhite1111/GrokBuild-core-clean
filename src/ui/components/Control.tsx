import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ButtonBase } from "../primitives/index.js";
import styles from "./Control.module.css";

type ControlAppearance = "plain" | "quiet" | "solid" | "floating";
type ControlHover = "none" | "color" | "tint" | "surface" | "elevation";
type ControlTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "inverse";
type ControlShape = "none" | "detail" | "control" | "surface" | "pill" | "round";
export type ControlDensity = "detail" | "titlebar" | "media" | "body" | "compact" | "standard" | "action" | "comfortable";
type ControlRecipe = "text" | "icon" | "quiet" | "solid" | "floating" | "row" | "menu" | "danger";

const recipes: Record<ControlRecipe, {
  appearance: ControlAppearance;
  hover: ControlHover;
  tone: ControlTone;
  shape: ControlShape;
  density: ControlDensity;
  iconOnly?: boolean;
}> = {
  text: { appearance: "plain", hover: "color", tone: "neutral", shape: "detail", density: "compact" },
  icon: { appearance: "plain", hover: "color", tone: "neutral", shape: "control", density: "standard", iconOnly: true },
  quiet: { appearance: "quiet", hover: "surface", tone: "neutral", shape: "control", density: "standard" },
  solid: { appearance: "solid", hover: "tint", tone: "accent", shape: "control", density: "standard" },
  floating: { appearance: "floating", hover: "elevation", tone: "neutral", shape: "control", density: "standard" },
  row: { appearance: "plain", hover: "surface", tone: "neutral", shape: "control", density: "standard" },
  menu: { appearance: "plain", hover: "tint", tone: "neutral", shape: "control", density: "compact" },
  danger: { appearance: "plain", hover: "tint", tone: "danger", shape: "control", density: "standard" },
};

interface ControlProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  recipe?: ControlRecipe;
  appearance?: ControlAppearance;
  hover?: ControlHover;
  tone?: ControlTone;
  shape?: ControlShape;
  density?: ControlDensity;
  selected?: boolean;
  iconOnly?: boolean;
  asChild?: boolean;
}

export const Control = forwardRef<HTMLButtonElement, ControlProps>(function Control({
  recipe = "quiet",
  appearance,
  hover,
  tone,
  shape,
  density,
  selected,
  iconOnly,
  asChild = false,
  className = "",
  type = "button",
  children,
  ...props
}, ref) {
  const defaults = recipes[recipe];
  const semantics = {
    className: `${styles.control} ${className}`,
    "data-ui-control": "",
    "data-appearance": appearance || defaults.appearance,
    "data-hover": hover || defaults.hover,
    "data-tone": tone || defaults.tone,
    "data-shape": shape || defaults.shape,
    "data-density": density || defaults.density,
    "data-icon-only": (iconOnly ?? defaults.iconOnly) || undefined,
    "data-selected": selected || undefined,
  } as const;
  return <ButtonBase {...props} {...semantics} ref={ref} type={type} asChild={asChild}>{children}</ButtonBase>;
});
