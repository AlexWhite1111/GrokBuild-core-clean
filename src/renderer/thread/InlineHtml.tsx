import DOMPurify from "dompurify";
import { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import styles from "./RichText.module.css";

const FORBIDDEN_STATIC_TAGS = [
  "script", "style", "iframe", "object", "embed", "canvas", "svg", "math",
  "form", "button", "input", "select", "option", "optgroup", "textarea",
  "video", "audio", "source", "track", "link", "meta", "base", "template",
];

export function InlineHtml({ source, className = "", ...props }: {
  source: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = host.current?.shadowRoot || host.current?.attachShadow({ mode: "open" });
    if (root) root.innerHTML = DOMPurify.sanitize(source, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: FORBIDDEN_STATIC_TAGS,
      FORBID_ATTR: ["style", "srcdoc", "formaction"],
    });
  }, [source]);

  return <div {...props} ref={host} className={`${styles.inlineHtml} ${className}`} />;
}
