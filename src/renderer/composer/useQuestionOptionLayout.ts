import { useLayoutEffect, useState, type RefObject } from "react";
import { expandedOptionHeight } from "./questionOptionLayout.js";

export function useQuestionOptionLayout({ header, tabs, note, options, scopeKey }: {
  header: RefObject<HTMLElement | null>;
  tabs: RefObject<HTMLElement | null>;
  note: RefObject<HTMLElement | null>;
  options: RefObject<HTMLElement | null>;
  scopeKey: string;
}): number {
  const [height, setHeight] = useState(160);

  useLayoutEffect(() => {
    let frame = 0;
    const apply = () => {
      const option = options.current?.querySelector<HTMLElement>("[data-option-copy]");
      const lineHeight = option ? Number.parseFloat(getComputedStyle(option).lineHeight) || 17 : 17;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const next = expandedOptionHeight({
        viewportHeight,
        headerHeight: header.current?.getBoundingClientRect().height || 0,
        tabsHeight: tabs.current?.getBoundingClientRect().height || 0,
        noteHeight: note.current?.getBoundingClientRect().height || 0,
        lineHeight,
      });
      setHeight((current) => current === next ? current : next);
    };
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply); };
    const observed = [header.current, tabs.current, note.current, options.current].filter((value): value is HTMLElement => Boolean(value));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observed.forEach((element) => observer?.observe(element));
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    apply();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [header, note, options, scopeKey, tabs]);

  return height;
}
