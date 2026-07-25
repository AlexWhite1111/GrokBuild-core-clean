import type { ComponentType, SVGProps } from "react";
import {
  Bot, BookOpen, Brain, ChevronRight, CircleHelp, CircleStop, Clock3, FileText, GitBranch, Globe2,
  Image as ImageIcon, ListChecks, ListCollapse, ListTodo, ListTree, LoaderCircle, Pencil, Plug,
  RadioTower, RefreshCw, Search, Sparkles, SquareTerminal, Wifi, WifiOff,
  Wrench,
} from "lucide-react";
import type { ProcessKind } from "../core/contracts.js";
import styles from "./Icon.module.css";

export type UiIconSource = ComponentType<SVGProps<SVGSVGElement>>;
export type UiIconSize = "detail" | "control" | "prominent";
export type ProcessGlyphKind = ProcessKind;

/** One semantic icon vocabulary for the operational side rail. */
export const operationalGlyphs = {
  plan: ListChecks,
  todo: ListTodo,
  subagent: Bot,
} as const satisfies Record<"plan" | "todo" | "subagent", UiIconSource>;

export function UiIcon({ source: Source, size = "control", className = "" }: {
  source: UiIconSource;
  size?: UiIconSize;
  className?: string;
}) {
  return <Source className={`${styles.icon} ${className}`} data-ui-icon data-size={size} aria-hidden focusable="false" />;
}

const processGlyphs: Record<Exclude<ProcessGlyphKind, "thought">, UiIconSource> = {
  tools: Wrench,
  list: ListTree,
  read: BookOpen,
  search: Search,
  web: Globe2,
  image: ImageIcon,
  edit: Pencil,
  command: SquareTerminal,
  subagent: Bot,
  compact: ListCollapse,
  memory: Brain,
  retry: RefreshCw,
  reconnect: Wifi,
  disconnect: WifiOff,
  plan: ListChecks,
  todo: ListTodo,
  question: CircleHelp,
  git: GitBranch,
  extension: Plug,
  file: FileText,
  monitor: RadioTower,
  wait: Clock3,
  stop: CircleStop,
  loading: LoaderCircle,
  generic: Sparkles,
};

/** The one semantic glyph entry point used by every Grok process row. */
export function ProcessGlyph({ kind, size = "detail", className = "" }: {
  kind: ProcessGlyphKind;
  size?: UiIconSize;
  className?: string;
}) {
  if (kind === "thought") return <ThoughtGlyph size={size} className={className} />;
  return <UiIcon source={processGlyphs[kind]} size={size} className={className} />;
}

export function DisclosureGlyph({ className = "" }: { className?: string }) {
  return <UiIcon source={ChevronRight} size="detail" className={className} />;
}

/** A compact thought bubble with a trailing dot; clearer than a generic cloud. */
function ThoughtGlyph({ size, className }: { size: UiIconSize; className: string }) {
  return <svg className={`${styles.icon} ${className}`} data-ui-icon data-size={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    <path d="M7.2 15.8a5.1 5.1 0 1 1 2-9.8 5.4 5.4 0 0 1 9.5 3.5 5.1 5.1 0 0 1-5.1 5.1H8.8l-2.9 2.1 1.3-.9Z" />
    <circle cx="5.1" cy="19" r="1.15" fill="currentColor" stroke="none" />
  </svg>;
}
