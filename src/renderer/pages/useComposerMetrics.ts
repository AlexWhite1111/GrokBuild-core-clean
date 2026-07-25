import { useLayoutEffect, useRef, useState } from "react";

export type ComposerMetrics = { composerHeight: number; stackHeight: number };

export function useComposerMetrics(enabled: boolean) {
  const stackRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<ComposerMetrics>({ composerHeight: 0, stackHeight: 0 });
  useLayoutEffect(() => {
    const stack = stackRef.current;
    const composer = composerRef.current;
    if (!enabled || !stack || !composer) {
      setMetrics({ composerHeight: 0, stackHeight: 0 });
      return;
    }
    const measure = () => {
      const next = {
        composerHeight: Math.ceil(composer.getBoundingClientRect().height),
        stackHeight: Math.ceil(stack.getBoundingClientRect().height),
      };
      setMetrics((current) => current.composerHeight === next.composerHeight && current.stackHeight === next.stackHeight ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    measure();
    return () => observer.disconnect();
  }, [enabled]);
  return { ...metrics, stackRef, composerRef };
}
