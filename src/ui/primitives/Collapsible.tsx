import { useState, type ReactNode } from "react";
import type { ControllableStateOptions } from "../core/contracts.js";

export function Collapsible({ open, defaultOpen = false, onOpenChange, children }: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: (state: { open: boolean; toggle: () => void }) => ReactNode;
}) {
  const [current, setCurrent] = useControllableState({ value: open, defaultValue: defaultOpen, onChange: onOpenChange });
  return children({ open: current, toggle: () => setCurrent(!current) });
}

function useControllableState<T>({ value, defaultValue, onChange }: ControllableStateOptions<T>): [T, (next: T) => void] {
  const [internal, setInternal] = useState(defaultValue);
  const current = value === undefined ? internal : value;
  const update = (next: T) => { if (value === undefined) setInternal(next); onChange?.(next); };
  return [current, update];
}
