/** Provider-neutral lifecycle used by tool and process UI. */
export type ToolStatus = "pending" | "running" | "success" | "error" | "cancelled";

/** Semantic process kinds; icon choice remains a Components concern. */
export type ProcessKind =
  | "thought" | "tools" | "list" | "read" | "search" | "web" | "image" | "edit" | "command"
  | "subagent" | "compact" | "memory" | "retry" | "reconnect" | "disconnect"
  | "plan" | "todo" | "question" | "git" | "extension" | "file" | "monitor"
  | "wait" | "stop" | "loading" | "generic";

export interface ToolEvent {
  id: string;
  label: string;
  kind: ProcessKind;
  status: ToolStatus;
  /** Detail expanded in place inside the same chronological row. */
  detail?: string;
  detailFormat?: "text" | "code";
}

export interface ProcessGroupModel {
  id: string;
  label: string;
  kind: ProcessKind;
  status: ToolStatus;
  items: ToolEvent[];
}

export interface ControllableStateOptions<T> {
  value?: T;
  defaultValue: T;
  onChange?: (value: T) => void;
}

export type TypographyScope = "conversation" | "content";

/** Typed DOM boundary consumed by the horizontal Theme system. */
export function typographyScope(scope: TypographyScope) {
  return { "data-typography-scope": scope } as const;
}

/** Framework-neutral slot input shared by presentational Layouts. */
export interface ClassNameSlotProps { className: string }
